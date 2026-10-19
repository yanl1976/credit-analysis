import { Router } from 'express';
import * as authService from '../services/auth-service.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    res.json({ code: 0, data: await authService.login(username, password) });
  } catch (e) {
    next(e);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body || {};
    res.json({ code: 0, data: await authService.refresh(refreshToken) });
  } catch (e) {
    next(e);
  }
});

// JWT 无状态：登出由前端清除令牌，服务端仅返回确认
router.post('/logout', (req, res) => {
  res.json({ code: 0, data: { ok: true } });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ code: 0, data: req.user });
});

export default router;
