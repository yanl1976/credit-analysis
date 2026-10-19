// 天眼AI 明细在报告页的聚合与解读（纯函数，便于离线验证）
// 只统计 data_source = 'tyc_mcp' 的行：手工录入 / 渠道 API / AI 推断的记录不混进来，
// 否则「天眼AI 明细」的口径会被其他来源污染。
export const TYC_SOURCE = 'tyc_mcp';

// 判定顺序即优先级：'失信被执行人' 也含「执行」，必须先命中失信，否则被执行条数虚高
const JUDICIAL_RULES = [
  { key: 'dishonest', label: '失信被执行人', note: '一票否决', test: (t) => /失信/.test(t) },
  { key: 'limit', label: '限制高消费', note: '一票否决', test: (t) => /限高/.test(t) },
  { key: 'bankrupt', label: '破产重整', note: '一票否决', test: (t) => /破产|重整/.test(t) },
  { key: 'docs', label: '裁判文书', note: '被告未结才扣分', test: (t) => /裁判/.test(t) },
  { key: 'executed', label: '被执行', note: '按金额档位扣分', test: (t) => /执行/.test(t) },
];

const CREDIT_RULES = [
  { key: 'abnormal', label: '经营异常', note: '每条 -8', test: (t) => /经营异常/.test(t) },
  { key: 'serious', label: '严重违法', note: '每条 -15', test: (t) => /严重违法/.test(t) },
  { key: 'penalty', label: '行政处罚', note: '每条 -5', test: (t) => /行政处罚/.test(t) },
  { key: 'tax', label: '税收违法', note: '每条 -10', test: (t) => /税收/.test(t) },
  { key: 'arrears', label: '欠税公告', note: '仅展示，不扣分', test: (t) => /欠税/.test(t) },
];

export function summarizeTycRisk(judicial = [], credit = []) {
  const items = [
    ...JUDICIAL_RULES.map((r) => ({ key: r.key, label: r.label, note: r.note, dimension: 'judicial', count: 0, amount: 0, lastDate: null })),
    ...CREDIT_RULES.map((r) => ({ key: r.key, label: r.label, note: r.note, dimension: 'credit', count: 0, amount: 0, lastDate: null })),
  ];
  const byKey = new Map(items.map((i) => [i.key, i]));

  let total = 0;
  const absorb = (rule, row, type) => {
    if (!rule) return;
    const b = byKey.get(rule.key);
    b.count += 1;
    total += 1;
    b.amount += Number(row.amount || 0) || 0;
    const d = row.date ? String(row.date).slice(0, 10) : null;
    if (d && (!b.lastDate || d > b.lastDate)) b.lastDate = d;
  };

  for (const row of judicial || []) {
    if (row?.data_source !== TYC_SOURCE) continue;
    const type = String(row.case_type || '');
    absorb(JUDICIAL_RULES.find((r) => r.test(type)), row, type);
  }
  for (const row of credit || []) {
    if (row?.data_source !== TYC_SOURCE) continue;
    const type = String(row.item_type || '');
    absorb(CREDIT_RULES.find((r) => r.test(type)), row, type);
  }

  const sum = (dim) => items.filter((i) => i.dimension === dim).reduce((s, i) => s + i.count, 0);
  return {
    items,
    total,
    judicialTotal: sum('judicial'),
    creditTotal: sum('credit'),
    executedAmount: byKey.get('executed')?.amount || 0,
    hasData: total > 0,
  };
}

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);

// 与 scoring-service.computeFiscalMetrics 同一口径（EBIT = 利润总额 + 利息费用）
function deriveMetrics(fiscal) {
  const bs = fiscal?.bs || {};
  const is = fiscal?.is || {};
  const cf = fiscal?.cf || {};
  const totalAssets = num(bs.totalAssets);
  const totalLiab = num(bs.totalLiab);
  const equity = num(bs.equity);
  const interestBearing =
    num(bs.shortLoan) + num(bs.currentPortionLongDebt) + num(bs.longLoan) + num(bs.leaseLiab);
  const interestExpense = num(is.interestExpense);
  return {
    debtRatio: totalAssets ? totalLiab / totalAssets : null,
    currentRatio: num(bs.currentLiab) ? num(bs.currentAssets) / num(bs.currentLiab) : null,
    interestCover: interestExpense ? (num(is.totalProfit) + interestExpense) / interestExpense : null,
    debtToEquity: equity > 0 ? interestBearing / equity : equity < 0 ? Infinity : null,
    netAssetsNegative: equity < 0,
    ocf: num(cf.netCashOperate),
    totalAssets: totalAssets || null,
    totalLiab: totalLiab || null,
    equity: equity || null,
  };
}

