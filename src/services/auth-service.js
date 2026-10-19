import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { appConfig } from '../../config/app.js';
import { getUserWithHash, getUserRoles } from './user-service.js';

async function buildAuthContext(user) {
  const roles = await getUserRoles(user.id);
  const roleIds = roles.map((r) => r.id);
  let perms = [];
  if (roleIds.length) {
    const ph = roleIds.map(() => '?').join(',');
    perms = await db.all(
      `SELECT DISTINCT p.perm_key FROM sys_permission p
       JOIN sys_role_permission rp ON rp.permission_id = p.id
       WHERE rp.role_id IN (${ph})`,
      roleIds,
    );
  }
  return {
    user: {
      id: Number(user.id),
      orgId: Number(user.org_id),
      username: user.username,
      realName: user.real_name,
      status: Number(user.status),
    },
    roles: roles.map((r) => r.role_key),
    perms: perms.map((p) => p.perm_key),
  };
}

function signTokens(user, ctx) {
  const payload = {
    sub: Number(user.id),
    username: user.username,
    orgId: Number(user.org_id),
    roles: ctx.roles,
    perms: ctx.perms,
  };
  const accessToken = jwt.sign(payload, appConfig.jwtSecret, {
    expiresIn: `${appConfig.jwtAccessExpireMin}m`,
  });
  const refreshToken = jwt.sign({ sub: Number(user.id), typ: 'refresh' }, appConfig.jwtSecret, {
    expiresIn: `${appConfig.jwtRefreshExpireDays}d`,
  });
  return { accessToken, refreshToken };
}

export async function login(username, password) {
  if (!username || !password) throw new Error('用户名和密码必填');
  const user = await getUserWithHash(String(username).trim());
  if (!user) throw new Error('用户名或密码错误');
  if (Number(user.status) !== 1) throw new Error('账号已禁用');
  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) throw new Error('用户名或密码错误');

  const ctx = await buildAuthContext(user);
  const { accessToken, refreshToken } = signTokens(user, ctx);
  return { accessToken, refreshToken, user: ctx.user, roles: ctx.roles, perms: ctx.perms };
}

export function verifyAccess(token) {
  const decoded = jwt.verify(token, appConfig.jwtSecret);
  if (decoded.typ === 'refresh') throw new Error('无效的令牌类型');
  return decoded;
}

export function verifyRefresh(token) {
  const decoded = jwt.verify(token, appConfig.jwtSecret);
  if (decoded.typ !== 'refresh') throw new Error('无效的刷新令牌');
  return decoded;
}

export async function refresh(refreshToken) {
  if (!refreshToken) throw new Error('refreshToken 必填');
  const decoded = verifyRefresh(refreshToken);
  const user = await db.get('SELECT * FROM sys_user WHERE id = ?', [decoded.sub]);
  if (!user) throw new Error('用户不存在');
  if (Number(user.status) !== 1) throw new Error('账号已禁用');

  const ctx = await buildAuthContext(user);
  const { accessToken } = signTokens(user, ctx);
  return { accessToken };
}
