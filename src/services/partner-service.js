import db from '../db.js';
import { normalizeCreditCode } from './entity-resolve.js';
import { getSetting } from './setting-service.js';

const now = () => new Date();

// 准入状态（风险名单）：normal 正常 / watch 关注 / key 重点监控 / blacklist 黑名单
export const ADMISSION_STATUSES = ['NORMAL', 'WATCH', 'KEY', 'BLACKLIST'];
export const ADMISSION_LABELS = {
  NORMAL: '正常',
  WATCH: '关注',
  KEY: '重点监控',
  BLACKLIST: '黑名单',
};

// 复审状态：逾期 / 临期 / 未排期 / 已排期（未到期）
export const REVIEW_STATUSES = ['overdue', 'dueSoon', 'unscheduled', 'scheduled'];

export function normalizeAdmissionStatus(value) {
  const s = String(value || '').toUpperCase();
  return ADMISSION_STATUSES.includes(s) ? s : null;
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('日期格式应为 YYYY-MM-DD');
  return s;
}

export async function getReviewWarnDays() {
  const n = Number(await getSetting('review.dueSoonDays', 14));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 14;
}

// 列表 / 导出 / 上下条共用的筛选条件（作用域 + 检索词 + 准入状态 + 复审状态）
async function buildPartnerWhere({ orgIds, keyword, admissionStatus, reviewStatus, dueSoonDays } = {}) {
  const where = [];
  const params = [];
  if (Array.isArray(orgIds)) {
    if (!orgIds.length) return { sql: 'WHERE 1 = 0', params: [], empty: true };
    where.push(`p.owner_org_id IN (${orgIds.map(() => '?').join(',')})`);
    params.push(...orgIds.map(Number));
  }
  if (keyword) {
    where.push('(p.name LIKE ? OR p.credit_code LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const admission = normalizeAdmissionStatus(admissionStatus);
  if (admission) {
    where.push('p.admission_status = ?');
    params.push(admission);
  }
  const review = String(reviewStatus || '').trim();
  if (REVIEW_STATUSES.includes(review)) {
    const days = Number(dueSoonDays) > 0 ? Math.round(Number(dueSoonDays)) : await getReviewWarnDays();
    if (review === 'overdue') {
      where.push('p.next_review_date IS NOT NULL AND p.next_review_date < CURDATE()');
    } else if (review === 'dueSoon') {
      where.push('p.next_review_date IS NOT NULL AND p.next_review_date >= CURDATE()');
      where.push('p.next_review_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)');
      params.push(days);
    } else if (review === 'unscheduled') {
      where.push('p.next_review_date IS NULL');
    } else {
      where.push('p.next_review_date > DATE_ADD(CURDATE(), INTERVAL ? DAY)');
      params.push(days);
    }
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params, empty: false };
}

export async function getPartner(id) {
  return db.get('SELECT * FROM partner WHERE id = ?', [id]);
}

// 单客户详情（带归属组织名、当前评分与复审状态），报告页与报告导出共用
export async function getPartnerDetail(id) {
  const days = await getReviewWarnDays();
  return db.get(
    `SELECT p.*, o.org_name,
            r.score AS rating_score, r.grade AS rating_grade, r.risk_level AS rating_risk_level,
            r.veto AS rating_veto, r.reasons AS rating_reasons,
            r.calc_version AS rating_calc_version, r.calculated_at AS rating_calculated_at,
            ${REVIEW_CASE_SQL}
       FROM partner p
       LEFT JOIN org o ON o.id = p.owner_org_id
       LEFT JOIN partner_rating r ON r.partner_id = p.id
      WHERE p.id = ?`,
    [days, Number(id)],
  );
}

export async function getPartnerByCreditCode(creditCode) {
  const code = normalizeCreditCode(creditCode);
  if (!code) return null;
  return db.get('SELECT * FROM partner WHERE credit_code = ?', [code]);
}

// 复审状态派生列（与前端标签一一对应）：未排期 / 逾期 / 临期 / 已排期
const REVIEW_CASE_SQL = `CASE
    WHEN p.next_review_date IS NULL THEN 'unscheduled'
    WHEN p.next_review_date < CURDATE() THEN 'overdue'
    WHEN p.next_review_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY) THEN 'dueSoon'
    ELSE 'scheduled'
  END AS review_status,
  DATEDIFF(p.next_review_date, CURDATE()) AS review_days_left`;

export async function listPartners({
  orgIds,
  keyword,
  admissionStatus,
  reviewStatus,
  dueSoonDays,
  page = 1,
  pageSize = 20,
} = {}) {
  const w = await buildPartnerWhere({ orgIds, keyword, admissionStatus, reviewStatus, dueSoonDays });
  const days = Number(dueSoonDays) > 0 ? Math.round(Number(dueSoonDays)) : await getReviewWarnDays();
  const totalRow = await db.get(`SELECT COUNT(*) AS c FROM partner p ${w.sql}`, w.params);
  const total = Number(totalRow?.c || 0);

  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
  // 列表直接带出当前评分（信用评分列），未评分客户 rating_* 为 NULL
  const items = w.empty
    ? []
    : await db.all(
        `SELECT p.*,
                r.score AS rating_score,
                r.grade AS rating_grade,
                r.risk_level AS rating_risk_level,
                r.veto AS rating_veto,
                r.calculated_at AS rating_calculated_at,
                ${REVIEW_CASE_SQL}
           FROM partner p
           LEFT JOIN partner_rating r ON r.partner_id = p.id
           ${w.sql}
          ORDER BY p.id DESC LIMIT ? OFFSET ?`,
        [days, ...w.params, ps, (p - 1) * ps],
      );
  return { items, total, page: p, pageSize: ps, reviewWarnDays: days };
}

// 准入状态分布（风险名单汇总）
export async function getAdmissionStats({ orgIds } = {}) {
  const where = [];
  const params = [];
  if (Array.isArray(orgIds)) {
    if (!orgIds.length) return { total: 0, items: ADMISSION_STATUSES.map((s) => ({ status: s, count: 0 })) };
    where.push(`p.owner_org_id IN (${orgIds.map(() => '?').join(',')})`);
    params.push(...orgIds.map(Number));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.all(
    `SELECT p.admission_status AS status, COUNT(*) AS c FROM partner p ${whereSql} GROUP BY p.admission_status`,
    params,
  );
  const map = new Map(rows.map((r) => [r.status || 'NORMAL', Number(r.c || 0)]));
  return {
    total: [...map.values()].reduce((a, b) => a + b, 0),
    items: ADMISSION_STATUSES.map((s) => ({ status: s, label: ADMISSION_LABELS[s], count: map.get(s) || 0 })),
  };
}

// 定期复审统计：逾期 / 临期 / 未排期（临期天数由设置项 review.dueSoonDays 决定）
export async function getReviewStats({ orgIds, dueSoonDays } = {}) {
  const where = [];
  const params = [];
  if (Array.isArray(orgIds)) {
    if (!orgIds.length) {
      return { total: 0, overdue: 0, dueSoon: 0, unscheduled: 0, scheduled: 0, warnDays: 14 };
    }
    where.push(`p.owner_org_id IN (${orgIds.map(() => '?').join(',')})`);
    params.push(...orgIds.map(Number));
  }
  const days = Number(dueSoonDays) > 0 ? Math.round(Number(dueSoonDays)) : await getReviewWarnDays();
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const row = await db.get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN p.next_review_date IS NOT NULL AND p.next_review_date < CURDATE() THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN p.next_review_date IS NOT NULL AND p.next_review_date >= CURDATE()
                 AND p.next_review_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY) THEN 1 ELSE 0 END) AS dueSoon,
       SUM(CASE WHEN p.next_review_date IS NULL THEN 1 ELSE 0 END) AS unscheduled
     FROM partner p ${whereSql}`,
    [days, ...params],
  );
  const total = Number(row?.total || 0);
  const overdue = Number(row?.overdue || 0);
  const dueSoon = Number(row?.dueSoon || 0);
  const unscheduled = Number(row?.unscheduled || 0);
  return {
    total,
    overdue,
    dueSoon,
    unscheduled,
    scheduled: Math.max(0, total - overdue - dueSoon - unscheduled),
    warnDays: days,
  };
}

// 评分完成后自动排下次复审（仅当客户尚未排期，尊重手工设置）
export async function ensureNextReviewDate(partnerId, cycleDays) {
  const n = Number(cycleDays) > 0 ? Math.round(Number(cycleDays)) : 90;
  await db.run(
    `UPDATE partner SET next_review_date = DATE_ADD(CURDATE(), INTERVAL ? DAY)
      WHERE id = ? AND next_review_date IS NULL`,
    [n, Number(partnerId)],
  );
}

// 客户清单导出用：不分页，带上组织名与评分（CSV 由路由层拼装）
export async function listPartnersForExport({
  orgIds,
  keyword,
  admissionStatus,
  reviewStatus,
  dueSoonDays,
  limit = 5000,
} = {}) {
  const w = await buildPartnerWhere({ orgIds, keyword, admissionStatus, reviewStatus, dueSoonDays });
  if (w.empty) return { items: [], total: 0, truncated: false };
  const days = Number(dueSoonDays) > 0 ? Math.round(Number(dueSoonDays)) : await getReviewWarnDays();
  const max = Math.min(20000, Math.max(1, Number(limit) || 5000));
  const totalRow = await db.get(`SELECT COUNT(*) AS c FROM partner p ${w.sql}`, w.params);
  const total = Number(totalRow?.c || 0);
  const items = await db.all(
    `SELECT p.*, o.org_name,
            r.score AS rating_score, r.grade AS rating_grade, r.risk_level AS rating_risk_level,
            r.calculated_at AS rating_calculated_at,
            ${REVIEW_CASE_SQL}
       FROM partner p
       LEFT JOIN partner_rating r ON r.partner_id = p.id
       LEFT JOIN org o ON o.id = p.owner_org_id
       ${w.sql}
      ORDER BY p.id DESC LIMIT ?`,
    [days, ...w.params, max],
  );
  return { items, total, truncated: total > items.length };
}

// 资信报告「上一条 / 下一条」：沿用客户列表顺序（id DESC，最新在前），作用域与列表一致
// prev = 列表中更靠前的那条（id 比当前大的最小 id）；next = 列表中后一条（id 比当前小的最大 id）
export async function getNeighborPartners(
  id,
  { orgIds, keyword, admissionStatus, reviewStatus, dueSoonDays } = {},
) {
  const w = await buildPartnerWhere({ orgIds, keyword, admissionStatus, reviewStatus, dueSoonDays });
  const params = w.params;
  const whereSql = w.sql;
  const andSql = w.sql ? `AND ${w.sql.replace(/^WHERE /, '')}` : '';

  const [rows, totalRow, beforeRow] = await Promise.all([
    db.all(
      `(SELECT p.id, p.name, 'prev' AS dir FROM partner p WHERE p.id > ? ${andSql} ORDER BY p.id ASC LIMIT 1)
       UNION ALL
       (SELECT p.id, p.name, 'next' AS dir FROM partner p WHERE p.id < ? ${andSql} ORDER BY p.id DESC LIMIT 1)`,
      // 占位符顺序：p.id 在前，andSql 里的作用域/检索词在后（每个分支各一组）
      [id, ...params, id, ...params],
    ),
    db.get(`SELECT COUNT(*) AS c FROM partner p ${whereSql}`, params),
    db.get(`SELECT COUNT(*) AS c FROM partner p ${whereSql ? `${whereSql} AND` : 'WHERE'} p.id > ?`, [...params, id]),
  ]);

  const pick = (dir) => rows.find((r) => r.dir === dir) || null;
  return {
    prev: pick('prev'),
    next: pick('next'),
    index: Number(beforeRow?.c || 0) + 1, // 当前客户在列表中的序号（1 起）
    total: Number(totalRow?.c || 0),
  };
}

// 创建客户：按 credit_code 归一，若已存在直接返回已有记录（_normalized=true）
export async function createPartner({
  ownerOrgId,
  creditCode,
  name,
  legalPerson,
  regStatus,
  province,
  industry,
  aliasNames,
  dataSource,
  admissionStatus,
}) {
  if (!name || !String(name).trim()) throw new Error('name 必填');
  const code = normalizeCreditCode(creditCode);

  if (code) {
    const exists = await getPartnerByCreditCode(code);
    if (exists) return { ...exists, _normalized: true };
  }

  const source = ['manual', 'demo', 'channel', 'ai'].includes(dataSource) ? dataSource : 'manual';
  const admission = normalizeAdmissionStatus(admissionStatus) || 'NORMAL';
  const r = await db.run(
    `INSERT INTO partner
      (owner_org_id, credit_code, name, alias_names, legal_person, reg_status, province, industry,
       admission_status, data_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(ownerOrgId) || 0,
      code,
      String(name).trim(),
      aliasNames ? JSON.stringify(aliasNames) : null,
      legalPerson || null,
      regStatus || null,
      province || null,
      industry || null,
      admission,
      source,
      now(),
      now(),
    ],
  );
  const createdId = Number(r.lastInsertRowid);
  // 新客户按复审周期自动排期（设置项 review.cycleDays，默认 90 天）
  await ensureNextReviewDate(createdId, await getSetting('review.cycleDays', 90));
  return { ...(await getPartner(createdId)), _normalized: false };
}

