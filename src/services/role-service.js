import db from '../db.js';

const now = () => new Date();

export async function getRole(id) {
  return db.get('SELECT * FROM sys_role WHERE id = ?', [id]);
}

export async function listRoles({ orgIds } = {}) {
  if (orgIds && orgIds.length) {
    const ph = orgIds.map(() => '?').join(',');
    return db.all(`SELECT * FROM sys_role WHERE org_id IN (${ph}) ORDER BY id`, orgIds.map(Number));
  }
  return db.all('SELECT * FROM sys_role ORDER BY id');
}

// 角色列表（含所属组织、权限数、用户数），供系统设置页展示
export async function listRolesWithStats({ orgIds } = {}) {
  const where = [];
  const params = [];
  if (Array.isArray(orgIds)) {
    if (!orgIds.length) return [];
    where.push(`r.org_id IN (${orgIds.map(() => '?').join(',')})`);
    params.push(...orgIds.map(Number));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.all(
    `SELECT r.*, o.org_name,
            (SELECT COUNT(*) FROM sys_role_permission rp WHERE rp.role_id = r.id) AS perm_count,
            (SELECT COUNT(*) FROM sys_user_role ur WHERE ur.role_id = r.id) AS user_count
       FROM sys_role r LEFT JOIN org o ON o.id = r.org_id
       ${whereSql}
      ORDER BY r.id`,
    params,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    orgId: Number(r.org_id),
    orgName: r.org_name,
    roleKey: r.role_key,
    roleName: r.role_name,
    description: r.description,
    createdAt: r.created_at,
    permCount: Number(r.perm_count || 0),
    userCount: Number(r.user_count || 0),
  }));
}

export async function createRole({ orgId, roleKey, roleName, description }) {
  if (!orgId) throw new Error('orgId 必填');
  if (!roleKey || !String(roleKey).trim()) throw new Error('roleKey 必填');
  if (!roleName || !String(roleName).trim()) throw new Error('roleName 必填');

  const org = await db.get('SELECT id FROM org WHERE id = ?', [orgId]);
  if (!org) throw new Error('组织不存在');
  const exists = await db.get('SELECT id FROM sys_role WHERE org_id = ? AND role_key = ?', [
    Number(orgId),
    String(roleKey).trim(),
  ]);
  if (exists) throw new Error('该组织下角色标识已存在');

  const r = await db.run(
    'INSERT INTO sys_role (org_id, role_key, role_name, description, created_at) VALUES (?, ?, ?, ?, ?)',
    [Number(orgId), String(roleKey).trim(), String(roleName).trim(), description || null, now()],
  );
  return getRole(Number(r.lastInsertRowid));
}

export async function updateRole(id, { roleName, description }) {
  const role = await db.get('SELECT id FROM sys_role WHERE id = ?', [id]);
  if (!role) throw new Error('角色不存在');

  const fields = [];
  const params = [];
  if (roleName !== undefined) {
    fields.push('role_name = ?');
    params.push(String(roleName).trim());
  }
  if (description !== undefined) {
    fields.push('description = ?');
    params.push(description);
  }
  if (fields.length) {
    params.push(Number(id));
    await db.run(`UPDATE sys_role SET ${fields.join(', ')} WHERE id = ?`, params);
  }
  return getRole(Number(id));
}

export async function deleteRole(id) {
  const role = await db.get('SELECT id FROM sys_role WHERE id = ?', [id]);
  if (!role) throw new Error('角色不存在');
  await db.run('DELETE FROM sys_role_permission WHERE role_id = ?', [id]);
  await db.run('DELETE FROM sys_user_role WHERE role_id = ?', [id]);
  await db.run('DELETE FROM sys_role WHERE id = ?', [id]);
  return { deleted: true };
}

export async function assignPermissions(roleId, permIds = []) {
  const role = await db.get('SELECT id FROM sys_role WHERE id = ?', [roleId]);
  if (!role) throw new Error('角色不存在');
  await db.run('DELETE FROM sys_role_permission WHERE role_id = ?', [roleId]);
  for (const pid of permIds) {
    const perm = await db.get('SELECT id FROM sys_permission WHERE id = ?', [pid]);
    if (!perm) throw new Error(`权限不存在: ${pid}`);
    await db.run('INSERT INTO sys_role_permission (role_id, permission_id) VALUES (?, ?)', [
      Number(roleId),
      Number(pid),
    ]);
  }
  return getRolePermissions(roleId);
}

export async function getRolePermissions(roleId) {
  return db.all(
    'SELECT p.* FROM sys_permission p JOIN sys_role_permission rp ON rp.permission_id = p.id WHERE rp.role_id = ? ORDER BY p.id',
    [roleId],
  );
}
