import { verifyAccess } from '../services/auth-service.js';

// 必须登录：从 Authorization: Bearer <token> 解析并挂载 req.user
export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ code: 401, message: '未登录' });
  try {
    req.user = verifyAccess(token);
    return next();
  } catch (e) {
    return res.status(401).json({ code: 401, message: '登录已失效' });
  }
}
