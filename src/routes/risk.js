import { Router } from 'express';
import { listRiskEvents, riskEventStats, getRiskEvent, handleRiskEvent } from '../services/risk-service.js';
import { authenticate } from '../middleware/auth.js';
import { dataScope } from '../middleware/data-scope.js';
import { requirePerm } from '../middleware/permission.js';

const router = Router();

router.use(authenticate, dataScope);

// 预警列表（report:view）：按客户归属组织做数据作用域过滤
router.get('/', requirePerm('report:view'), async (req, res, next) => {
  try {
    const { eventType, partnerId, status, startDate, endDate, page, pageSize } = req.query;
    const data = await listRiskEvents({
      orgIds: req.scope.orgIds,
      eventType,
      partnerId,
      status,
      startDate,
      endDate,
      page,
      pageSize,
    });
    res.json({ code: 0, data });
  } catch (e) {
    next(e);
  }
});

// 预警统计（report:view）
router.get('/stats', requirePerm('report:view'), async (req, res, next) => {
  try {
    const data = await riskEventStats({ orgIds: req.scope.orgIds, days: req.query.days });
    res.json({ code: 0, data });
  } catch (e) {
    next(e);
  }
});

// 预警处置（customer:manage）：OPEN 待处理 / PROCESSING 处理中 / CLOSED 已关闭
router.patch('/:id', requirePerm('customer:manage'), async (req, res, next) => {
  try {
    const event = await getRiskEvent(req.params.id);
    if (!event) return res.status(404).json({ code: 404, message: '预警不存在' });
    if (!req.scope.isFull && !req.scope.orgIds.includes(Number(event.owner_org_id))) {
      return res.status(403).json({ code: 403, message: '无权处置该预警' });
    }
    const data = await handleRiskEvent(req.params.id, {
      status: req.body?.status,
      note: req.body?.note,
      userId: Number(req.user.sub),
    });
    res.json({ code: 0, data });
  } catch (e) {
    next(e);
  }
});

export default router;
