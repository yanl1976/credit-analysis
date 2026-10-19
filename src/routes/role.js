import { Router } from 'express';
import * as roleService from '../services/role-service.js';
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
    res.json({ code: 0, data: await roleService.listRolesWithStats({ orgIds: req.scope.orgIds }) });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!inScope(req.scope, body.orgId)) {
      return res.status(403).json({ code: 403, message: '无权在该组织下创建角色' });
    }
    const role = await roleService.createRole(body);
    if (Array.isArray(body.permissionIds) && body.permissionIds.length) {
      await roleService.assignPermissions(role.id, body.permissionIds);
    }
    res.json({ code: 0, data: role });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/permissions', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await roleService.getRolePermissions(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

router.put('/:id/permissions', async (req, res, next) => {
  try {
    const role = await roleService.getRole(Number(req.params.id));
    if (!role) return res.status(404).json({ code: 404, message: '角色不存在' });
    if (!inScope(req.scope, role.org_id)) return res.status(403).json({ code: 403, message: '无权配置该角色' });
    const { permissionIds = [] } = req.body || {};
    res.json({ code: 0, data: await roleService.assignPermissions(role.id, permissionIds) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const role = await roleService.getRole(Number(req.params.id));
    if (!role) return res.status(404).json({ code: 404, message: '角色不存在' });
    res.json({ code: 0, data: role });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const role = await roleService.getRole(Number(req.params.id));
    if (!role) return res.status(404).json({ code: 404, message: '角色不存在' });
    if (!inScope(req.scope, role.org_id)) return res.status(403).json({ code: 403, message: '无权修改该角色' });
    res.json({ code: 0, data: await roleService.updateRole(role.id, req.body || {}) });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const role = await roleService.getRole(Number(req.params.id));
    if (!role) return res.status(404).json({ code: 404, message: '角色不存在' });
    if (!inScope(req.scope, role.org_id)) return res.status(403).json({ code: 403, message: '无权删除该角色' });
    if (role.role_key === 'ADMIN') {
      return res.status(400).json({ code: 400, message: '管理员角色不允许删除' });
    }
    res.json({ code: 0, data: await roleService.deleteRole(role.id) });
  } catch (e) {
    next(e);
  }
});

export default router;
