import db from '../db.js';
import { channels } from '../../config/channels.js';
import { TycMcpClient } from '../channels/tyc-mcp-client.js';
import { updatePartner } from './partner-service.js';
import { normalizeTool } from './tyc-normalize.js';

// 天眼AI（MCP）企业画像同步
// 分组：
// - basic：免费权益内的 4 个聚合维度（登记信息/简介/风险总览/创新力评分），长期可用
// - risk ：P0 风险明细（司法 4 个 + 合规 5 个 + 财务/规模 2 个），需 VIP/SVIP 或开放平台开通
// 明细一律走「原始报文先落 partner_raw → 再归一化落维度表」两段式：
// 归一化规则改进后可用 resyncTycDimensions() 直接重解析，不需要再花钱调一次接口。
const CHANNEL = 'tianyancha_mcp';
// 天眼AI 写入行的来源标记：区别于开放平台 API / 手工 / AI 推断
export const TYC_SOURCE = 'tyc_mcp';

export const TYC_SYNC_TOOLS = [
  // ===== 基础画像（免费权益）=====
  { key: 'registration', tool: 'get_company_registration_info', label: '工商登记', group: 'basic' },
  { key: 'profile', tool: 'get_company_profile', label: '企业简介', group: 'basic' },
  { key: 'risk_overview', tool: 'get_risk_overview', label: '风险总览', group: 'basic' },
  { key: 'ipr_score', tool: 'get_ipr_score', label: '创新力评分', group: 'basic' },

  // ===== P0 风险明细·司法 =====
  { key: 'dishonest', tool: 'get_dishonest_info', label: '失信被执行人', group: 'risk', dim: 'judicial' },
  { key: 'high_consumption', tool: 'get_high_consumption_restriction', label: '限制高消费', group: 'risk', dim: 'judicial' },
  { key: 'judgment_debtor', tool: 'get_judgment_debtor_info', label: '被执行人', group: 'risk', dim: 'judicial' },
  { key: 'judicial_documents', tool: 'get_judicial_documents', label: '裁判文书', group: 'risk', dim: 'judicial' },

  // ===== P0 风险明细·合规 =====
  { key: 'business_exception', tool: 'get_business_exception', label: '经营异常', group: 'risk', dim: 'credit' },
  { key: 'serious_violation', tool: 'get_serious_violation', label: '严重违法', group: 'risk', dim: 'credit' },
  { key: 'administrative_penalty', tool: 'get_administrative_penalty', label: '行政处罚', group: 'risk', dim: 'credit' },
  { key: 'tax_violation', tool: 'get_tax_violation', label: '税收违法', group: 'risk', dim: 'credit' },
  { key: 'tax_arrears', tool: 'get_tax_arrears_notice', label: '欠税公告', group: 'risk', dim: 'credit' },

  // ===== P0 财务/规模 =====
  { key: 'financial_data', tool: 'get_financial_data', label: '财务数据', group: 'risk', dim: 'finance' },
  { key: 'company_scale', tool: 'get_company_scale', label: '企业规模', group: 'risk', dim: 'finance' },
];

// 工具调用间隔：天眼AI 有频率限制，逐项之间留间隔（可用环境变量覆盖）
const CALL_INTERVAL_MS = Number(process.env.TIANYANCHA_MCP_INTERVAL_MS || 600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 权限类错误的识别：这些不是程序 bug，是账号权益没开，前端要提示「去开通」而不是「报错」
const PERMISSION_HINTS = [
  /无权限/,
  /未开通/,
  /未授权/,
  /权益/,
  /\bVIP\b/i,
  /\bSVIP\b/i,
  /需购买/,
  /购买后/,
  /升级会员/,
  /余额不足/,
  /\b403\b/,
  /forbidden/i,
  /permission/i,
  /not\s*authori[sz]ed/i,
  /entitlement/i,
];

function isPermissionError(message) {
  const s = String(message || '');
  return PERMISSION_HINTS.some((re) => re.test(s));
}

function textOf(res) {
  if (Array.isArray(res)) return res.map((x) => x?.text || '').join('\n');
  if (typeof res === 'string') return res;
  if (res && typeof res.text === 'string') return res.text;
  return res === null || res === undefined ? '' : JSON.stringify(res);
}

function parsePayload(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { markdown: text };
  }
}

export function isTycConfigured() {
  return Boolean(channels.tianyanchaMcp && channels.tianyanchaMcp.token);
}

