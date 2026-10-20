import { Router } from 'express';
import { getAiStatus, profilePartner, aiCollect } from '../services/ai-service.js';
import { startAiCollectJob, startAiSearchJob, getAiJob } from '../services/ai-job.js';
import * as partnerService from '../services/partner-service.js';
import { authenticate } from '../middleware/auth.js';
import { dataScope } from '../middleware/data-scope.js';
import { requirePerm } from '../middleware/permission.js';

const router = Router();

router.use(authenticate);

function inScope(scope, ownerOrgId) {
  if (scope.isFull) return true;
  return Array.isArray(scope.orgIds) && scope.orgIds.includes(Number(ownerOrgId));
}

// AI 可用状态（前端据此决定是否显示 AI 按钮）
router.get('/status', (req, res) => {
  res.json({ code: 0, data: getAiStatus() });
});

// 输入客户名称 → AI 生成档案草稿（不落库，供人工核验后保存）
router.post('/partner-profile', requirePerm('customer:manage'), async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ code: 400, message: '客户名称必填' });
    }
    res.json({ code: 0, data: await profilePartner(name) });
  } catch (e) {
    next(e);
  }
});

// 新建客户：按名称搜索候选企业（异步）——立即返回 jobId，前端轮询 /company-search/jobs/:jobId
router.post('/company-search/job', requirePerm('customer:manage'), async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ code: 400, message: '客户名称必填' });
    }
    res.json({ code: 0, data: startAiSearchJob(name) });
  } catch (e) {
    next(e);
  }
});

router.get('/company-search/jobs/:jobId', async (req, res, next) => {
  try {
    const job = getAiJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ code: 404, message: '任务不存在或已过期（进程重启后需重新发起）' });
    }
    res.json({ code: 0, data: job });
  } catch (e) {
    next(e);
  }
});

// 触发 AI 采集：按客户名称检索司法/信用/财务信息并落盘，随后重算评分
router.post('/collect/:id', requirePerm('customer:manage'), dataScope, async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: await aiCollect(partner.id) });
  } catch (e) {
    next(e);
  }
});

// 异步版 AI 采集：立即返回 jobId，前端轮询 /collect/jobs/:jobId 拿进度（含百分比与当前步骤）
router.post('/collect/:id/job', requirePerm('customer:manage'), dataScope, async (req, res, next) => {
  try {
    const partner = await partnerService.getPartner(Number(req.params.id));
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: startAiCollectJob(partner.id) });
  } catch (e) {
    next(e);
  }
});

router.get('/collect/jobs/:jobId', dataScope, async (req, res, next) => {
  try {
    const job = getAiJob(req.params.jobId);
    if (!job) return res.status(404).json({ code: 404, message: '任务不存在或已过期（进程重启后需重新发起）' });
    const partner = await partnerService.getPartner(job.partnerId);
    if (!partner) return res.status(404).json({ code: 404, message: '客户不存在' });
    if (!inScope(req.scope, partner.owner_org_id)) {
      return res.status(403).json({ code: 403, message: '无权访问该客户' });
    }
    res.json({ code: 0, data: job });
  } catch (e) {
    next(e);
  }
});

export default router;
