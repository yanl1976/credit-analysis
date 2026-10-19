import { Router } from 'express';
import * as orgService from '../services/org-service.js';

const router = Router();

// 组织树（必须放在 /:id 之前）
router.get('/tree', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await orgService.buildTree() });
  } catch (e) {
    next(e);
  }
});

router.get('/', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await orgService.listAll() });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { parentId = 0, orgName, orgType } = req.body || {};
    res.json({ code: 0, data: await orgService.createOrg({ parentId, orgName, orgType }) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/descendants', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await orgService.getDescendantIds(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const org = await orgService.getOrg(Number(req.params.id));
    if (!org) return res.status(404).json({ code: 404, message: '组织不存在' });
    res.json({ code: 0, data: org });
  } catch (e) {
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { orgName, orgType } = req.body || {};
    res.json({ code: 0, data: await orgService.updateOrg(Number(req.params.id), { orgName, orgType }) });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    res.json({ code: 0, data: await orgService.deleteOrg(Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

export default router;
