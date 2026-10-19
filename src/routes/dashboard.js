import { Router } from 'express';
import { getOverview } from '../services/dashboard-service.js';
import { authenticate } from '../middleware/auth.js';
import { dataScope } from '../middleware/data-scope.js';
import { requirePerm } from '../middleware/permission.js';

const router = Router();

router.use(authenticate, dataScope);

// 概览看板（report:view）：客户数/评分分布/维度数据量/近期预警/高风险客户
router.get('/overview', requirePerm('report:view'), async (req, res, next) => {
  try {
    res.json({ code: 0, data: await getOverview({ orgIds: req.scope.orgIds }) });
  } catch (e) {
    next(e);
  }
});

export default router;
