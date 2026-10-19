import db from '../db.js';

function parseDetail(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// 预警事件列表（按客户归属组织做数据作用域过滤；orgIds=null 表示全量）
export async function listRiskEvents({
  orgIds = null,
  eventType,
  partnerId,
  startDate,
  endDate,
  page = 1,
  pageSize = 20,
} = {}) {
  const where = [];
  const params = [];

  if (Array.isArray(orgIds)) {
    if (!orgIds.length) return { items: [], total: 0, page: 1, pageSize: Number(pageSize) || 20 };
    where.push(`p.owner_org_id IN (${orgIds.map(() => '?').join(',')})`);
    params.push(...orgIds.map(Number));
  }
  if (eventType) {
    where.push('e.event_type = ?');
    params.push(String(eventType));
  }
  if (partnerId) {
    where.push('e.partner_id = ?');
    params.push(Number(partnerId));
  }
  if (startDate) {
    where.push('e.created_at >= ?');
    params.push(startDate);
  }
  if (endDate) {
    where.push('e.created_at <= ?');
    params.push(endDate);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await db.get(
    `SELECT COUNT(*) AS c FROM risk_event e LEFT JOIN partner p ON p.id = e.partner_id ${whereSql}`,
    params,
  );
  const total = Number(totalRow?.c || 0);

  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const rows = await db.all(
    `SELECT e.*, p.name AS partner_name, p.credit_code AS partner_credit_code, p.owner_org_id
       FROM risk_event e
       LEFT JOIN partner p ON p.id = e.partner_id
       ${whereSql}
      ORDER BY e.id DESC
      LIMIT ? OFFSET ?`,
    [...params, ps, (p - 1) * ps],
  );

  return {
    items: rows.map((r) => ({
      id: Number(r.id),
      partnerId: Number(r.partner_id),
      partnerName: r.partner_name,
      partnerCreditCode: r.partner_credit_code,
      ownerOrgId: r.owner_org_id === null ? null : Number(r.owner_org_id),
      eventType: r.event_type,
      oldGrade: r.old_grade,
      newGrade: r.new_grade,
      detail: parseDetail(r.detail),
      createdAt: r.created_at,
    })),
    total,
    page: p,
    pageSize: ps,
  };
}

// 预警概览：按事件类型与近 N 天统计，供看板/预警中心头部使用
export async function riskEventStats({ orgIds = null, days = 30 } = {}) {
  const where = [];
  const params = [];
  if (Array.isArray(orgIds)) {
    if (!orgIds.length) return { total: 0, byType: [], byGrade: [], days: Number(days) || 30 };
    where.push(`p.owner_org_id IN (${orgIds.map(() => '?').join(',')})`);
    params.push(...orgIds.map(Number));
  }
  const since = new Date(Date.now() - (Number(days) || 30) * 24 * 3600 * 1000);
  where.push('e.created_at >= ?');
  params.push(since);
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const byType = await db.all(
    `SELECT e.event_type AS eventType, COUNT(*) AS c
       FROM risk_event e LEFT JOIN partner p ON p.id = e.partner_id
       ${whereSql}
      GROUP BY e.event_type`,
    params,
  );
  const byGrade = await db.all(
    `SELECT e.new_grade AS newGrade, COUNT(*) AS c
       FROM risk_event e LEFT JOIN partner p ON p.id = e.partner_id
       ${whereSql}
      GROUP BY e.new_grade`,
    params,
  );

  const total = byType.reduce((s, r) => s + Number(r.c || 0), 0);
  return {
    total,
    days: Number(days) || 30,
    byType: byType.map((r) => ({ eventType: r.eventType, count: Number(r.c || 0) })),
    byGrade: byGrade.map((r) => ({ newGrade: r.newGrade, count: Number(r.c || 0) })),
  };
}
