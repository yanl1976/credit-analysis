import { Router } from 'express';
import {
  listGroupedSettings,
  saveSettings,
  getPublicSettings,
} from '../services/setting-service.js';
import { listStatuses } from '../channels/registry.js';
import { authenticate } from '../middleware/auth.js';
import { requirePerm } from '../middleware/permission.js';

const router = Router();

// 登录前可读（登录页标题）
router.get('/public', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await getPublicSettings() });
  } catch (e) {
    next(e);
  }
});

// 以下需登录 + system:manage
router.get('/', authenticate, requirePerm('system:manage'), async (req, res, next) => {
  try {
    res.json({ code: 0, data: await listGroupedSettings() });
  } catch (e) {
    next(e);
  }
});

router.put('/', authenticate, requirePerm('system:manage'), async (req, res, next) => {
  try {
    const values = req.body?.values || req.body || {};
    res.json({ code: 0, data: await saveSettings(values) });
  } catch (e) {
    next(e);
  }
});

// 渠道配置状态（不含 Key；Key 通过 .env 配置）
router.get('/channels', authenticate, requirePerm('system:manage'), async (req, res, next) => {
  try {
    const channels = listStatuses();
    res.json({
      code: 0,
      data: {
        channels,
        enabledCount: channels.filter((c) => c.configured).length,
        note: '渠道开关与 API Key 通过 .env（QCC_API_KEY / TIAN_YAN_CHA_API_KEY）配置，前端仅展示状态与能力。',
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
