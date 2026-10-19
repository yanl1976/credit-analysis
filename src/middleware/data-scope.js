import { getOrg, getDescendantIds } from '../services/org-service.js';

// 数据作用域：
//  - 集团管理员（org_type=GROUP 且角色含 ADMIN）→ 全量可见（orgIds=null）
//  - 其他用户（含子公司管理员）→ 仅本组织及下级（orgIds=[本组织+子树]）
// 业务查询用 req.scope.orgIds 过滤 partner.owner_org_id（null 表示不过滤）。
export async function dataScope(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ code: 401, message: '未登录' });

    const orgId = Number(req.user.orgId);
    const org = await getOrg(orgId);
    if (!org) return res.status(403).json({ code: 403, message: '用户所属组织不存在' });

    const isAdmin = Array.isArray(req.user.roles) && req.user.roles.includes('ADMIN');
    const isGroup = org.org_type === 'GROUP';
    const isFull = isAdmin && isGroup;

    const orgIds = isFull ? null : await getDescendantIds(orgId);

    req.scope = {
      isFull,
      orgIds,
      orgId,
      orgType: org.org_type,
      isAdmin,
    };
    return next();
  } catch (e) {
    return next(e);
  }
}
