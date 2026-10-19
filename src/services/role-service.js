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
