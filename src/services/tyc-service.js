import { createHash } from 'node:crypto';
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

// ===== 调用节流：一次同步不能把额度烧光 =====
// 固定清单 15 个工具，免费套餐每日只有 10 次有效调用，而 11 个风险明细工具在免费权益下
// 每次都会被 403 insufficient_entitlement 挡掉（不扣费但白等 13 秒）。四层拦截：
//   ① 结果缓存：同一客户同一工具 N 小时内已取过 → 复用 partner_raw，不再发请求
//   ② 权限记忆：被套餐挡掉的工具记入 sys_setting，后续同步直接跳过（到期自动重试探测）
//   ③ 额度熔断：一旦命中 402 quota_exhausted，本轮剩余工具全部标记跳过，不再空跑
//   ④ 多账号轮换：某账号额度用尽/无权限 → 自动换下一个账号（见 config/channels.js 的 tokens）
const envNum = (name, def) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
};
const RAW_CACHE_HOURS = Math.max(0, envNum('TIANYANCHA_MCP_CACHE_HOURS', 24)); // 0 = 关闭缓存
const DENIED_TTL_DAYS = Math.max(1, envNum('TIANYANCHA_MCP_DENIED_TTL_DAYS', 7));
const DENIED_SETTING_KEY = 'tyc.mcp.deniedTools';
// 旧版全局额度标记（仅保留迁移读取，新数据按账号写 tyc.mcp.quota.<指纹>）
const QUOTA_SETTING_KEY = 'tyc.mcp.quotaExhaustedDate';
// key 无效/连不上的账号（401 等），按指纹记录，避免每次同步都白连一次
const BAD_SETTING_KEY = 'tyc.mcp.badTokens';

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

// 额度类错误必须与「权益未开通」区分开：
// - 权益未开通（403 insufficient_entitlement）→ 要升级套餐，重试无用
// - 额度用尽（402 quota_exhausted）→ 等次日配额重置或加额度，套餐本身没问题
// 实测 402 报文里带「用量与权益页面」字样，会被权限正则误判，故先判额度
const QUOTA_HINTS = [/quota/i, /次数已用完/, /额度/, /超出.{0,4}(限额|限制)/, /\b402\b/];

function isQuotaError(message) {
  const s = String(message || '');
  return QUOTA_HINTS.some((re) => re.test(s));
}

// ===== 节流状态读写 =====

function localDateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// partner_raw.fetched_at 走的是 dateStrings:true，形如 '2026-10-19 23:09:30'
function parseDbTime(v) {
  if (!v) return NaN;
  if (v instanceof Date) return v.getTime();
  return Date.parse(String(v).replace(' ', 'T'));
}

function toolLabelOf(tool) {
  const hit = [...TYC_SYNC_TOOLS, ...OPTIONAL_TOOLS].find((t) => t.tool === tool || t.key === tool);
  return hit?.label || tool;
}

async function persistSetting(key, value, description) {
  await db.run(
    `INSERT INTO sys_setting (setting_key, setting_value, description, updated_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), description = VALUES(description), updated_at = VALUES(updated_at)`,
    [key, value, description, new Date()],
  );
}

