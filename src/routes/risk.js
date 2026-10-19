import { Router } from 'express';
import { listRiskEvents, riskEventStats } from '../services/risk-service.js';
import { authenticate } from '../middleware/auth.js';
import { dataScope } from '../middleware/data-scope.js';
import { requirePerm } from '../middleware/permission.js';

const router = Router();

router.use(authenticate, dataScope);

// 预警列表（report:view）：按客户归属组织做数据作用域过滤
router.get('/', requirePerm('report:view'), async (req, res, next) => {
  try {
    const { eventType, partnerId, startDate, endDate, page, pageSize } = req.query;
    const data = await listRiskEvents({
      orgIds: req.scope.orgIds,
      eventType,
      partnerId,
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

export default router;
