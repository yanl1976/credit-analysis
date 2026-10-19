import db from '../db.js';

// 统一社会信用代码归一：去空白、转大写
export function normalizeCreditCode(code) {
  if (!code) return null;
  return String(code).replace(/\s+/g, '').toUpperCase();
}

// 实体解析：优先按统一社会信用代码，名称仅作兜底
export async function findExisting({ creditCode, name }) {
  const code = normalizeCreditCode(creditCode);
  if (code) {
    const byCode = await db.get('SELECT * FROM partner WHERE credit_code = ?', [code]);
    if (byCode) return { partner: byCode, matchedBy: 'credit_code' };
  }
  if (name) {
    const byName = await db.get('SELECT * FROM partner WHERE name = ?', [String(name).trim()]);
    if (byName) return { partner: byName, matchedBy: 'name' };
  }
  return null;
}
