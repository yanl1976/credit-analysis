import db from '../db.js';

function parseDetail(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// 预警处置状态：待处理 / 处理中 / 已关闭
export const RISK_EVENT_STATUSES = ['OPEN', 'PROCESSING', 'CLOSED'];

// 预警事件列表（按客户归属组织做数据作用域过滤；orgIds=null 表示全量）
export async function listRiskEvents({
  orgIds = null,
  eventType,
  partnerId,
  status,
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
  if (status) {
    where.push('e.status = ?');
    params.push(String(status).toUpperCase());
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
    `SELECT e.*, p.name AS partner_name, p.credit_code AS partner_credit_code, p.owner_org_id,
            u.real_name AS handler_name, u.username AS handler_account
       FROM risk_event e
       LEFT JOIN partner p ON p.id = e.partner_id
       LEFT JOIN sys_user u ON u.id = e.handled_by
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
      status: r.status || 'OPEN',
      handledBy: r.handled_by === null ? null : Number(r.handled_by),
      handledByName: r.handler_name || r.handler_account || null,
      handledAt: r.handled_at,
      handleNote: r.handle_note,
      createdAt: r.created_at,
    })),
    total,
    page: p,
    pageSize: ps,
  };
}

// 单条预警（含客户归属组织，供处置前做数据作用域校验）
export async function getRiskEvent(id) {
  const row = await db.get(
    `SELECT e.*, p.owner_org_id, p.name AS partner_name
       FROM risk_event e LEFT JOIN partner p ON p.id = e.partner_id
      WHERE e.id = ?`,
    [Number(id)],
  );
  return row || null;
}

// 预警处置：改状态 / 写备注 / 记录处理人与时间；置回 OPEN 视为撤销处理
export async function handleRiskEvent(id, { status, note, userId } = {}) {
  const eventId = Number(id);
  const next = String(status || '').toUpperCase();
  if (!RISK_EVENT_STATUSES.includes(next)) {
    // 业务校验错误：由全局错误处理按 400 返回，避免与真正的服务端异常混淆
    throw Object.assign(new Error('无效的处理状态'), { status: 400 });
  }

  const exists = await db.get('SELECT id FROM risk_event WHERE id = ?', [eventId]);
  if (!exists) return null;

  const reopen = next === 'OPEN';
  await db.run(
    `UPDATE risk_event SET status = ?, handled_by = ?, handled_at = ?, handle_note = ? WHERE id = ?`,
    [
      next,
      reopen ? null : Number(userId) || null,
      reopen ? null : new Date(),
      reopen ? null : note ? String(note).slice(0, 500) : null,
      eventId,
    ],
  );
  return getRiskEvent(eventId);
}

// 预警概览：按事件类型、等级与处置状态统计，供看板/预警中心头部使用
export async function riskEventStats({ orgIds = null, days = 30 } = {}) {
  const orgWhere = [];
  const orgParams = [];
  if (Array.isArray(orgIds)) {
    if (!orgIds.length) {
      return { total: 0, byType: [], byGrade: [], byStatus: [], pendingTotal: 0, days: Number(days) || 30 };
    }
    orgWhere.push(`p.owner_org_id IN (${orgIds.map(() => '?').join(',')})`);
    orgParams.push(...orgIds.map(Number));
  }
  const since = new Date(Date.now() - (Number(days) || 30) * 24 * 3600 * 1000);
  const where = [...orgWhere, 'e.created_at >= ?'];
  const params = [...orgParams, since];
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [byType, byGrade, byStatus, pendingRow] = await Promise.all([
    db.all(
      `SELECT e.event_type AS eventType, COUNT(*) AS c
         FROM risk_event e LEFT JOIN partner p ON p.id = e.partner_id
         ${whereSql}
        GROUP BY e.event_type`,
      params,
    ),
    db.all(
      `SELECT e.new_grade AS newGrade, COUNT(*) AS c
         FROM risk_event e LEFT JOIN partner p ON p.id = e.partner_id
         ${whereSql}
        GROUP BY e.new_grade`,
      params,
    ),
    db.all(
      `SELECT e.status AS status, COUNT(*) AS c
         FROM risk_event e LEFT JOIN partner p ON p.id = e.partner_id
         ${whereSql}
        GROUP BY e.status`,
      params,
    ),
    // 待处理口径不限时间窗：只要还没关闭就要一直催办
    db.get(
      `SELECT COUNT(*) AS c
         FROM risk_event e LEFT JOIN partner p ON p.id = e.partner_id
        ${orgWhere.length ? `WHERE ${orgWhere.join(' AND ')} AND` : 'WHERE'} e.status IN ('OPEN', 'PROCESSING')`,
      orgParams,
    ),
  ]);

  const total = byType.reduce((s, r) => s + Number(r.c || 0), 0);
  const statusMap = new Map(byStatus.map((r) => [r.status || 'OPEN', Number(r.c || 0)]));
  return {
    total,
    days: Number(days) || 30,
    byType: byType.map((r) => ({ eventType: r.eventType, count: Number(r.c || 0) })),
    byGrade: byGrade.map((r) => ({ newGrade: r.newGrade, count: Number(r.c || 0) })),
    byStatus: [...statusMap.entries()].map(([status, count]) => ({ status, count })),
    openCount: statusMap.get('OPEN') || 0,
    processingCount: statusMap.get('PROCESSING') || 0,
    closedCount: statusMap.get('CLOSED') || 0,
    pendingTotal: Number(pendingRow?.c || 0),
  };
}
