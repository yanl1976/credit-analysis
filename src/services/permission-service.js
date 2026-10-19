import db from '../db.js';

// 预置功能权限（2.5 功能权限中间件依赖这些 perm_key）
export const DEFAULT_PERMISSIONS = [
  { permKey: 'system:manage', permName: '系统管理', description: '组织/用户/角色管理' },
  { permKey: 'channel:config', permName: '渠道配置', description: '数据渠道开关与密钥配置' },
  { permKey: 'customer:manage', permName: '客户管理', description: '客户录入/编辑/采集' },
  { permKey: 'report:view', permName: '报告查看', description: '资信报告查询' },
  { permKey: 'warning:view', permName: '预警查看', description: '风险预警查看' },
];

export async function listPermissions() {
  return db.all('SELECT * FROM sys_permission ORDER BY id');
}

export async function createPermission({ permKey, permName, description }) {
  if (!permKey || !String(permKey).trim()) throw new Error('permKey 必填');
  if (!permName || !String(permName).trim()) throw new Error('permName 必填');
  const exists = await db.get('SELECT id FROM sys_permission WHERE perm_key = ?', [String(permKey).trim()]);
  if (exists) throw new Error('权限标识已存在');
  const r = await db.run(
    'INSERT INTO sys_permission (perm_key, perm_name, description) VALUES (?, ?, ?)',
    [String(permKey).trim(), String(permName).trim(), description || null],
  );
  return db.get('SELECT * FROM sys_permission WHERE id = ?', [Number(r.lastInsertRowid)]);
}

export async function ensureDefaultPermissions() {
  for (const p of DEFAULT_PERMISSIONS) {
    const exists = await db.get('SELECT id FROM sys_permission WHERE perm_key = ?', [p.permKey]);
    if (!exists) {
      await db.run('INSERT INTO sys_permission (perm_key, perm_name, description) VALUES (?, ?, ?)', [
        p.permKey,
        p.permName,
        p.description || null,
      ]);
    }
  }
  return listPermissions();
}
