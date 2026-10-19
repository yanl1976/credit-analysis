import { Router } from 'express';
import * as userService from '../services/user-service.js';

const router = Router();

function parseOrgIds(q) {
  if (!q) return undefined;
  const arr = String(q).split(',').map(Number).filter((n) => !Number.isNaN(n) && n > 0);
  return arr.length ? arr : undefined;
}

router.get('/', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await userService.listUsers({ orgIds: parseOrgIds(req.query.orgIds) }) });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await userService.createUser(req.body || {}) });
  } catch (e) {
    next(e);
  }
});

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
    res.json({ code: 0, data: await userService.assignRoles(Number(req.params.id), roleIds) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const user = await userService.getUser(Number(req.params.id));
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
    res.json({ code: 0, data: user });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await userService.updateUser(Number(req.params.id), req.body || {}) });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await userService.deleteUser(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

export default router;
