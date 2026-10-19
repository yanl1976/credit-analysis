import db from '../db.js';
import { normalizeCreditCode } from './entity-resolve.js';

const now = () => new Date();

export async function getPartner(id) {
  return db.get('SELECT * FROM partner WHERE id = ?', [id]);
}

export async function getPartnerByCreditCode(creditCode) {
  const code = normalizeCreditCode(creditCode);
  if (!code) return null;
  return db.get('SELECT * FROM partner WHERE credit_code = ?', [code]);
}

export async function listPartners({ orgIds, keyword, page = 1, pageSize = 20 } = {}) {
  const where = [];
  const params = [];
  if (orgIds && orgIds.length) {
    where.push(`owner_org_id IN (${orgIds.map(() => '?').join(',')})`);
    params.push(...orgIds.map(Number));
  }
  if (keyword) {
    where.push('(name LIKE ? OR credit_code LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = await db.get(`SELECT COUNT(*) AS c FROM partner ${whereSql}`, params);
  const total = Number(totalRow?.c || 0);

  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const items = await db.all(
    `SELECT * FROM partner ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, ps, (p - 1) * ps],
  );
  return { items, total, page: p, pageSize: ps };
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
}) {
  if (!name || !String(name).trim()) throw new Error('name 必填');
  const code = normalizeCreditCode(creditCode);

  if (code) {
    const exists = await getPartnerByCreditCode(code);
    if (exists) return { ...exists, _normalized: true };
  }

  const source = ['manual', 'demo', 'channel'].includes(dataSource) ? dataSource : 'manual';
  const r = await db.run(
    `INSERT INTO partner
      (owner_org_id, credit_code, name, alias_names, legal_person, reg_status, province, industry, data_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(ownerOrgId) || 0,
      code,
      String(name).trim(),
      aliasNames ? JSON.stringify(aliasNames) : null,
      legalPerson || null,
      regStatus || null,
      province || null,
      industry || null,
      source,
      now(),
      now(),
    ],
  );
  return { ...(await getPartner(Number(r.lastInsertRowid))), _normalized: false };
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
