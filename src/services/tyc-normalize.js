// 天眼AI（MCP）风险明细归一化：把 15 个工具各自的返回报文，映射成
// partner_judicial / partner_credit / partner_finance 三张表的结构。
//
// 设计约束（很重要）：
// 1) 纯函数：不连库、不发请求，可用离线样例单测（首次真实调用前必须能验证）。
// 2) 字段名容错：官方 162 个工具的返回 schema 未公开，同一语义可能是
//    caseNo / case_no / caseNum / 案号。统一按「小写 + 去分隔符」匹配别名。
// 3) 认不出来就不写：宁可少一条明细，也不能把猜测的金额/案号写进评分卡。
//    映射失败时返回 warnings，由调用方落原始报文到 partner_raw 备查。

// ===== 基础工具函数 =====

const normKey = (k) => String(k || '').toLowerCase().replace(/[_\-\s·:：()（）]/g, '');

function pick(obj, aliases) {
  if (!obj || typeof obj !== 'object') return undefined;
  const map = {};
  for (const [k, v] of Object.entries(obj)) map[normKey(k)] = v;
  for (const a of aliases) {
    const v = map[normKey(a)];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

// 多个候选对象依次尝试（头表 / 明细 / 嵌套 data）
function pickAny(objs, aliases) {
  for (const o of objs) {
    const v = pick(o, aliases);
    if (v !== undefined) return v;
  }
  return undefined;
}

const pad2 = (n) => String(n).padStart(2, '0');

export function toText(v, max = 255) {
  if (v === null || v === undefined) return null;
  const s = String(typeof v === 'object' ? JSON.stringify(v) : v).trim();
  if (!s || s === '-' || s === '--' || s === 'null') return null;
  return s.length > max ? s.slice(0, max) : s;
}

// 2024-03-01 / 2024年3月1日 / 2024/3/1 / 13 位时间戳 → YYYY-MM-DD
export function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v).trim())) {
    const n = Number(v);
    const ms = String(n).length > 10 ? n : n * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  const s = String(v).trim();
  const m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (m) {
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${m[1]}-${pad2(mm)}-${pad2(dd)}`;
  }
  const ym = s.match(/^(\d{4})\s*[-/.年]?\s*$/);
  if (ym) return `${ym[1]}-01-01`;
  return null;
}

// "1,234.56万元" / "1.5亿元" / 1234.56 → 元
export function toAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[,，\s]/g, '');
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  if (/亿/.test(s)) n *= 1e8;
  else if (/万/.test(s)) n *= 1e4;
  return Math.round(n * 100) / 100;
}

export function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const m = String(v).replace(/[,，\s]/g, '').match(/-?\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// 在报文里找「明细列表」：优先常见键名，其次任意对象数组（深度受限，避免扫全量字符串）
const LIST_KEYS = ['items', 'list', 'records', 'rows', 'results', 'result', 'data', 'content', 'details'];

export function findList(payload, depth = 0) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object' || depth > 4) return null;
  for (const k of LIST_KEYS) {
    const v = payload[k];
    if (Array.isArray(v)) {
      // 让 [{text:'...'}] 这种 MCP 原始包装穿透到下一层
      return v;
    }
    if (v && typeof v === 'object') {
      const r = findList(v, depth + 1);
      if (r) return r;
    }
  }
  for (const v of Object.values(payload)) {
    if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object') return v;
  }
  return null;
}

// 空结果约定：官方文档明确 _empty:true + _summary 文案 表示「无公开记录」
export function isEmptyResult(payload) {
  if (!payload || typeof payload !== 'object') return true;
  if (payload._empty === true || payload.empty === true) return true;
  if (payload.markdown && !findList(payload)) return false; // markdown 兜底，交给上层报警
  const list = findList(payload);
  return Array.isArray(list) && list.length === 0;
}

// 把记录压平成 { 归一化字段名: 值 }，同时支持嵌套台账与 [{name,value}] 指标数组
function flatten(obj, out = {}, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return out;
  if (Array.isArray(obj)) {
    for (const it of obj) {
      if (!it || typeof it !== 'object') continue;
      const name = pick(it, ['name', 'itemName', 'title', 'item', '指标', '科目', '项目', '指标名称']);
      const value = pick(it, ['value', 'amount', 'total', '数值', '金额', '本期金额', '期末余额']);
      if (name !== undefined && value !== undefined) out[normKey(name)] = value;
      else flatten(it, out, depth + 1);
    }
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') flatten(v, out, depth + 1);
    else if (v !== null && v !== undefined && v !== '') out[normKey(k)] = v;
  }
  return out;
}

// ===== 字段别名 =====

const CASE_NO = [
  'caseNo', 'case_no', 'caseNum', 'caseNumber', 'caseNoStr', 'caseCode', 'anHao',
  'punishNumber', 'decisionNumber', 'docNo',
  '案号', '执行案号', '案号/文书号', '文书号', '决定文书号', '文号',
];
const COURT = [
  'court', 'courtName', 'court_name', 'executeCourt', 'executeGov', 'hearingCourt', 'courtRoom',
  'punishGov', 'penaltyOffice', 'penaltyAuth', 'office', 'decisionOffice', 'putDepartment',
  'taxAuthority', 'taxAuth',
  '法院', '执行法院', '审理法院', '处罚机关', '决定机关', '行政机关', '执法机关', '税务机关',
];
const AMOUNT = [
  'amount', 'executeAmount', 'executeMoney', 'execMoney', 'amountInvolved', 'subjectAmount', 'caseAmount', 'money',
  'taxOwedBalance', 'taxArrearsBalance', 'owedTax',
  '标的金额', '执行标的', '涉案金额', '标的额', '罚款金额', '处罚金额', '欠税余额', '欠税金额',
];
const STATUS = ['status', 'caseStatus', 'executeStatus', 'state', 'performance', '状态', '执行状态', '履行情况', '案件状态'];
const DATE = [
  'date', 'caseDate', 'filingDate', 'publishDate', 'publishTime', 'executeDate', 'hearingDate', 'judgeDate',
  'startTime', 'createTime', 'caseCreateTime', 'regDate', 'decisionDate', 'noticeDate', 'penaltyDate',
  'listDate', 'putDate', 'inDate', 'outDate', 'issueDate', 'time',
  '日期', '立案日期', '发布日期', '执行日期', '裁判日期', '开庭日期', '处罚决定日期', '列入日期', '移出日期', '欠税公告日期',
];
const ROLE = ['partyRole', 'role', 'identity', 'litigantRole', 'partyType', 'litigantType', '当事人角色', '身份', '诉讼地位', '当事人'];

// 当事人角色收敛到评分卡认识的三类
function normRole(v) {
  const s = String(v || '');
  if (/被执行人/.test(s)) return '被执行人';
  if (/申请执行人/.test(s)) return '原告';
  if (/被告|被上诉人|被申请人/.test(s)) return '被告';
  if (/原告|上诉人|申请人/.test(s)) return '原告';
  return null;
}

// ===== 司法类工具 =====

// caseType 是评分卡的判定口径：
// - 含「失信」「限高」→ 一票否决
// - 「被执行案件」+ party_role=被执行人 → executionPerCase + 金额档位
const JUDICIAL_TOOLS = {
  get_dishonest_info: { caseType: '失信被执行人', role: '被执行人' },
  get_high_consumption_restriction: { caseType: '限制高消费（限高）', role: '被执行人' },
  get_judgment_debtor_info: { caseType: '被执行案件', role: '被执行人' },
  get_judicial_documents: { caseType: '裁判文书', role: null },
};

// 破产/重整：官方工具名随版本变动（get_bankruptcy_info / get_bankruptcy_reorganization …），
// 因此不写死名字，用语义匹配兜底 —— 必须命中，否则评分卡 veto 里的「破产」依旧空转
const BANKRUPTCY_RE = /bankrupt|insolven|破产|重整/i;

export function judicialCfg(toolKey) {
  if (JUDICIAL_TOOLS[toolKey]) return JUDICIAL_TOOLS[toolKey];
  if (BANKRUPTCY_RE.test(String(toolKey || ''))) return { caseType: '破产重整', role: '债务人' };
  return null;
}

export function normalizeJudicial(toolKey, payload) {
  const cfg = judicialCfg(toolKey);
  if (!cfg) return [];
  const list = findList(payload) || [];
  const rows = [];
  const seen = new Set();
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    // 「裁判文书」里本文/摘要可能很长，只取结构化字段
    const caseNo = toText(pick(it, CASE_NO), 64);
    const court = toText(pick(it, COURT), 128);
    const date = toDate(pick(it, DATE));
    // 失信/限高本身就是结论性风险，即使缺案号也保留（否则一票否决会漏）
    const conclusion = toolKey === 'get_dishonest_info' || toolKey === 'get_high_consumption_restriction';
    if (!conclusion && !caseNo && !date) continue;
    const key = `${cfg.caseType}|${caseNo || ''}|${date || ''}|${court || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      caseType: cfg.caseType,
      partyRole: normRole(pick(it, ROLE)) || cfg.role,
      caseNo,
      court,
      amount: toAmount(pick(it, AMOUNT)),
      status: toText(pick(it, STATUS), 32),
      date,
      detail: { tool: toolKey, raw: it },
    });
  }
  return rows;
}