// 财务线索：优先取报告期最大的、真正带 fiscal 科目的记录；没有就返回 hasFiscal=false
export function parseTycFiscal(finance = []) {
  const rows = (finance || []).filter((r) => r?.data_source === TYC_SOURCE);

  const scaleRow = rows.find((r) => /企业规模/.test(String(r.src || ''))) || null;

  let best = null;
  for (const r of rows) {
    if (!/财务数据/.test(String(r.src || ''))) continue;
    let detail = {};
    try {
      detail = JSON.parse(r.detail_json || '{}');
    } catch {
      detail = {};
    }
    if (!detail.fiscal) continue;
    const period = String(r.report_period || detail.fiscal.period || '');
    if (!best || period > best.period) {
      best = {
        period,
        fiscal: detail.fiscal,
        profit: r.profit || null,
        revYoy: r.rev_yoy || null,
      };
    }
  }

  return {
    scaleTag: scaleRow?.scale_tag || null,
    employeeCnt: scaleRow?.employee_cnt ?? null,
    period: best?.period || null,
    profit: best?.profit || null,
    revYoy: best?.revYoy || null,
    metrics: best ? deriveMetrics(best.fiscal) : null,
    hasFiscal: Boolean(best),
    hasScale: Boolean(scaleRow),
  };
}

export const fmtWan = (n) => {
  const v = Number(n || 0);
  if (!v) return null;
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)} 亿元`;
  return `${(v / 1e4).toFixed(2)} 万元`;
};

// 金额格式化：亿 / 万 / 元 三级，保证小额科目（如利息费用 5000 元）不被压成 0.50 万元
export const fmtMoney = (n) => {
  if (n === null || n === undefined || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)} 亿元`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)} 万元`;
  return `${v.toFixed(2)} 元`;
};

export const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : `${(Number(v) * 100).toFixed(1)}%`);
export const fmtX = (v) =>
  v === null || v === undefined ? null : Number.isFinite(Number(v)) ? `${Number(v).toFixed(2)} 倍` : '净资产为负';

// ===== 明细溯源（司法 / 信用 / 财务三张表的展开行）=====

const TOOL_LABELS = {
  get_company_registration_info: '工商登记',
  get_company_profile: '企业简介',
  get_risk_overview: '风险总览',
  get_ipr_score: '创新力评分',
  get_dishonest_info: '失信被执行人',
  get_high_consumption_restriction: '限制高消费',
  get_judgment_debtor_info: '被执行人',
  get_judicial_documents: '裁判文书',
  get_business_exception: '经营异常',
  get_serious_violation: '严重违法',
  get_administrative_penalty: '行政处罚',
  get_tax_violation: '税收违法',
  get_tax_arrears_notice: '欠税公告',
  get_financial_data: '财务数据',
  get_company_scale: '企业规模',
  bankruptcy: '破产重整',
};

export function toolLabel(tool) {
  const t = String(tool || '').trim();
  if (!t) return '手工录入';
  if (TOOL_LABELS[t]) return TOOL_LABELS[t];
  if (/bankrupt|破产|重整/i.test(t)) return '破产重整';
  return t;
}

// detail_json 可能是字符串，也可能已是对象；解析失败一律返回 null（不抛错）
export function parseDetail(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export const prettyJson = (v) => JSON.stringify(v, null, 2);

const BS_FIELDS = [
  ['totalAssets', '资产总计'],
  ['totalLiab', '负债合计'],
  ['equity', '所有者权益'],
  ['currentAssets', '流动资产'],
  ['currentLiab', '流动负债'],
  ['shortLoan', '短期借款'],
  ['currentPortionLongDebt', '一年内到期非流动负债'],
  ['longLoan', '长期借款'],
  ['leaseLiab', '租赁负债'],
];
const IS_FIELDS = [
  ['totalProfit', '利润总额'],
  ['interestExpense', '利息费用'],
];
const CF_FIELDS = [['netCashOperate', '经营活动现金流净额']];

function groupItems(defs, obj) {
  if (!obj) return [];
  return defs
    .filter(([k]) => obj[k] !== undefined && obj[k] !== null)
    .map(([k, label]) => ({ label, value: fmtMoney(obj[k]) }));
}

// 财务行展开视图：科目拆解 + 推导指标（可复核「负债率 50% 是哪两个数算的」）
export function fiscalView(fiscal) {
  if (!fiscal) return null;
  const metrics = deriveMetrics(fiscal);
  const groups = [
    { name: '资产负债表', items: groupItems(BS_FIELDS, fiscal.bs) },
    { name: '利润表', items: groupItems(IS_FIELDS, fiscal.is) },
    { name: '现金流量表', items: groupItems(CF_FIELDS, fiscal.cf) },
  ].filter((g) => g.items.length);
  if (!groups.length) return null;

  const ratios = [
    metrics.debtRatio !== null ? `资产负债率 ${fmtPct(metrics.debtRatio)}` : null,
    metrics.currentRatio !== null ? `流动比率 ${fmtX(metrics.currentRatio)}` : null,
    metrics.interestCover !== null ? `利息保障 ${fmtX(metrics.interestCover)}` : null,
    metrics.debtToEquity !== null ? `有息负债/净资产 ${fmtX(metrics.debtToEquity)}` : null,
    metrics.ocf ? `经营现金流 ${fmtMoney(metrics.ocf)}` : null,
  ].filter(Boolean);

  const summary = [
    metrics.debtRatio !== null ? `负债率 ${fmtPct(metrics.debtRatio)}` : null,
    metrics.currentRatio !== null ? `流动 ${Number(metrics.currentRatio).toFixed(2)}` : null,
  ].filter(Boolean);

  return { groups, ratios: ratios.join(' · '), summary: summary.join(' · ') };
}
