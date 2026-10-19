import { Router } from 'express';
import * as orgService from '../services/org-service.js';
import { authenticate } from '../middleware/auth.js';
import { dataScope } from '../middleware/data-scope.js';
import { requirePerm } from '../middleware/permission.js';

const router = Router();

router.use(authenticate);

function inScope(scope, orgId) {
  if (!scope) return false;
  if (scope.isFull) return true;
  return Array.isArray(scope.orgIds) && scope.orgIds.includes(Number(orgId));
}

// 组织树/列表：登录用户可读（客户页归属组织下拉需要）
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

// 新建：system:manage；子公司只能在自己的组织子树内建下级
router.post('/', requirePerm('system:manage'), dataScope, async (req, res, next) => {
  try {
    const { parentId = 0, orgName, orgType } = req.body || {};
    const pid = Number(parentId) || 0;
    if (!req.scope.isFull) {
      const target = pid || Number(req.user.orgId);
      if (!inScope(req.scope, target)) {
        return res.status(403).json({ code: 403, message: '无权在该组织下创建子组织' });
      }
      res.json({ code: 0, data: await orgService.createOrg({ parentId: target, orgName, orgType }) });
      return;
    }
    res.json({ code: 0, data: await orgService.createOrg({ parentId: pid, orgName, orgType }) });
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

router.put('/:id', requirePerm('system:manage'), dataScope, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!inScope(req.scope, id)) return res.status(403).json({ code: 403, message: '无权修改该组织' });
    const { orgName, orgType } = req.body || {};
    res.json({ code: 0, data: await orgService.updateOrg(id, { orgName, orgType }) });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requirePerm('system:manage'), dataScope, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!inScope(req.scope, id)) return res.status(403).json({ code: 403, message: '无权删除该组织' });
    res.json({ code: 0, data: await orgService.deleteOrg(id) });
  } catch (e) {
    next(e);
  }
});

export default router;