export async function updatePartner(id, fields = {}) {
  const partner = await getPartner(id);
  if (!partner) throw new Error('客户不存在');

  const map = {
    name: 'name',
    legalPerson: 'legal_person',
    regStatus: 'reg_status',
    province: 'province',
    industry: 'industry',
  };
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(map)) {
    if (fields[key] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(fields[key]);
    }
  }
  if (fields.admissionStatus !== undefined) {
    const admission = normalizeAdmissionStatus(fields.admissionStatus);
    if (!admission) throw Object.assign(new Error('无效的准入状态'), { status: 400 });
    sets.push('admission_status = ?');
    params.push(admission);
  }
  if (fields.nextReviewDate !== undefined) {
    sets.push('next_review_date = ?');
    params.push(normalizeDate(fields.nextReviewDate));
  }
  if (fields.aliasNames !== undefined) {
    sets.push('alias_names = ?');
    params.push(fields.aliasNames ? JSON.stringify(fields.aliasNames) : null);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    params.push(now());
    params.push(Number(id));
    await db.run(`UPDATE partner SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getPartner(Number(id));
}

export async function deletePartner(id) {
  const partner = await getPartner(id);
  if (!partner) throw new Error('客户不存在');
  await db.run('DELETE FROM partner_judicial WHERE partner_id = ?', [id]);
  await db.run('DELETE FROM partner_credit WHERE partner_id = ?', [id]);
  await db.run('DELETE FROM partner_finance WHERE partner_id = ?', [id]);
  await db.run('DELETE FROM partner_raw WHERE partner_id = ?', [id]);
  await db.run('DELETE FROM partner_rating WHERE partner_id = ?', [id]);
  await db.run('DELETE FROM partner_rating_history WHERE partner_id = ?', [id]);
  await db.run('DELETE FROM risk_event WHERE partner_id = ?', [id]);
  await db.run('DELETE FROM fetch_task WHERE partner_id = ?', [id]);
  await db.run('DELETE FROM partner WHERE id = ?', [id]);
  return { deleted: true };
}
