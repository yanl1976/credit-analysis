import { Router } from 'express';
import * as roleService from '../services/role-service.js';

const router = Router();

function parseOrgIds(q) {
  if (!q) return undefined;
  const arr = String(q).split(',').map(Number).filter((n) => !Number.isNaN(n) && n > 0);
  return arr.length ? arr : undefined;
}

router.get('/', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await roleService.listRoles({ orgIds: parseOrgIds(req.query.orgIds) }) });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await roleService.createRole(req.body || {}) });
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
    const { permissionIds = [] } = req.body || {};
    res.json({ code: 0, data: await roleService.assignPermissions(Number(req.params.id), permissionIds) });
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
    res.json({ code: 0, data: await roleService.updateRole(Number(req.params.id), req.body || {}) });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await roleService.deleteRole(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

export default router;