// ===== 合规类工具 =====

// item_type 必须包含评分卡的关键词：严重违法 / 经营异常 / 行政处罚 / 税收
// 欠税公告故意不并入「税收违法」：欠税是补缴问题，不等同于税收违法，避免重复扣 10 分
const CREDIT_TOOLS = {
  get_business_exception: { itemType: '经营异常' },
  get_serious_violation: { itemType: '严重违法失信' },
  get_administrative_penalty: { itemType: '行政处罚' },
  get_tax_violation: { itemType: '税收违法' },
  get_tax_arrears_notice: { itemType: '欠税公告' },
};

const REASON = [
  'reason', 'putReason', 'illegalType', 'violationType', 'violation', 'violationMatter', 'illegalFact',
  'mainIllegalFact', 'caseNature', 'content', 'caseReason', 'eventReason', 'taxType',
  '原因', '违法行为类型', '违法事实', '列入原因', '案件性质', '主要违法事实', '事由', '欠税税种',
];
const PENALTY = [
  'penalty', 'penaltyContent', 'penaltyResult', 'punishContent', 'punishResult', 'result', 'handleResult',
  '处罚内容', '处罚结果', '处理处罚情况', '处理结果', '欠税余额',
];

export function normalizeCredit(toolKey, payload) {
  const cfg = CREDIT_TOOLS[toolKey];
  if (!cfg) return [];
  const list = findList(payload) || [];
  const rows = [];
  const seen = new Set();
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const authority = toText(pick(it, COURT), 128);
    const reason = toText(pick(it, REASON), 255);
    const date = toDate(pick(it, DATE));
    // 与 getCredit 的过滤口径一致：只有类型、没有任何可核验内容的空壳不落库
    if (!authority && !reason && !date) continue;
    const penalty = toText(pick(it, PENALTY), 255);
    const key = `${cfg.itemType}|${authority || ''}|${reason || ''}|${date || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      itemType: cfg.itemType,
      authority,
      reason,
      penalty,
      date,
      detail: { tool: toolKey, raw: it },
    });
  }
  return rows;
}

// ===== 财务类工具 =====
// scoring-service.computeFiscalMetrics 只认 detail_json.fiscal 的这套科目名，
// 因此这里必须严格映射；任一关键科目缺失就不产出 fiscal（宁缺勿错）。

const FISCAL_ALIASES = {
  bs: {
    totalAssets: ['totalassets', '资产总计', '资产总额', '总资产'],
    totalLiab: ['totalliab', 'totalliabilities', '负债合计', '负债总计', '总负债'],
    equity: ['equity', '所有者权益合计', '股东权益合计', '所有者权益', '净资产'],
    currentAssets: ['currentassets', '流动资产合计'],
    currentLiab: ['currentliab', 'currentliabilities', '流动负债合计'],
    shortLoan: ['shortloan', '短期借款'],
    currentPortionLongDebt: ['currentportionlongdebt', '一年内到期的非流动负债'],
    longLoan: ['longloan', '长期借款'],
    leaseLiab: ['leaseliab', '租赁负债'],
  },
  is: {
    totalProfit: ['totalprofit', '利润总额'],
    interestExpense: ['interestexpense', '利息费用', '财务费用'],
  },
  cf: {
    netCashOperate: ['netcashoperate', '经营活动产生的现金流量净额', '经营现金流量净额', '经营活动现金流量净额'],
  },
};

function buildFiscal(payload) {
  const flat = flatten(payload);
  const out = { bs: {}, is: {}, cf: {} };
  let hit = 0;
  for (const [group, fields] of Object.entries(FISCAL_ALIASES)) {
    for (const [key, aliases] of Object.entries(fields)) {
      for (const a of aliases) {
        const v = toAmount(flat[normKey(a)]);
        if (v !== null) {
          out[group][key] = v;
          hit += 1;
          break;
        }
      }
    }
  }
  // 资产负债率最少需要 资产总计 + 负债合计；其他指标缺了就留空由评分卡跳过
  if (out.bs.totalAssets === undefined || out.bs.totalLiab === undefined) return null;
  return { fiscal: out, hit };
}

// 连续亏损需要按年历史；只在报文里确实存在「年 + 净利润」列表时才构造
function buildHistory(payload) {
  const list = findList(payload);
  if (!Array.isArray(list) || !list.length) return null;
  const hist = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') break;
    const year = toInt(pick(it, ['year', 'reportYear', '年度', '年份']));
    const netProfit = toAmount(pick(it, ['netProfit', '净利润', '归母净利润', 'parentNetProfit']));
    if (year && netProfit !== null) hist.push({ year, netProfit });
  }
  return hist.length ? hist : null;
}

const PERIOD = ['reportPeriod', 'report_period', 'reportDate', 'period', 'endDate', '报告期', '报告日期', '截止日期', '年度', 'year'];
const REVENUE = ['revenue', 'totalRevenue', 'totalOperateIncome', '营业收入', '营业总收入'];
const NET_PROFIT = ['netProfit', 'parentNetProfit', '净利润', '归母净利润'];
const REV_YOY = ['revenueYoy', 'revYoy', 'yoy', '营业收入同比', '营收同比'];
const SCALE = ['scale', 'scaleTag', 'companyScale', 'enterpriseScale', '规模', '企业规模', '规模类型'];
const STAFF = ['socialStaffNum', 'employeeCnt', 'staffNum', 'employees', '参保人数', '员工人数', '员工总数'];
const STAFF_RANGE = ['staffNumRange', 'staffRange', '人员规模', '人员规模范围'];

const yiText = (n) => (n === null || n === undefined ? null : `${(n / 1e8).toFixed(2)} 亿元`);
const pctText = (n) => (n === null || n === undefined ? null : `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%`);

// get_financial_data / get_company_scale → partner_finance 行
export function normalizeFinance(toolKey, payload) {
  if (toolKey === 'get_company_scale') {
    const list = findList(payload);
    const objs = [payload, payload?.data, payload?.result, Array.isArray(list) ? list[0] : null].filter(
      (o) => o && typeof o === 'object',
    );
    const scale = toText(pickAny(objs, SCALE), 32) || toText(pickAny(objs, STAFF_RANGE), 32);
    const staff = toInt(pickAny(objs, STAFF));
    if (!scale && staff === null) return { rows: [], warnings: ['企业规模：未识别到规模/人数字段，已保存原始报文'] };
    return {
      rows: [
        {
          src: '天眼AI·企业规模',
          scaleTag: scale,
          employeeCnt: staff,
          detail: { tool: toolKey, raw: payload },
        },
      ],
      warnings: [],
    };
  }

  if (toolKey !== 'get_financial_data') return { rows: [], warnings: [] };

  const built = buildFiscal(payload);
  const flat = flatten(payload);
  const objs = [payload, payload?.data, payload?.result].filter((o) => o && typeof o === 'object');
  const period = toText(pickAny(objs, PERIOD), 16) || toText(flat[normKey('报告期')], 16);
  const revenue = toAmount(pickAny(objs, REVENUE));
  const netProfit = toAmount(pickAny(objs, NET_PROFIT));
  const revYoyNum = pickAny(objs, REV_YOY);

  const detail = { tool: toolKey, raw: payload, fiscalSource: built ? 'tyc_mcp' : null };
  if (built) {
    detail.fiscal = built.fiscal;
    const history = buildHistory(payload);
    if (history) detail.fiscal.history = history;
    detail.fiscal.period = period || null;
  }
  if (revenue !== null) detail.revenue = revenue;
  if (netProfit !== null) detail.netProfit = netProfit;

  const warnings = [];
  if (!built) {
    warnings.push('财务数据：未识别到「资产总计 + 负债合计」等科目，仅保存原始报文，不参与评分（避免猜测）');
  }

  return {
    rows: [
      {
        src: '天眼AI·财务数据',
        reportPeriod: period || (built ? built.fiscal.period : null),
        revYoy: pctText(revYoyNum === undefined ? null : Number(revYoyNum)),
        profit: yiText(netProfit),
        detail,
      },
    ],
    warnings,
  };
}

// ===== 统一入口 =====

// 返回 { judicial, credit, finance, warnings }
export function normalizeTool(toolKey, payload) {
  const result = { judicial: [], credit: [], finance: [], warnings: [] };

  // 只有 markdown、没有结构化列表 → 认不出字段，不猜；原始报文已在 partner_raw，
  // 等观察到真实结构后再补归一化规则，可用 resyncTycDimensions 重放，无需再调接口
  if (payload && payload.markdown && !findList(payload)) {
    result.warnings.push(`${toolKey}：返回为非结构化文本，已保存原始报文，未落明细`);
    return result;
  }

  if (isEmptyResult(payload)) {
    // 空结果不是错误：官方约定 _empty + _summary 表示「无公开记录」
    return result;
  }

  if (judicialCfg(toolKey)) result.judicial = normalizeJudicial(toolKey, payload);
  else if (CREDIT_TOOLS[toolKey]) result.credit = normalizeCredit(toolKey, payload);
  else if (toolKey === 'get_financial_data' || toolKey === 'get_company_scale') {
    const fin = normalizeFinance(toolKey, payload);
    result.finance = fin.rows;
    result.warnings.push(...fin.warnings);
  }
  return result;
}
