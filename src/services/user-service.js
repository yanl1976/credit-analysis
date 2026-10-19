import bcrypt from 'bcryptjs';
import db from '../db.js';

const now = () => new Date();
const hash = (pwd) => bcrypt.hash(String(pwd), 10);
const SAFE_FIELDS = 'id, org_id, username, real_name, status, created_at';

export async function getUser(id) {
  return db.get(`SELECT ${SAFE_FIELDS} FROM sys_user WHERE id = ?`, [id]);
}

export async function getUserWithHash(username) {
  return db.get('SELECT * FROM sys_user WHERE username = ?', [username]);
}

export async function listUsers({ orgIds } = {}) {
  if (orgIds && orgIds.length) {
    const ph = orgIds.map(() => '?').join(',');
    return db.all(
      `SELECT ${SAFE_FIELDS} FROM sys_user WHERE org_id IN (${ph}) ORDER BY id`,
      orgIds.map(Number),
    );
  }
  return db.all(`SELECT ${SAFE_FIELDS} FROM sys_user ORDER BY id`);
}

// 用户列表（含所属组织与角色），供系统设置页展示
export async function listUsersWithRoles({ orgIds, keyword } = {}) {
  const where = [];
  const params = [];
  if (Array.isArray(orgIds)) {
    if (!orgIds.length) return [];
    where.push(`u.org_id IN (${orgIds.map(() => '?').join(',')})`);
    params.push(...orgIds.map(Number));
  }
  if (keyword) {
    where.push('(u.username LIKE ? OR u.real_name LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.all(
    `SELECT u.id, u.org_id, u.username, u.real_name, u.status, u.created_at, o.org_name
       FROM sys_user u LEFT JOIN org o ON o.id = u.org_id
       ${whereSql}
      ORDER BY u.id`,
    params,
  );
  const links = await db.all(
    `SELECT ur.user_id, r.id, r.role_key, r.role_name
       FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
      ORDER BY r.id`,
  );
  const byUser = new Map();
  for (const l of links) {
    if (!byUser.has(Number(l.user_id))) byUser.set(Number(l.user_id), []);
    byUser.get(Number(l.user_id)).push({ id: Number(l.id), roleKey: l.role_key, roleName: l.role_name });
  }
  return rows.map((u) => ({
    id: Number(u.id),
    orgId: Number(u.org_id),
    orgName: u.org_name,
    username: u.username,
    realName: u.real_name,
    status: Number(u.status),
    createdAt: u.created_at,
    roles: byUser.get(Number(u.id)) || [],
  }));
}

export async function createUser({ orgId, username, password, realName, status = 1 }) {
  if (!orgId) throw new Error('orgId 必填');
  if (!username || !String(username).trim()) throw new Error('username 必填');
  if (!password || String(password).length < 6) throw new Error('password 至少 6 位');

  const org = await db.get('SELECT id FROM org WHERE id = ?', [orgId]);
  if (!org) throw new Error('组织不存在');
  const exists = await db.get('SELECT id FROM sys_user WHERE username = ?', [String(username).trim()]);
  if (exists) throw new Error('用户名已存在');

  const r = await db.run(
    'INSERT INTO sys_user (org_id, username, password_hash, real_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [Number(orgId), String(username).trim(), await hash(password), realName || null, Number(status) ? 1 : 0, now()],
  );
  return getUser(Number(r.lastInsertRowid));
}

export async function updateUser(id, { realName, status, password, orgId }) {
  const user = await db.get('SELECT id FROM sys_user WHERE id = ?', [id]);
  if (!user) throw new Error('用户不存在');

  const fields = [];
  const params = [];
  if (orgId !== undefined) {
    const org = await db.get('SELECT id FROM org WHERE id = ?', [Number(orgId)]);
    if (!org) throw new Error('组织不存在');
    fields.push('org_id = ?');
    params.push(Number(orgId));
  }
  if (realName !== undefined) {
    fields.push('real_name = ?');
    params.push(realName);
  }
  if (status !== undefined) {
    fields.push('status = ?');
    params.push(Number(status) ? 1 : 0);
  }
  if (password !== undefined) {
    if (String(password).length < 6) throw new Error('password 至少 6 位');
    fields.push('password_hash = ?');
    params.push(await hash(password));
  }
  if (fields.length) {
    params.push(Number(id));
    await db.run(`UPDATE sys_user SET ${fields.join(', ')} WHERE id = ?`, params);
  }
  return getUser(Number(id));
}

export async function deleteUser(id) {
  const user = await db.get('SELECT id FROM sys_user WHERE id = ?', [id]);
  if (!user) throw new Error('用户不存在');
  await db.run('DELETE FROM sys_user_role WHERE user_id = ?', [id]);
  await db.run('DELETE FROM sys_user WHERE id = ?', [id]);
  return { deleted: true };
}

export async function assignRoles(userId, roleIds = []) {
  const user = await db.get('SELECT id FROM sys_user WHERE id = ?', [userId]);
  if (!user) throw new Error('用户不存在');
  await db.run('DELETE FROM sys_user_role WHERE user_id = ?', [userId]);
  for (const rid of roleIds) {
    const role = await db.get('SELECT id FROM sys_role WHERE id = ?', [rid]);
    if (!role) throw new Error(`角色不存在: ${rid}`);
    await db.run('INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [Number(userId), Number(rid)]);
  }
  return getUserRoles(userId);
}

export async function getUserRoles(userId) {
  return db.all(
    'SELECT r.* FROM sys_role r JOIN sys_user_role ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.id',
    [userId],
  );
}
