import { Router } from 'express';
import * as partnerService from '../services/partner-service.js';
import { authenticate } from '../middleware/auth.js';
import { dataScope } from '../middleware/data-scope.js';
import { requirePerm } from '../middleware/permission.js';
import * as collectService from '../services/collect-service.js';
import { syncPartnerFinanceFromEastmoney } from '../services/eastmoney-service.js';
import * as tycService from '../services/tyc-service.js';
import { getSetting } from '../services/setting-service.js';
import {
  calculateScore,
  ratePartner,
  rateBatch,
  getRating,
  getRatingHistory,
} from '../services/scoring-service.js';

const router = Router();

// 所有客户接口：必须登录 + 计算数据作用域
router.use(authenticate, dataScope);

function inScope(scope, ownerOrgId) {
  if (scope.isFull) return true;
  return Array.isArray(scope.orgIds) && scope.orgIds.includes(Number(ownerOrgId));
}

router.get('/', async (req, res, next) => {
  try {
    const { keyword, admissionStatus, reviewStatus, page, pageSize } = req.query;
    const data = await partnerService.listPartners({
      orgIds: req.scope.orgIds,
      keyword,
      admissionStatus,
      reviewStatus,
      page,
      pageSize,
    });
    res.json({ code: 0, data });
  } catch (e) {
    next(e);
  }
});

// 风险名单汇总：正常 / 关注 / 重点监控 / 黑名单
router.get('/admission-stats', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await partnerService.getAdmissionStats({ orgIds: req.scope.orgIds }) });
  } catch (e) {
    next(e);
  }
});

// 定期复审统计：逾期 / 临期 / 未排期（看板与列表页提示共用）
router.get('/review-stats', async (req, res, next) => {
  try {
    res.json({
      code: 0,
      data: await partnerService.getReviewStats({
        orgIds: req.scope.orgIds,
        dueSoonDays: req.query.dueSoonDays,
      }),
    });
  } catch (e) {
    next(e);
  }
});