function makeClient() {
  const cfg = channels.tianyanchaMcp || {};
  return new TycMcpClient({ token: cfg.token, endpoint: cfg.endpoint, timeoutMs: cfg.timeoutMs });
}

// ===== 明细落库（幂等：按业务键去重，重复同步不会翻倍计分）=====

// 司法：同一「案件类型 + 案号 + 日期」只留一条
// 案号为空也参与去重（失信/限高缺案号时仍要保留，否则一票否决会漏）
async function insertJudicialRows(pid, rows = []) {
  let n = 0;
  for (const r of rows) {
    const dup = await db.get(
      `SELECT id FROM partner_judicial
        WHERE partner_id = ? AND case_type = ?
          AND IFNULL(case_no, '') = ? AND IFNULL(date, '') = ?
        LIMIT 1`,
      [pid, r.caseType, r.caseNo || '', r.date || ''],
    );
    if (dup) continue;
    await db.run(
      `INSERT INTO partner_judicial
        (partner_id, case_type, party_role, case_no, court, amount, status, date, detail_json, fetched_at, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pid,
        r.caseType || null,
        r.partyRole || null,
        r.caseNo || null,
        r.court || null,
        r.amount ?? null,
        r.status || null,
        r.date || null,
        r.detail ? JSON.stringify(r.detail) : null,
        new Date(),
        TYC_SOURCE,
      ],
    );
    n += 1;
  }
  return n;
}

// 合规：同一「类型 + 机关 + 事由 + 日期」只留一条
async function insertCreditRows(pid, rows = []) {
  let n = 0;
  for (const r of rows) {
    const dup = await db.get(
      `SELECT id FROM partner_credit
        WHERE partner_id = ? AND item_type = ?
          AND IFNULL(authority, '') = ? AND IFNULL(reason, '') = ? AND IFNULL(date, '') = ?
        LIMIT 1`,
      [pid, r.itemType, r.authority || '', r.reason || '', r.date || ''],
    );
    if (dup) continue;
    await db.run(
      `INSERT INTO partner_credit
        (partner_id, item_type, authority, reason, penalty, date, detail_json, fetched_at, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pid,
        r.itemType || null,
        r.authority || null,
        r.reason || null,
        r.penalty || null,
        r.date || null,
        r.detail ? JSON.stringify(r.detail) : null,
        new Date(),
        TYC_SOURCE,
      ],
    );
    n += 1;
  }
  return n;
}