// ===== 多账号 token 池 =====
// 免费版每个账号每天只有 10 次有效调用，多个手机号注册即可叠加额度。
// 池子来自 config/channels.js（TIANYANCHA_MCP_TOKEN + TIANYANCHA_MCP_TOKENS 合并去重）。
function tokenList() {
  const cfg = channels.tianyanchaMcp || {};
  const list = Array.isArray(cfg.tokens) && cfg.tokens.length ? cfg.tokens : [cfg.token].filter(Boolean);
  return [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
}

// token 不明文落库：设置键与权限记忆都用指纹分组
function tokenFp(token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}

const tokenQuotaKey = (fp) => `tyc.mcp.quota.${fp}`;

// 读取节流状态（按账号）：
// - denied: { [tokenFp]: { [tool]: { at, message } } }（兼容旧版「全局平铺」，归到首个账号）
// - quota:  { [tokenFp]: 'YYYY-MM-DD' }（该账号当天额度已用尽；兼容旧全局标记，归到首个账号）
// - bad:    { [tokenFp]: { at, message } }（key 无效/连不上，避免每次同步白连）
// 过期记录自动丢弃（升级套餐 / 改好 key 后能自愈）
async function loadToolPolicy(tokens = tokenList()) {
  const fps = tokens.map(tokenFp);
  const keys = [DENIED_SETTING_KEY, QUOTA_SETTING_KEY, BAD_SETTING_KEY, ...fps.map(tokenQuotaKey)];
  const denied = {};
  const quota = {};
  const bad = {};
  try {
    const rows = await db.all(
      `SELECT setting_key, setting_value FROM sys_setting WHERE setting_key IN (${keys.map(() => '?').join(',')})`,
      keys,
    );
    const map = new Map(rows.map((r) => [r.setting_key, r.setting_value]));

    const cutoff = Date.now() - DENIED_TTL_DAYS * 86400000;
    const fresh = (info) => {
      const at = Date.parse(String(info?.at || ''));
      return Number.isFinite(at) && at >= cutoff;
    };
    const prune = (src) => {
      const out = {};
      for (const [name, info] of Object.entries(src || {})) if (fresh(info)) out[name] = info;
      return out;
    };

    const parsed = JSON.parse(map.get(DENIED_SETTING_KEY) || 'null');
    if (parsed && parsed.v === 2 && parsed.tokens) {
      for (const [fp, byTool] of Object.entries(parsed.tokens)) {
        const kept = prune(byTool);
        if (Object.keys(kept).length) denied[fp] = kept;
      }
    } else if (parsed && typeof parsed === 'object') {
      // 旧结构（不分账号）：归给首个账号
      const kept = prune(parsed);
      if (Object.keys(kept).length && fps[0]) denied[fps[0]] = kept;
    }

    const legacyQuota = String(map.get(QUOTA_SETTING_KEY) || '').trim();
    for (const fp of fps) {
      const d = String(map.get(tokenQuotaKey(fp)) || '').trim();
      if (d) quota[fp] = d;
      else if (fp === fps[0] && legacyQuota) quota[fp] = legacyQuota;
    }

    Object.assign(bad, prune(JSON.parse(map.get(BAD_SETTING_KEY) || 'null') || {}));
  } catch {
    // 节流状态读不出来不影响主流程，退化为「不做跳过」
  }
  return { denied, quota, bad, fps };
}

async function saveDeniedTools(denied) {
  const hasAny = Object.values(denied || {}).some((m) => m && Object.keys(m).length);
  if (!hasAny) {
    await db.run('DELETE FROM sys_setting WHERE setting_key = ?', [DENIED_SETTING_KEY]);
    return;
  }
  await persistSetting(
    DENIED_SETTING_KEY,
    JSON.stringify({ v: 2, tokens: denied }),
    `天眼AI 权益未开通的工具（按账号记录，${DENIED_TTL_DAYS} 天后自动重试探测）`,
  );
}

async function saveBadTokens(bad) {
  if (!Object.keys(bad || {}).length) {
    await db.run('DELETE FROM sys_setting WHERE setting_key = ?', [BAD_SETTING_KEY]);
    return;
  }
  await persistSetting(
    BAD_SETTING_KEY,
    JSON.stringify(bad),
    `天眼AI key 无效/连接失败的账号（${DENIED_TTL_DAYS} 天后自动重试；改好 key 后指纹变化即视为新账号）`,
  );
}

async function loadCachedRaw(pid) {
  const rows = await db.all(
    `SELECT biz_key, payload_json, fetched_at FROM partner_raw WHERE partner_id = ? AND channel = ? ORDER BY id DESC`,
    [pid, CHANNEL],
  );
  const latest = {};
  for (const r of rows) if (!latest[r.biz_key]) latest[r.biz_key] = r;
  return latest;
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
  return tokenList().length > 0;
}

// 每个账号一个客户端（token 可指定；不传则用池内第一个，兼容旧调用）
function makeClient(token) {
  const cfg = channels.tianyanchaMcp || {};
  return new TycMcpClient({ token: token || cfg.token, endpoint: cfg.endpoint, timeoutMs: cfg.timeoutMs });
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
    // 权益/额度类错误重试多少次都一样：直接抛出，绝不能再走参数兼容或调度器兜底
    // （否则一次同步的调用次数会被放大，白烧额度）
    if (isQuotaError(msg) || isPermissionError(msg)) throw e;
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

// options.force = true：忽略缓存与权限记忆，强制全量重新调用（套餐升级后用它验证/补齐）
// 多账号：某个账号额度用尽 / 未开通该工具 → 自动换下一个账号继续，直到取到数据或账号全部试完
export async function syncTycProfile(partnerId, companyName, options = {}) {
  const tokens = tokenList();
  if (!tokens.length) throw new Error('未配置 TIANYANCHA_MCP_TOKEN / TIANYANCHA_MCP_TOKENS，无法调用天眼AI');
  const name = String(companyName || '').trim();
  if (!name) throw new Error('缺少企业名称');

  const pid = Number(partnerId);
  const force = options.force === true;
  const today = localDateStr();

  // 节流状态先读：已落库报文（结果缓存）、各账号的权限记忆、今日额度、key 是否有效
  const [{ denied: deniedLoaded, quota: quotaLoaded, bad: badLoaded, fps }, cachedRaw] = await Promise.all([
    loadToolPolicy(tokens),
    loadCachedRaw(pid),
  ]);

  // 每个账号一条运行时状态：今日额度是否用尽、该账号的权限记忆、懒建立的连接
  const accounts = tokens.map((token, i) => ({
    token,
    fp: fps[i],
    index: i + 1,
    client: null,
    dead: force ? false : Boolean(badLoaded[fps[i]]),
    deadReason: force ? '' : badLoaded[fps[i]]?.message || '',
    denied: force ? {} : { ...(deniedLoaded[fps[i]] || {}) },
    quotaDate: force ? null : quotaLoaded[fps[i]] || null,
  }));
  const isBlocked = (st) => Boolean(st.quotaDate && st.quotaDate === today);
  const badNow = {}; // { fp: { at, message } }：本轮确认 key 无效/连不上的账号

  // 懒连接：401/网络失败即弃用该账号，换下一个
  const ensureClient = async (st) => {
    if (st.client) return st.client;
    if (st.dead) return null;
    try {
      const c = makeClient(st.token);
      await c.connect();
      st.client = c;
      return c;
    } catch (e) {
      st.dead = true;
      st.deadReason = e.message || '账号连接失败';
      badNow[st.fp] = { at: new Date().toISOString(), message: String(st.deadReason).slice(0, 300) };
      return null;
    }
  };

  const done = [];
  const failed = [];
  const skipped = [];
  const warnings = [];
  const dimensions = { judicial: 0, credit: 0, finance: 0 };
  const deniedNow = {}; // { fp: { tool: { at, message } } }
  const okByFp = new Map(); // fp -> Set(tool)：本轮成功取数的工具（用于清理权限记忆与额度标记）
  let called = 0; // 本轮真实发起的工具调用次数（只有成功取数的才计入额度）

  const absorb = (applied) => {
    dimensions.judicial += applied.counts.judicial;
    dimensions.credit += applied.counts.credit;
    dimensions.finance += applied.counts.finance;
    warnings.push(...applied.warnings);
  };

  // 先用第一个可用账号探测可选工具（破产重整）；tools/list 不消耗企业数据额度
  let extras = [];
  let names = [];
  for (const st of accounts) {
    const client = await ensureClient(st);
    if (!client) continue;
    const found = await discoverOptionalTools(client);
    extras = found.extras;
    names = found.names;
    break;
  }
  const tools = [...TYC_SYNC_TOOLS, ...extras];

  const allBlocked = () => accounts.length > 0 && accounts.every(isBlocked);

  for (const t of tools) {
    const mark = (reason, extra = {}) => skipped.push({ key: t.key, tool: t.tool, label: t.label, reason, ...extra });

    // ① 结果缓存命中：复用已落库报文重放（不请求、不扣额度，还能顺带吃到新的归一化规则）
    const cached = cachedRaw[t.key];
    let cacheHit = false;
    if (!force && cached && RAW_CACHE_HOURS > 0) {
      const age = Date.now() - parseDbTime(cached.fetched_at);
      if (Number.isFinite(age) && age >= 0 && age < RAW_CACHE_HOURS * 3600000) {
        try {
          const payload = JSON.parse(cached.payload_json);
          absorb(await applyToolPayload(pid, t.normAs || t.tool, payload));
          mark('cache', {
            cachedAt: cached.fetched_at,
            message: `${RAW_CACHE_HOURS} 小时内已取过该客户数据，直接复用缓存`,
          });
          cacheHit = true;
        } catch {
          cacheHit = false; // 缓存报文坏了就当没缓存，继续实时调用
        }
      }
    }
    if (cacheHit) continue;

    // ② 逐个账号尝试：某账号额度用尽 / 该工具被其权益挡掉 → 换下一个账号
    const tried = new Set();
    let last = null; // { kind: quota | permission | unavailable, message }
    let permissionMessage = null; // 本轮该工具真实拿到的 403 报文（决定最终算「失败」还是「已知跳过」）
    let finished = false;
    while (!finished) {
      const st = accounts.find((a) => !a.dead && !isBlocked(a) && !tried.has(a.fp) && !a.denied[t.tool]);
      if (!st) break;
      tried.add(st.fp);

      const client = await ensureClient(st);
      if (!client) {
        last = { kind: 'unavailable', message: st.deadReason || '账号连接/鉴权失败' };
        continue;
      }

      if (called > 0) await sleep(CALL_INTERVAL_MS); // 频率限制：上一项成功/失败都留间隔
      called += 1;
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
        absorb(applied);

        done.push({
          key: t.key,
          tool: t.tool,
          label: t.label,
          inserted: applied.counts,
          account: st.index,
        });
        if (!okByFp.has(st.fp)) okByFp.set(st.fp, new Set());
        okByFp.get(st.fp).add(t.tool);
        finished = true;
      } catch (e) {
        const quotaExceeded = isQuotaError(e.message);
        const permissionDenied = !quotaExceeded && isPermissionError(e.message);
        if (quotaExceeded) {
          // 该账号今日额度用尽：记下日期后换下一个账号（402 这次调用本身不扣额度）
          st.quotaDate = today;
          last = { kind: 'quota', message: String(e.message || '今日额度已用尽') };
          continue;
        }
        if (permissionDenied) {
          // 该账号权益未开通：记入该账号的权限记忆，换下一个账号再试
          const info = { at: new Date().toISOString(), message: String(e.message || '').slice(0, 300) };
          st.denied[t.tool] = info;
          if (!deniedNow[st.fp]) deniedNow[st.fp] = {};
          deniedNow[st.fp][t.tool] = info;
          permissionMessage = e.message;
          last = { kind: 'permission', message: e.message };
          continue;
        }
        // 401/网络等：本轮弃用该账号
        st.dead = true;
        st.deadReason = e.message;
        last = { kind: 'unavailable', message: e.message };
      }
    }
    if (finished) continue;

    // ③ 所有账号都不行：区分「真的失败」与「已知跳过」
    const usable = accounts.filter((a) => !a.dead && !isBlocked(a));
    if (last?.kind === 'quota') {
      failed.push({ key: t.key, tool: t.tool, label: t.label, message: last.message, quotaExceeded: true, permissionDenied: false });
    } else if (permissionMessage) {
      failed.push({ key: t.key, tool: t.tool, label: t.label, message: permissionMessage, quotaExceeded: false, permissionDenied: true });
    } else if (usable.length && usable.every((a) => a.denied[t.tool])) {
      mark('permission', { message: usable[0].denied[t.tool]?.message || '所有账号均未开通该工具' });
    } else if (allBlocked()) {
      mark('quota', { message: `今日 ${accounts.length} 个账号的额度均已用尽` });
    } else if (!usable.length && accounts.some((a) => a.dead)) {
      mark('unavailable', { message: accounts.find((a) => a.deadReason)?.deadReason || '账号不可用' });
    } else if (!usable.length) {
      mark('quota', { message: '今日可用账号的额度均已用尽' });
    } else {
      mark('unavailable', { message: last?.message || '账号不可用' });
    }
  }

  // 权限记忆（按账号）：以「已记录的权限记忆」为基线维护——
  // 本轮成功的工具移出该账号的黑名单（可能已升级套餐）；本轮新发现 403 的记入；
  // 因额度熔断/缓存而没真正探测过的工具保持原状（否则中断的一轮会把记忆抹掉，下轮又白调一轮）
  const nextDenied = {};
  for (const st of accounts) {
    const base = { ...(deniedLoaded[st.fp] || {}), ...(deniedNow[st.fp] || {}) };
    for (const tool of okByFp.get(st.fp) || []) delete base[tool];
    if (Object.keys(base).length) nextDenied[st.fp] = base;
  }
  await saveDeniedTools(nextDenied);

  // 额度标记（按账号）：命中的记今日日期（次日自动失效）；本轮成功取数的账号说明还有额度，清掉标记
  for (const st of accounts) {
    if (isBlocked(st)) {
      await persistSetting(tokenQuotaKey(st.fp), today, '天眼AI 该账号今日额度已用尽（次日自动失效）');
    } else if (okByFp.has(st.fp)) {
      await db.run('DELETE FROM sys_setting WHERE setting_key = ?', [tokenQuotaKey(st.fp)]);
    }
  }
  // 旧版全局额度标记已迁移到账号维度，删掉避免重复判断
  await db.run('DELETE FROM sys_setting WHERE setting_key = ?', [QUOTA_SETTING_KEY]);

  // key 无效/连不上的账号：记下来避免每次同步白连；本轮连上了就移除记录
  const nextBad = {};
  for (const st of accounts) {
    if (st.client) continue;
    if (badNow[st.fp]) nextBad[st.fp] = badNow[st.fp];
    else if (badLoaded[st.fp]) nextBad[st.fp] = badLoaded[st.fp];
  }
  await saveBadTokens(nextBad);

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
    skipped,
    warnings: [...new Set(warnings)],
    dimensions,
    summary: {
      total: tools.length,
      ok: done.length,
      failed: failed.length,
      permissionDenied: failed.filter((f) => f.permissionDenied).length,
      quotaExceeded: failed.filter((f) => f.quotaExceeded).length,
      skipped: skipped.length,
      skippedCache: skipped.filter((s) => s.reason === 'cache').length,
      skippedPermission: skipped.filter((s) => s.reason === 'permission').length,
      skippedQuota: skipped.filter((s) => s.reason === 'quota').length,
      skippedUnavailable: skipped.filter((s) => s.reason === 'unavailable').length,
      called,
      accounts: accounts.length,
      availableAccounts: accounts.filter((a) => !a.dead && !isBlocked(a)).length,
      cacheHours: RAW_CACHE_HOURS,
      forced: force,
    },
    // 便于排查：服务端到底暴露了多少工具、其中哪些是本次动态发现的、各账号状态如何
    toolsInfo: {
      available: names.length,
      used: tools.length,
      discovered: extras.map((e) => e.tool),
      accounts: accounts.map((a) => ({
        index: a.index,
        quotaExhaustedToday: isBlocked(a),
        unusable: a.dead,
        deniedTools: Object.keys(a.denied).length,
      })),
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
  const pidNum = Number(partnerId);
  const readChannel = async (channel) => {
    const rows = await db.all(
      'SELECT biz_key, payload_json, fetched_at FROM partner_raw WHERE partner_id = ? AND channel = ? ORDER BY id DESC',
      [pidNum, channel],
    );
    const latest = {};
    for (const r of rows) if (!latest[r.biz_key]) latest[r.biz_key] = r;
    return latest;
  };
  // 多通道画像：天眼查优先，企查查兜底；画像页不区分来源
  const tycLatest = await readChannel(CHANNEL);
  const qccLatest = await readChannel('qcc');
  const latest = {};
  for (const key of new Set([...Object.keys(tycLatest), ...Object.keys(qccLatest)])) {
    latest[key] = tycLatest[key] || qccLatest[key];
  }
  const parseObj = (r) => {
    if (!r) return null;
    try {
      return JSON.parse(r.payload_json);
    } catch {
      return null;
    }
  };
  const parse = (k) => parseObj(latest[k]);
  // 逐个字段合并：前者非空优先，后者补空
  const mergeObj = (...objs) => {
    const out = {};
    for (const o of objs) {
      if (!o) continue;
      for (const [k, v] of Object.entries(o)) {
        const empty = out[k] === undefined || out[k] === null || out[k] === '';
        const emptyArr = Array.isArray(out[k]) && out[k].length === 0;
        if (empty || (emptyArr && Array.isArray(v) && v.length)) out[k] = v;
      }
    }
    return out;
  };

  const registration = (() => {
    const tycReg = pickRegistration(parseObj(tycLatest.registration));
    const qccReg = pickRegistration(parseObj(qccLatest.registration));
    if (!tycReg && !qccReg) return null;
    return mergeObj(tycReg, qccReg);
  })();
  const profileRaw = parse('profile');
  const riskRaw = parse('risk_overview');
  const iprRaw = parse('ipr_score');

  const groups = (riskRaw?.riskList || []).map((g) => ({
    name: g.name || g.title || g.type || '-',
    count: Number(g.count || 0),
    items: (g.list || []).map((i) => ({ name: i.name || i.title || '-', total: Number(i.total || 0) })),
  }));

  const providers = {
    tyc: Object.keys(tycLatest).length > 0,
    qcc: Object.keys(qccLatest).length > 0,
  };

  const syncedAt = Object.values({ ...tycLatest, ...qccLatest })
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

  // 节流状态：让页面知道「哪些工具因权益被跳过」「今天还有几个账号有额度」，
  // 不必等用户再点一次同步才发现又要失败。
  const tokens = tokenList();
  const fps = tokens.map(tokenFp);
  const { denied, quota, bad } = await loadToolPolicy(tokens);
  const today = localDateStr();
  const blockedCount = fps.filter((fp) => quota[fp] === today).length;
  const invalidList = fps
    .map((fp, i) => ({ index: i + 1, message: bad[fp]?.message || null }))
    .filter((x) => x.message);
  // 任一号被 403 的工具都列出来（同步时会自动换号，换不到才最终跳过）
  const deniedList = (() => {
    const merged = new Map();
    for (const fp of fps) {
      for (const [tool, info] of Object.entries(denied[fp] || {})) {
        if (!merged.has(tool)) merged.set(tool, info);
      }
    }
    return [...merged.entries()].map(([tool, info]) => ({
      tool,
      label: toolLabelOf(tool),
      at: info?.at || null,
      message: info?.message || null,
    }));
  })();

  return {
    configured: isTycConfigured(),
    syncedAt,
    providers,
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
    toolPolicy: {
      cacheHours: RAW_CACHE_HOURS,
      deniedTtlDays: DENIED_TTL_DAYS,
      accounts: tokens.length,
      availableAccounts: Math.max(0, tokens.length - blockedCount - invalidList.length),
      quotaExhaustedToday: tokens.length > 0 && blockedCount === tokens.length,
      invalidAccounts: invalidList,
      denied: deniedList,
    },
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
