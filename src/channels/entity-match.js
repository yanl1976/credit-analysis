// 企业主体匹配：判断「渠道返回的主体」是否就是「我们要查的主体」，防止把 A 公司的数据挂到 B 公司。
// 优先级：统一社会信用代码 > 企业名称精确 > 曾用名/别名 > 名称核心词近似 + 法定代表人一致 > 判定不匹配
// 关键策略：双方都有信用代码且不一致时，直接判否（宁可漏采，不可错挂）

const FULLWIDTH_BASE = 0xfee0;
const ORG_SUFFIX_RE = /(股份有限公司|有限责任公司|有限公司|集团有限公司|集团|分公司|公司)$/;

export function normalizeCreditCodeLoose(code) {
  if (!code) return '';
  return String(code).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

// 名称归一：去括号注释、全角转半角、去空白与标点
export function normalizeCompanyName(name) {
  if (!name) return '';
  let s = String(name).trim();
  s = s.replace(/[（(][^）)]*[）)]/g, '');
  s = s.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - FULLWIDTH_BASE));
  s = s.replace(/[\s·•・.,，。、\-—_/\\]/g, '');
  return s;
}

// 名称核心词：反复剥离组织形式后缀（"XX集团有限公司" → "XX"）
export function companyCore(name) {
  let s = normalizeCompanyName(name);
  let prev = null;
  while (s && s !== prev) {
    prev = s;
    s = s.replace(ORG_SUFFIX_RE, '');
  }
  return s;
}

/**
 * @param {{name?:string, creditCode?:string, legalPerson?:string}} target 我方已知主体
 * @param {{name?:string, creditCode?:string, legalPerson?:string, historyNames?:string[]}} candidate 渠道返回主体
 * @returns {{matched:boolean, level:'credit_code'|'name'|'alias'|'probable'|'ambiguous'|'none', reason:string}}
 */
export function matchCompany(target = {}, candidate = {}) {
  const tCode = normalizeCreditCodeLoose(target.creditCode);
  const cCode = normalizeCreditCodeLoose(candidate.creditCode);
  if (tCode && cCode) {
    if (tCode === cCode) return { matched: true, level: 'credit_code', reason: '统一社会信用代码一致' };
    return { matched: false, level: 'none', reason: `信用代码不一致（${tCode} ≠ ${cCode}）` };
  }

  const tName = normalizeCompanyName(target.name);
  const cName = normalizeCompanyName(candidate.name);
  if (tName && cName && tName === cName) return { matched: true, level: 'name', reason: '企业名称一致' };

  const history = Array.isArray(candidate.historyNames) ? candidate.historyNames : [];
  for (const h of history) {
    if (tName && normalizeCompanyName(h) === tName) {
      return { matched: true, level: 'alias', reason: `命中曾用名：${h}` };
    }
  }

  const tCore = companyCore(target.name);
  const cCore = companyCore(candidate.name);

  // 核心词完全一致（仅「（集团）」括号、集团字样、组织形式写法不同）→ 视为同一主体
  // 加长度门槛，避免 "XX" 这类过短核心词把无关公司判成同一家
  if (tCore && cCore && tCore === cCore && tCore.length >= 4) {
    return { matched: true, level: 'name', reason: '企业名称核心词一致（仅组织形式/集团字样不同）' };
  }

  const near = Boolean(tCore && cCore && (tCore === cCore || tCore.includes(cCore) || cCore.includes(tCore)));
  const tLegal = String(target.legalPerson || '').trim();
  const cLegal = String(candidate.legalPerson || '').trim();

  if (near && tLegal && cLegal) {
    if (tLegal === cLegal) return { matched: true, level: 'probable', reason: `名称近似且法定代表人一致（${tLegal}）` };
    return { matched: false, level: 'none', reason: `名称近似但法定代表人不一致（${tLegal} ≠ ${cLegal}）` };
  }
  if (near) return { matched: false, level: 'ambiguous', reason: '名称近似但缺信用代码/法定代表人，无法确证' };
  return { matched: false, level: 'none', reason: '企业名称不匹配' };
}

// 名称转检索关键词时去掉括号注释，避免检索噪声
export function searchableName(name) {
  return String(name || '').replace(/[（(][^）)]*[）)]/g, '').trim();
}