// 财务/规模：同一「来源 + 报告期」只留一条
async function insertFinanceRows(pid, rows = []) {
  let n = 0;
  for (const r of rows) {
    const period = r.reportPeriod || '';
    const dup = await db.get(
      `SELECT id FROM partner_finance
        WHERE partner_id = ? AND data_source = ? AND src = ? AND IFNULL(report_period, '') = ?
        LIMIT 1`,
      [pid, TYC_SOURCE, r.src || '', period],
    );
    if (dup) {
      // 财务/规模是可变量：命中同一条就刷新数值，而不是留旧值（但仍不计入「新增」）
      await db.run(
        `UPDATE partner_finance
            SET rev_yoy = ?, profit = ?, scale_tag = ?, employee_cnt = ?, detail_json = ?, fetched_at = ?
          WHERE id = ?`,
        [r.revYoy || null, r.profit || null, r.scaleTag || null, r.employeeCnt ?? null, r.detail ? JSON.stringify(r.detail) : null, new Date(), dup.id],
      );
      continue;
    }
    await db.run(
      `INSERT INTO partner_finance
        (partner_id, src, report_period, rev_yoy, profit, scale_tag, employee_cnt, detail_json, fetched_at, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pid,
        r.src || '天眼AI',
        r.reportPeriod || null,
        r.revYoy || null,
        r.profit || null,
        r.scaleTag || null,
        r.employeeCnt ?? null,
        r.detail ? JSON.stringify(r.detail) : null,
        new Date(),
        TYC_SOURCE,
      ],
    );
    n += 1;
  }
  return n;
}

// 把某个工具的报文落成维度行；返回 { counts, warnings }
async function applyToolPayload(pid, toolKey, payload) {
  let normalized;
  try {
    normalized = normalizeTool(toolKey, payload);
  } catch (e) {
    // 归一化 bug 不能影响原始报文落库，也不能中断整轮同步
    return { counts: { judicial: 0, credit: 0, finance: 0 }, warnings: [`${toolKey} 归一化失败：${e.message}`] };
  }
  const counts = {
    judicial: await insertJudicialRows(pid, normalized.judicial),
    credit: await insertCreditRows(pid, normalized.credit),
    finance: await insertFinanceRows(pid, normalized.finance),
  };
  return { counts, warnings: normalized.warnings || [] };
}

// 主体参数兼容：
// - 新版官方 MCP 用 company_name；旧 SKILL 统一用 searchKey
// - 官方还提供 call_company_tool 调度器（162 个是「内部业务工具」），
//   若直接 tools/call 报 not found，则降级走调度器；仍失败则抛原始错误，避免原因被掩盖
async function callToolCompat(client, tool, companyName) {
  try {
    return await client.callTool(tool, { company_name: companyName });
  } catch (e) {
    const msg = String(e.message || '');
    const paramIssue = /参数|param|searchKey|company_name|必填|required|missing|invalid/i.test(msg);
    const notFound = /not\s*found|unknown\s*tool|不存在|无此工具|不支持/i.test(msg);

    if (paramIssue && !notFound) {
      return client.callTool(tool, { searchKey: companyName });
    }
    if (notFound) {
      try {
        return await client.callTool('call_company_tool', { tool_name: tool, company_name: companyName });
      } catch {
        throw e;
      }
    }
    throw e;
  }
}

// 可选工具自动发现：tools/list 只返回元数据，不消耗企业数据额度。
// 目的：破产/重整这类工具的官方命名会变，写死名字一旦对不上，评分卡的「破产」一票否决就又空转。
const OPTIONAL_TOOLS = [
  { key: 'bankruptcy', label: '破产重整', group: 'risk', dim: 'judicial', re: /bankrupt|insolven|破产|重整/i },
];

async function discoverOptionalTools(client) {
  try {
    const list = await client.listTools();
    const names = (list || []).map((t) => t?.name).filter(Boolean);
    const extras = [];
    for (const p of OPTIONAL_TOOLS) {
      if (TYC_SYNC_TOOLS.some((t) => p.re.test(t.tool))) continue;
      const hit = names.find((n) => p.re.test(n));
      if (!hit) continue;
      // normAs 固定为 key：归一化走语义匹配，不依赖具体工具名
      extras.push({ key: p.key, tool: hit, normAs: p.key, label: p.label, group: p.group, dim: p.dim, discovered: true });
    }
    return { extras, names };
  } catch {
    // 发现失败不影响主流程：继续按静态清单跑
    return { extras: [], names: [] };
  }
}

export async function syncTycProfile(partnerId, companyName) {
  if (!isTycConfigured()) throw new Error('未配置 TIANYANCHA_MCP_TOKEN，无法调用天眼AI');
  const name = String(companyName || '').trim();
  if (!name) throw new Error('缺少企业名称');

  const pid = Number(partnerId);
  const client = makeClient();
  await client.connect();

  // 先探测可选工具（破产重整），再拼最终清单
  const { extras, names } = await discoverOptionalTools(client);
  const tools = [...TYC_SYNC_TOOLS, ...extras];

  const done = [];
  const failed = [];
  const warnings = [];
  const dimensions = { judicial: 0, credit: 0, finance: 0 };

  for (const [i, t] of tools.entries()) {
    if (i > 0) await sleep(CALL_INTERVAL_MS); // 频率限制：上一项成功/失败都留间隔
    try {
      const res = await callToolCompat(client, t.tool, name);
      const payload = parsePayload(textOf(res));

      // 原始报文先落库（归一化失败也能事后重解析）
      await db.run(`DELETE FROM partner_raw WHERE partner_id = ? AND channel = ? AND biz_key = ?`, [pid, CHANNEL, t.key]);
      await db.run(
        `INSERT INTO partner_raw (partner_id, channel, biz_key, payload_json, fetched_at) VALUES (?, ?, ?, ?, ?)`,
        [pid, CHANNEL, t.key, JSON.stringify(payload), new Date()],
      );

      const applied = await applyToolPayload(pid, t.normAs || t.tool, payload);
      dimensions.judicial += applied.counts.judicial;
      dimensions.credit += applied.counts.credit;
      dimensions.finance += applied.counts.finance;
      warnings.push(...applied.warnings);

      done.push({
        key: t.key,
        label: t.label,
        inserted: applied.counts,
      });
    } catch (e) {
      failed.push({
        key: t.key,
        tool: t.tool,
        label: t.label,
        message: e.message,
        // 权益未开通：不是 bug，前端提示「需开通」而不是「同步失败」
        permissionDenied: isPermissionError(e.message),
      });
    }
  }

  // 用登记信息回填工商字段（只补空，不覆盖已人工核实的内容）
  const profile = await getTycProfile(pid);
  const reg = profile.registration || {};
  const fields = {};
  if (reg.legalPersonName && !profile.partnerLegalPerson) fields.legalPerson = reg.legalPersonName;
  if (reg.regStatus) fields.regStatus = reg.regStatus;
  if (reg.industry) fields.industry = reg.industry;
  if (Object.keys(fields).length) await updatePartner(pid, fields);

  return {
    synced: done,
    failed,
    warnings: [...new Set(warnings)],
    dimensions,
    summary: {
      total: tools.length,
      ok: done.length,
      failed: failed.length,
      permissionDenied: failed.filter((f) => f.permissionDenied).length,
    },
    // 便于排查：服务端到底暴露了多少工具、其中哪些是本次动态发现的
    toolsInfo: {
      available: names.length,
      used: tools.length,
      discovered: extras.map((e) => e.tool),
    },
    profile,
  };
}

// 重解析：只读 partner_raw 里已同步的原始报文，不发任何请求。
// 用途：归一化规则改进后补落明细，不需要再消耗一次天眼查调用额度。
export async function resyncTycDimensions(partnerId) {
  const pid = Number(partnerId);
  const rows = await db.all(
    `SELECT biz_key, payload_json FROM partner_raw
      WHERE partner_id = ? AND channel = ? ORDER BY id DESC`,
    [pid, CHANNEL],
  );
  const latest = {};
  for (const r of rows) if (!latest[r.biz_key]) latest[r.biz_key] = r;

  const applied = [];
  const warnings = [];
  const dimensions = { judicial: 0, credit: 0, finance: 0 };

  for (const t of TYC_SYNC_TOOLS) {
    const raw = latest[t.key];
    if (!raw) continue;
    let payload;
    try {
      payload = JSON.parse(raw.payload_json);
    } catch {
      warnings.push(`${t.label}：原始报文不是合法 JSON，已跳过`);
      continue;
    }
    const res = await applyToolPayload(pid, t.normAs || t.tool, payload);
    dimensions.judicial += res.counts.judicial;
    dimensions.credit += res.counts.credit;
    dimensions.finance += res.counts.finance;
    warnings.push(...res.warnings);
    applied.push({ key: t.key, label: t.label, inserted: res.counts });
  }

  // 动态发现的工具（如 bankruptcy）：biz_key 本身就是归一化语义键，直接重放
  const knownKeys = new Set(TYC_SYNC_TOOLS.map((t) => t.key));
  for (const [key, raw] of Object.entries(latest)) {
    if (knownKeys.has(key)) continue;
    if (!OPTIONAL_TOOLS.some((p) => p.key === key || p.re.test(key))) continue;
    let payload;
    try {
      payload = JSON.parse(raw.payload_json);
    } catch {
      warnings.push(`${key}：原始报文不是合法 JSON，已跳过`);
      continue;
    }
    const label = OPTIONAL_TOOLS.find((p) => p.key === key)?.label || key;
    const res = await applyToolPayload(pid, key, payload);
    dimensions.judicial += res.counts.judicial;
    dimensions.credit += res.counts.credit;
    dimensions.finance += res.counts.finance;
    warnings.push(...res.warnings);
    applied.push({ key, label, inserted: res.counts });
  }

  return {
    applied,
    dimensions,
    warnings: [...new Set(warnings)],
    empty: applied.length === 0,
    hint: applied.length === 0 ? '该客户还没有天眼AI 同步记录，请先执行一次同步' : null,
  };
}

function pickRegistration(p) {
  if (!p || typeof p !== 'object') return null;
  const base = p.sources?.base || p.base || p;
  const pick = (k) => base[k] ?? null;
  return {
    name: pick('name'),
    creditCode: pick('creditCode'),
    regStatus: pick('regStatus'),
    legalPersonName: pick('legalPersonName'),
    companyOrgType: pick('companyOrgType'),
    regCapital: pick('regCapital'),
    actualCapital: pick('actualCapital'),
    estiblishTime: pick('estiblishTime'),
    fromTime: pick('fromTime'),
    toTime: pick('toTime'),
    approvedTime: pick('approvedTime'),
    regInstitute: pick('regInstitute'),
    regLocation: pick('regLocation'),
    industry: pick('industry'),
    industrySmall: base.industryAll?.categorySmall || null,
    city: pick('city'),
    district: pick('district'),
    socialStaffNum: pick('socialStaffNum'),
    staffNumRange: pick('staffNumRange'),
    tags: pick('tags') ? String(base.tags).split(';').filter(Boolean) : [],
    historyNames: pick('historyNameList') || (base.historyNames ? String(base.historyNames).split(';').filter(Boolean) : []),
    businessScope: pick('businessScope'),
    percentileScore: pick('percentileScore'),
  };
}

export async function getTycProfile(partnerId) {
  const rows = await db.all(
    `SELECT biz_key, payload_json, fetched_at FROM partner_raw
      WHERE partner_id = ? AND channel = ? ORDER BY id DESC`,
    [Number(partnerId), CHANNEL],
  );
  const latest = {};
  for (const r of rows) if (!latest[r.biz_key]) latest[r.biz_key] = r;

  const parse = (k) => {
    const r = latest[k];
    if (!r) return null;
    try {
      return JSON.parse(r.payload_json);
    } catch {
      return null;
    }
  };

  const registration = pickRegistration(parse('registration'));
  const profileRaw = parse('profile');
  const riskRaw = parse('risk_overview');
  const iprRaw = parse('ipr_score');

  const groups = (riskRaw?.riskList || []).map((g) => ({
    name: g.name || g.title || g.type || '-',
    count: Number(g.count || 0),
    items: (g.list || []).map((i) => ({ name: i.name || i.title || '-', total: Number(i.total || 0) })),
  }));

  const syncedAt = Object.values(latest)
    .map((r) => r.fetched_at)
    .filter(Boolean)
    .sort()
    .pop() || null;

  // 已落库的天眼AI 明细条数（前端展示「已采集 N 条风险明细」，也可验证归一化是否真的生效）
  const pid = Number(partnerId);
  const dim = await db.get(
    `SELECT
       (SELECT COUNT(*) FROM partner_judicial WHERE partner_id = ? AND data_source = ?) AS judicial,
       (SELECT COUNT(*) FROM partner_credit   WHERE partner_id = ? AND data_source = ?) AS credit,
       (SELECT COUNT(*) FROM partner_finance  WHERE partner_id = ? AND data_source = ?) AS finance`,
    [pid, TYC_SOURCE, pid, TYC_SOURCE, pid, TYC_SOURCE],
  );

  return {
    configured: isTycConfigured(),
    syncedAt,
    partnerLegalPerson: null, // 由调用方补充判断，避免额外查询
    dimensions: {
      judicial: Number(dim?.judicial || 0),
      credit: Number(dim?.credit || 0),
      finance: Number(dim?.finance || 0),
    },
    registration,
    profile: profileRaw?.profile || profileRaw?.markdown || null,
    riskOverview: riskRaw
      ? { total: Number(riskRaw.total || 0), groups, summary: riskRaw._summary || null }
      : null,
    iprScore: iprRaw && !iprRaw.markdown ? iprRaw : null,
    rawKeys: Object.keys(latest),
  };
}

// 供评分用的聚合指标（自身风险分组）
export async function getTycRiskMetrics(partnerId) {
  const rows = await db.all(
    `SELECT payload_json FROM partner_raw
      WHERE partner_id = ? AND channel = ? AND biz_key = 'risk_overview'
      ORDER BY id DESC LIMIT 1`,
    [Number(partnerId), CHANNEL],
  );
  if (!rows.length) return null;
  let payload;
  try {
    payload = JSON.parse(rows[0].payload_json);
  } catch {
    return null;
  }
  const groups = payload?.riskList || [];
  const self = groups.find((g) => /自身/.test(g.name || ''));
  if (!self) return null;
  const counts = {};
  for (const it of self.list || []) counts[it.name || it.title] = Number(it.total || 0);
  const get = (k) => counts[k] || 0;
  return {
    hasData: true,
    selfTotal: Number(self.count || 0),
    selfCases: get('立案信息'),
    selfHearings: get('开庭公告'),
    selfJudgments: get('裁判文书'),
    selfExecuted: get('被执行人'),
    selfAbnormal: get('经营异常'),
    selfPenalty: get('行政处罚') + get('环保处罚'),
    selfSerious: get('严重违法'),
    counts,
  };
}
