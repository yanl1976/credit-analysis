import { Router } from 'express';
import {
  listGroupedSettings,
  saveSettings,
  getPublicSettings,
} from '../services/setting-service.js';
import { listStatuses } from '../channels/registry.js';
import { reloadChannels } from '../channels/index.js';
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
    await saveSettings(values);

    // 渠道参数改动后热重载，避免"保存了但要重启才生效"
    if (Object.keys(values).some((k) => k.startsWith('channel.'))) {
      await reloadChannels();
    }

    res.json({ code: 0, data: await listGroupedSettings() });
  } catch (e) {
    next(e);
  }
});

// 渠道配置状态（不返回 Key 明文）
router.get('/channels', authenticate, requirePerm('system:manage'), async (req, res, next) => {
  try {
    const channels = listStatuses();
    res.json({
      code: 0,
      data: {
        channels,
        enabledCount: channels.filter((c) => c.configured).length,
        note: '渠道开关、API Key 与预算可在上方「数据渠道」分组中配置，保存后立即生效；.env 中的同名配置作为兜底默认值。',
      },
    });
  } catch (e) {
    next(e);
  }
});

export default router;
