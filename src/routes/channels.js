import { Router } from 'express';
import { listStatuses, listEnabledConnectors } from '../channels/registry.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// 渠道状态（不含 Key），供前端"渠道配置"页展示启用/未配置
router.get('/', authenticate, (req, res) => {
  res.json({
    code: 0,
    data: {
      channels: listStatuses(),
      enabledCount: listEnabledConnectors().length,
    },
  });
});

export default router;
