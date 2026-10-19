import db from './db.js';
import { createTables } from './migrate.js';
import { ensureDefaultPermissions } from './services/permission-service.js';
import { createUser, getUserWithHash, assignRoles } from './services/user-service.js';
import { createRole, assignPermissions, listRoles } from './services/role-service.js';

// 初始化种子：建表 + 预置权限 + 集团根组织 + 管理员角色/账号
// 用法：npm run seed（可用 ADMIN_USERNAME / ADMIN_PASSWORD 覆盖默认账号）
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const GROUP_NAME = process.env.GROUP_NAME || '集团总部';

async function ensureGroupOrg() {
  const exists = await db.get("SELECT * FROM org WHERE org_type = 'GROUP' AND parent_id = 0 ORDER BY id LIMIT 1");
  if (exists) return exists;
  const r = await db.run(
    'INSERT INTO org (parent_id, org_name, org_type, level, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
    [0, GROUP_NAME, 'GROUP', 1, '/'],
  );
  const id = Number(r.lastInsertRowid);
  await db.run('UPDATE org SET path = ? WHERE id = ?', [`/${id}`, id]);
  return db.get('SELECT * FROM org WHERE id = ?', [id]);
}

async function ensureAdminRole(orgId) {
  const roles = await listRoles({ orgIds: [orgId] });
  let role = roles.find((r) => r.role_key === 'ADMIN');
  if (!role) role = await createRole({ orgId, roleKey: 'ADMIN', roleName: '集团管理员', description: '全量数据 + 系统管理' });
  const perms = await ensureDefaultPermissions();
  await assignPermissions(role.id, perms.map((p) => p.id));
  return role;
}

async function ensureAdminUser(orgId, roleId) {
  const exists = await getUserWithHash(ADMIN_USERNAME);
  if (exists) {
    await assignRoles(exists.id, [roleId]);
    return { user: exists, created: false };
  }
  const user = await createUser({
    orgId,
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
    realName: '系统管理员',
  });
  await assignRoles(user.id, [roleId]);
  return { user, created: true };
}

(async () => {
  try {
    await createTables();
    await ensureDefaultPermissions();
    const org = await ensureGroupOrg();
    const role = await ensureAdminRole(org.id);
    const { user, created } = await ensureAdminUser(org.id, role.id);
    console.log(
      `[seed] 完成：组织=${org.org_name}(id=${org.id}) 角色=${role.role_key}(id=${role.id}) ` +
        `管理员=${user.username}(${created ? '新建' : '已存在'}) 密码=${created ? ADMIN_PASSWORD : '（沿用原密码）'}`,
    );
    process.exit(0);
  } catch (e) {
    console.error('[seed] 失败:', e.message);
    process.exit(1);
  }
})();
