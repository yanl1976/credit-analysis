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

export async function updateUser(id, { realName, status, password }) {
  const user = await db.get('SELECT id FROM sys_user WHERE id = ?', [id]);
  if (!user) throw new Error('用户不存在');

  const fields = [];
  const params = [];
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