// CSV 辅助：转义逗号/引号/换行，Excel 打开不乱码靠 UTF-8 BOM
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}`;
}

const REVIEW_LABELS = {
  unscheduled: '未排期',
  overdue: '已逾期',
  dueSoon: '临期',
  scheduled: '已排期',
};

// 客户清单导出（CSV，按当前筛选范围；超过上限会标注 truncated）
router.get('/export', async (req, res, next) => {
  try {
    const { keyword, admissionStatus, reviewStatus, limit } = req.query;
    const { items, total, truncated } = await partnerService.listPartnersForExport({
      orgIds: req.scope.orgIds,
      keyword,
      admissionStatus,
      reviewStatus,
      limit,
    });
    const headers = [
      '客户名称',
      '统一社会信用代码',
      '法定代表人',
      '工商状态',
      '省份',
      '行业',
      '归属组织',
      '准入状态',
      '信用评分',
      '信用等级',
      '风险等级',
      '下次复审日期',
      '复审状态',
      '数据来源',
      '创建时间',
    ];
    const rows = items.map((p) => [
      p.name,
      p.credit_code,
      p.legal_person,
      p.reg_status,
      p.province,
      p.industry,
      p.org_name,
      partnerService.ADMISSION_LABELS[p.admission_status] || '正常',
      p.rating_score,
      p.rating_grade,
      p.rating_risk_level,
      p.next_review_date,
      REVIEW_LABELS[p.review_status] || '',
      p.data_source,
      p.created_at,
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    res.json({
      code: 0,
      data: {
        filename: `客户清单_${stamp}.csv`,
        content: toCsv(headers, rows),
        total,
        exported: items.length,
        truncated,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post('/', requirePerm('customer:manage'), async (req, res, next) => {
  try {
    const body = req.body || {};
    // 集团管理员可指定归属组织；子公司用户强制归属本组织
    const ownerOrgId = req.scope.isFull
      ? Number(body.ownerOrgId) || Number(req.user.orgId)
      : Number(req.user.orgId);
    const partner = await partnerService.createPartner({ ...body, ownerOrgId });
    res.json({ code: 0, data: partner });
  } catch (e) {
    next(e);
  }
});

// 批量重算（report:view）：不传 partnerIds 则按数据作用域全量重算
router.post('/rate-batch', requirePerm('report:view'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const partnerIds = Array.isArray(body.partnerIds) ? body.partnerIds : null;
    res.json({
      code: 0,
      data: await rateBatch({ partnerIds, orgIds: req.scope.orgIds }),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const partner = await partnerService.getPartnerDetail(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: partner });
  } catch (e) {
    next(e);
  }
});

// 单客户资信报告导出（CSV）：基本信息 + 评分明细，便于线下评审留档
router.get('/:id/report-export', requirePerm('report:view'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const p = await partnerService.getPartnerDetail(id);
    if (!p) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, p.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    const info = [
      ['客户名称', p.name],
      ['统一社会信用代码', p.credit_code],
      ['法定代表人', p.legal_person],
      ['工商状态', p.reg_status],
      ['省份', p.province],
      ['行业', p.industry],
      ['归属组织', p.org_name],
      ['准入状态', partnerService.ADMISSION_LABELS[p.admission_status] || '正常'],
      ['下次复审日期', p.next_review_date],
      ['信用评分', p.rating_score],
      ['信用等级', p.rating_grade],
      ['风险等级', p.rating_risk_level],
      ['是否触发一票否决', Number(p.rating_veto) ? '是' : '否'],
      ['评分口径版本', p.rating_calc_version],
      ['评分时间', p.rating_calculated_at],
    ];
    let reasons = [];
    try {
      reasons = p.rating_reasons ? JSON.parse(p.rating_reasons) : [];
    } catch {
      reasons = [];
    }
    const deductions = (Array.isArray(reasons) ? reasons : [])
      .filter((r) => Number(r?.delta) < 0)
      .map((r) => [r.category || '', r.delta, r.reason || '']);

    const lines = ['项目,内容'];
    for (const [k, v] of info) lines.push([k, v].map(csvCell).join(','));
    lines.push('');
    lines.push('扣分类别,分值,说明');
    if (deductions.length) for (const r of deductions) lines.push(r.map(csvCell).join(','));
    else lines.push('无扣分项,,');
    lines.push('');
    lines.push('导出时间,' + new Date().toISOString().slice(0, 19).replace('T', ' '));

    const stamp = new Date().toISOString().slice(0, 10);
    res.json({
      code: 0,
      data: { filename: `资信报告_${p.name}_${stamp}.csv`, content: `\uFEFF${lines.join('\r\n')}` },
    });
  } catch (e) {
    next(e);
  }
});

// 资信报告「上一条 / 下一条」：按客户列表顺序（id DESC）取相邻客户，作用域/检索词与列表保持一致
router.get('/:id/neighbors', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const partner = await partnerService.getPartner(id);
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    const data = await partnerService.getNeighborPartners(id, {
      orgIds: req.scope.orgIds,
      keyword: req.query.keyword,
      admissionStatus: req.query.admissionStatus,
      reviewStatus: req.query.reviewStatus,
    });
    res.json({ code: 0, data });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', requirePerm('customer:manage'), async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: await partnerService.updatePartner(Number(req.params.id), req.body || {}) });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requirePerm('customer:manage'), async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: await partnerService.deletePartner(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

// 触发采集（customer:manage）
router.post('/:id/collect', requirePerm('customer:manage'), async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: await collectService.collectPartner(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/collect-tasks', async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: await collectService.listFetchTasks(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/judicial', async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: await collectService.getJudicial(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/credit', async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: await collectService.getCredit(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

// 从东方财富拉取上市公司真实财报（按股票代码），用于上市客户 / 上市子公司
router.post('/:id/finance/eastmoney', requirePerm('customer:manage'), async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    const stockCode = String(req.body?.stockCode || '').trim();
    if (!/^\d{6}$/.test(stockCode)) {
      return res.status(400).json({ code: 400, message: '请填写 6 位股票代码（如 600192）' });
    }
    const listedStatus = ['本公司上市', '母公司上市', '未上市'].includes(req.body?.listedStatus)
      ? req.body.listedStatus
      : '母公司上市';
    const data = await syncPartnerFinanceFromEastmoney(partner.id, stockCode, { listedStatus });
    const scored = await autoRecalcIfEnabled(partner.id);
    res.json({ code: 0, data: { ...data, scored } });
  } catch (e) {
    // 取数失败必须显式报错，绝不用推测数据顶替
    res.status(502).json({ code: 502, message: `东方财富取数失败：${e.message}` });
  }
});

// ===== 手工录入：司法 / 信用 / 财务 单条增删改（customer:manage + 数据范围）=====
const DIM_KINDS = ['judicial', 'credit', 'finance'];

async function autoRecalcIfEnabled(partnerId) {
  if (!(await getSetting('scoring.autoRecalcOnManual', true))) return null;
  return ratePartner(partnerId);
}

for (const kind of DIM_KINDS) {
  router.post(`/:id/${kind}`, requirePerm('customer:manage'), async (req, res, next) => {
    try {
      const partner = await partnerService.getPartner(Number(req.params.id));
      if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
      if (!inScope(req.scope, partner.owner_org_id)) {
        return res.status(403).json({ code: 403, message: '无权访问该客户' });
      }
      const item = await collectService.createDimension(kind, partner.id, req.body || {});
      const scored = await autoRecalcIfEnabled(partner.id);
      res.json({ code: 0, data: { item, scored } });
    } catch (e) {
      next(e);
    }
  });

  router.put(`/:id/${kind}/:itemId`, requirePerm('customer:manage'), async (req, res, next) => {
    try {
      const partner = await partnerService.getPartner(Number(req.params.id));
      if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
      if (!inScope(req.scope, partner.owner_org_id)) {
        return res.status(403).json({ code: 403, message: '无权访问该客户' });
      }
      const item = await collectService.updateDimension(kind, partner.id, Number(req.params.itemId), req.body || {});
      const scored = await autoRecalcIfEnabled(partner.id);
      res.json({ code: 0, data: { item, scored } });
    } catch (e) {
      next(e);
    }
  });

  router.delete(`/:id/${kind}/:itemId`, requirePerm('customer:manage'), async (req, res, next) => {
    try {
      const partner = await partnerService.getPartner(Number(req.params.id));
      if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
      if (!inScope(req.scope, partner.owner_org_id)) {
        return res.status(403).json({ code: 403, message: '无权访问该客户' });
      }
      const result = await collectService.deleteDimension(kind, partner.id, Number(req.params.itemId));
      const scored = await autoRecalcIfEnabled(partner.id);
      res.json({ code: 0, data: { ...result, scored } });
    } catch (e) {
      next(e);
    }
  });
}

router.get('/:id/finance', async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: await collectService.getFinance(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

// 天眼AI 企业画像（读取最近一次同步结果）
router.get('/:id/tyc-profile', requirePerm('report:view'), async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: await tycService.getTycProfile(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

// 天眼AI 同步（customer:manage）：基础画像 4 项 + P0 风险明细 11 项
// 默认走节流：已缓存的工具不重复调用、已知无权限的工具直接跳过、额度用尽即熔断
// 请求体 { force: true } 可忽略缓存与权限记忆强制全量重调（套餐升级后补齐数据用）
router.post('/:id/tyc-sync', requirePerm('customer:manage'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const partner = await partnerService.getPartner(id);
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    const force = req.body?.force === true || req.body?.force === 'true' || req.query.force === '1';
    const data = await tycService.syncTycProfile(id, partner.name, { force });
    // 同步后立即重算，保证报告页分数与新增风险一致
    const rating = await ratePartner(id);
    res.json({ code: 0, data: { ...data, rating } });
  } catch (e) {
    next(e);
  }
});

// 天眼AI 重解析（customer:manage）：不发任何请求，只把已落库的原始报文重新归一化。
// 用途：归一化规则改进后补落明细，不再消耗天眼查调用额度
router.post('/:id/tyc-resync', requirePerm('customer:manage'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const partner = await partnerService.getPartner(id);
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    const data = await tycService.resyncTycDimensions(id);
    const rating = await ratePartner(id);
    res.json({ code: 0, data: { ...data, rating } });
  } catch (e) {
    next(e);
  }
});

// 评分计算 + 落库（report:view）：?dryRun=1 只算不存
router.post('/:id/rate', requirePerm('report:view'), async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    const dryRun = req.query.dryRun === '1' || req.body?.dryRun === true;
    const data = dryRun
      ? await calculateScore(Number(req.params.id))
      : await ratePartner(Number(req.params.id));
    res.json({ code: 0, data });
  } catch (e) {
    next(e);
  }
});

// 当前评分
router.get('/:id/rating', requirePerm('report:view'), async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    const data = await getRating(Number(req.params.id));
    if (!data) return res.status(404).json({ code: 404, message: '该客户尚未评分' });
    res.json({ code: 0, data });
  } catch (e) {
    next(e);
  }
});

// 历史评分（最近 N 次，默认 20，上限 200）
router.get('/:id/rating-history', requirePerm('report:view'), async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: await getRatingHistory(Number(req.params.id), req.query.limit) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/collect-summary', async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: await collectService.getCollectSummary(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

export default router;
