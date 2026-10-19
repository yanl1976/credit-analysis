import { Router } from 'express';
import * as userService from '../services/user-service.js';
import { listRoles } from '../services/role-service.js';
import { authenticate } from '../middleware/auth.js';
import { dataScope } from '../middleware/data-scope.js';
import { requirePerm } from '../middleware/permission.js';

const router = Router();

router.use(authenticate, dataScope, requirePerm('system:manage'));

function inScope(scope, orgId) {
  if (!scope) return false;
  if (scope.isFull) return true;
  return Array.isArray(scope.orgIds) && scope.orgIds.includes(Number(orgId));
}

router.get('/', async (req, res, next) => {
  try {
    res.json({
      code: 0,
      data: await userService.listUsersWithRoles({
        orgIds: req.scope.orgIds,
        keyword: req.query.keyword,
      }),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!inScope(req.scope, body.orgId)) {
      return res.status(403).json({ code: 403, message: '无权在该组织下创建用户' });
    }
    const user = await userService.createUser(body);
    if (Array.isArray(body.roleIds) && body.roleIds.length) {
      await assertRolesInScope(req.scope, body.roleIds);
      await userService.assignRoles(user.id, body.roleIds);
    }
    res.json({ code: 0, data: user });
  } catch (e) {
    next(e);
  }
});

async function assertRolesInScope(scope, roleIds) {
  const all = await listRoles({ orgIds: scope.isFull ? undefined : scope.orgIds });
  const ok = new Set(all.map((r) => Number(r.id)));
  const bad = roleIds.map(Number).filter((id) => !ok.has(id));
  if (bad.length) throw new Error(`角色不存在或无权分配: ${bad.join(',')}`);
}

router.get('/:id/roles', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await userService.getUserRoles(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

router.put('/:id/roles', async (req, res, next) => {
  try {
    const { roleIds = [] } = req.body || {};
    await assertRolesInScope(req.scope, roleIds);
    res.json({ code: 0, data: await userService.assignRoles(Number(req.params.id), roleIds) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const user = await userService.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
    if (!inScope(req.scope, user.org_id)) return res.status(403).json({ code: 403, message: '无权访问该用户' });
    res.json({ code: 0, data: user });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const user = await userService.getUser(id);
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
    if (!inScope(req.scope, user.org_id)) return res.status(403).json({ code: 403, message: '无权修改该用户' });
    const body = req.body || {};
    if (body.orgId !== undefined && !inScope(req.scope, body.orgId)) {
      return res.status(403).json({ code: 403, message: '无权迁移到该组织' });
    }
    res.json({ code: 0, data: await userService.updateUser(id, body) });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const user = await userService.getUser(id);
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
    if (!inScope(req.scope, user.org_id)) return res.status(403).json({ code: 403, message: '无权删除该用户' });
    if (id === Number(req.user.sub)) {
      return res.status(400).json({ code: 400, message: '不能删除当前登录账号' });
    }
    res.json({ code: 0, data: await userService.deleteUser(id) });
  } catch (e) {
    next(e);
  }
});

export default router;
