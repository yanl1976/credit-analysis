import db from '../db.js';

const now = () => new Date();

// 组织树：parent_id 自引，path 形如 /1/3/7，level 从 1 开始。
// 集团根 orgType=GROUP，子公司/下级 orgType=SUB。

export async function getOrg(id) {
  return db.get('SELECT * FROM org WHERE id = ?', [id]);
}

export async function listAll() {
  return db.all('SELECT * FROM org ORDER BY level, id');
}

export async function buildTree() {
  const rows = await listAll();
  const map = new Map();
  rows.forEach((r) => map.set(Number(r.id), { ...r, children: [] }));
  const roots = [];
  for (const r of rows) {
    const node = map.get(Number(r.id));
    const parentId = Number(r.parent_id);
    if (parentId && map.has(parentId)) map.get(parentId).children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function createOrg({ parentId = 0, orgName, orgType }) {
  if (!orgName || !String(orgName).trim()) throw new Error('orgName 必填');
  if (!['GROUP', 'SUB'].includes(orgType)) throw new Error('orgType 必须为 GROUP 或 SUB');

  let level = 1;
  let parentPath = '';
  const pid = Number(parentId) || 0;
  if (pid) {
    const parent = await getOrg(pid);
    if (!parent) throw new Error('父组织不存在');
    if (parent.org_type !== 'GROUP' && parent.org_type !== 'SUB') throw new Error('父组织类型非法');
    level = Number(parent.level) + 1;
    parentPath = parent.path;
  }

  // 先插入拿到自增 id，再回填 path（组织创建低频，暂不引入事务）
  const result = await db.run(
    'INSERT INTO org (parent_id, org_name, org_type, level, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [pid, String(orgName).trim(), orgType, level, '/', now(), now()],
  );
  const id = Number(result.lastInsertRowid);
  if (!id) throw new Error('组织创建失败（未取得自增 id）');

  const path = parentPath ? `${parentPath}/${id}` : `/${id}`;
  await db.run('UPDATE org SET path = ?, updated_at = ? WHERE id = ?', [path, now(), id]);
  return getOrg(id);
}

export async function updateOrg(id, { orgName, orgType }) {
  const org = await getOrg(id);
  if (!org) throw new Error('组织不存在');

  const fields = [];
  const params = [];
  if (orgName !== undefined) {
    fields.push('org_name = ?');
    params.push(String(orgName).trim());
  }
  if (orgType !== undefined) {
    if (!['GROUP', 'SUB'].includes(orgType)) throw new Error('orgType 必须为 GROUP 或 SUB');
    fields.push('org_type = ?');
    params.push(orgType);
  }
  if (!fields.length) return org;

  fields.push('updated_at = ?');
  params.push(now());
  params.push(Number(id));
  await db.run(`UPDATE org SET ${fields.join(', ')} WHERE id = ?`, params);
  return getOrg(id);
}

export async function deleteOrg(id) {
  const org = await getOrg(id);
  if (!org) throw new Error('组织不存在');
  const children = await db.get('SELECT COUNT(*) AS c FROM org WHERE parent_id = ?', [id]);
  if (Number(children.c) > 0) throw new Error('存在子组织，不能删除');
  const users = await db.get('SELECT COUNT(*) AS c FROM sys_user WHERE org_id = ?', [id]);
  if (Number(users.c) > 0) throw new Error('该组织下存在用户，不能删除');
  const roles = await db.get('SELECT COUNT(*) AS c FROM sys_role WHERE org_id = ?', [id]);
  if (Number(roles.c) > 0) throw new Error('该组织下存在角色，不能删除');
  await db.run('DELETE FROM org WHERE id = ?', [id]);
  return { deleted: true };
}

// 返回本组织及其所有下级组织 id（基于 path 前缀）
export async function getDescendantIds(orgId) {
  const org = await getOrg(orgId);
  if (!org) return [];
  const rows = await db.all('SELECT id FROM org WHERE path = ? OR path LIKE ?', [
    org.path,
    `${org.path}/%`,
  ]);
  return rows.map((r) => Number(r.id));
}
