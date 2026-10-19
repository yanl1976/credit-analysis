import { Router } from 'express';
import * as permissionService from '../services/permission-service.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await permissionService.listPermissions() });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await permissionService.createPermission(req.body || {}) });
  } catch (e) {
    next(e);
  }
});

// 初始化预置权限（幂等），供种子/运维调用
router.post('/ensure-default', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await permissionService.ensureDefaultPermissions() });
  } catch (e) {
    next(e);
  }
});

export default router;
