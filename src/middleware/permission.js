// 功能权限中间件：基于 JWT payload 中的 perms（登录时注入）
export function requirePerm(permKey) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ code: 401, message: '未登录' });
    const perms = Array.isArray(req.user.perms) ? req.user.perms : [];
    if (!perms.includes(permKey)) {
      return res.status(403).json({ code: 403, message: `缺少权限: ${permKey}` });
    }
    return next();
  };
}

export function requireAnyPerm(permKeys = []) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ code: 401, message: '未登录' });
    const perms = Array.isArray(req.user.perms) ? req.user.perms : [];
    if (!permKeys.some((k) => perms.includes(k))) {
      return res.status(403).json({ code: 403, message: `缺少权限: ${permKeys.join(' 或 ')}` });
    }
    return next();
  };
}
