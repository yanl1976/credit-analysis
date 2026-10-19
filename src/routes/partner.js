import { Router } from 'express';
import * as partnerService from '../services/partner-service.js';
import { authenticate } from '../middleware/auth.js';
import { dataScope } from '../middleware/data-scope.js';
import { requirePerm } from '../middleware/permission.js';
import * as collectService from '../services/collect-service.js';
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
    const { keyword, page, pageSize } = req.query;
    const data = await partnerService.listPartners({
      orgIds: req.scope.orgIds,
      keyword,
      page,
      pageSize,
    });
    res.json({ code: 0, data });
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
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: partner });
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
