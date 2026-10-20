import db from '../db.js';
import { getPartner } from './partner-service.js';
import { listConnectors } from '../channels/registry.js';
import { getChannelPrimary } from '../channels/index.js';
import { getSetting } from './setting-service.js';
import { REASON, reasonMeta, reasonOfException, CATEGORY_LABEL } from '../channels/error-codes.js';

// 主力渠道选择：qcc / tianyancha / auto（全部并行）。返回应参与采集的渠道 key 集合，null 表示全部。
function resolveAllowedChannels(primary) {
  if (primary === 'qcc') return new Set(['qcc']);
  if (primary === 'tianyancha') return new Set(['tianyancha']);
  return null;
}

const now = () => new Date();

// 渠道中文名。信用中国/执行信息公开网已停用（不再注册），保留映射仅用于历史 fetch_task 记录展示
const CHANNEL_LABEL = {
  qcc: '企查查',
  tianyancha: '天眼查',
  creditChina: '信用中国（已停用）',
  zhixing: '执行信息公开网（已停用）',
};

// reasonCode → fetch_task.status（状态只用于聚合统计，具体原因看 reason_code）
const STATUS_OF_REASON = {
  [REASON.DISABLED]: 'skipped',
  [REASON.NOT_CONFIGURED]: 'error',
  [REASON.NOT_IMPLEMENTED]: 'not_implemented',
  [REASON.MISMATCH]: 'mismatch',
};

export async function saveRaw(partnerId, channel, bizKey, payload) {
  const r = await db.run(
    'INSERT INTO partner_raw (partner_id, channel, biz_key, payload_json, fetched_at) VALUES (?, ?, ?, ?, ?)',
    [partnerId, channel, bizKey || null, JSON.stringify(payload ?? null), now()],
  );
  return Number(r.lastInsertRowid);
}

export async function saveJudicial(partnerId, items = []) {
  let n = 0;
  for (const it of items) {
    await db.run(
      `INSERT INTO partner_judicial
        (partner_id, case_type, party_role, case_no, court, amount, status, date, detail_json, fetched_at, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        partnerId,
        it.caseType || null,
        it.partyRole || null,
        it.caseNo || null,
        it.court || null,
        it.amount ?? null,
        it.status || null,
        it.date || null,
        it.detail ? JSON.stringify(it.detail) : null,
        now(),
        'channel',
      ],
    );
    n++;
  }
  return n;
}

export async function saveCredit(partnerId, items = []) {
  if (!items.length) return 0;
  // 同一客户重复采集会拿到完全相同的条目（天眼查 7 个风险接口每次全量返回）；
  // 先取已有签名去重，避免风险项被重复计数导致评分虚高
  const existing = await db.all(
    "SELECT item_type, reason, date FROM partner_credit WHERE partner_id = ? AND data_source = 'channel'",
    [partnerId],
  );
  const seen = new Set(existing.map((r) => `${r.item_type || ''}|${r.reason || ''}|${r.date || ''}`));

  let n = 0;
  for (const it of items) {
    const sig = `${it.itemType || ''}|${it.reason || ''}|${it.date || ''}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    await db.run(
      `INSERT INTO partner_credit
        (partner_id, item_type, authority, reason, penalty, date, detail_json, fetched_at, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        partnerId,
        it.itemType || null,
        it.authority || null,
        it.reason || null,
        it.penalty || null,
        it.date || null,
        it.detail ? JSON.stringify(it.detail) : null,
        now(),
        'channel',
      ],
    );
    n++;
  }
  return n;
}

export async function saveFinance(partnerId, items = []) {
  let n = 0;
  for (const it of items) {
    await db.run(
      `INSERT INTO partner_finance
        (partner_id, src, rev_yoy, profit, scale_tag, employee_cnt, bid_cnt, detail_json, fetched_at, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        partnerId,
        it.src || null,
        it.revYoy || null,
        it.profit || null,
        it.scaleTag || null,
        it.employeeCnt ?? null,
        it.bidCnt ?? null,
        it.detail ? JSON.stringify(it.detail) : null,
        now(),
        'channel',
      ],
    );
    n++;
  }
  return n;
}

// 别名列（alias_names 存 JSON 数组）
function parseAlias(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// 用渠道返回的工商基本信息回填客户主档：只补空、不覆盖人工已填值（fill-only）
async function backfillPartnerBasic(partner, basic = {}) {
  if (!basic || typeof basic !== 'object') return { updated: false, fields: [] };

  const sets = [];
  const params = [];
  const put = (col, value, validate) => {
    if (value === undefined || value === null || value === '') return;
    if (partner[col]) return;
    if (validate && !validate(value)) return;
    sets.push(`${col} = ?`);
    params.push(typeof value === 'string' ? value.slice(0, 255) : value);
  };

  put('name', basic.name);
  put('legal_person', basic.legalPerson, (v) => String(v).length <= 64);
  put('reg_status', basic.regStatus);
  put('province', basic.province);
  put('industry', basic.industry);
  put('credit_code', basic.creditCode, (v) => /^[0-9A-Z]{18}$/.test(v));

  const history = Array.isArray(basic.historyNames) ? basic.historyNames.filter(Boolean).slice(0, 10) : [];
  if (history.length) {
    const existing = parseAlias(partner.alias_names);
    const merged = [...new Set([...existing, ...history])].slice(0, 10);
    if (merged.length > existing.length) {
      sets.push('alias_names = ?');
      params.push(JSON.stringify(merged));
    }
  }

  if (!sets.length) return { updated: false, fields: [] };

  const fields = sets.map((s) => s.split(' ')[0]);
  sets.push('updated_at = ?');
  params.push(now(), Number(partner.id));
  try {
    await db.run(`UPDATE partner SET ${sets.join(', ')} WHERE id = ?`, params);
    return { updated: true, fields };
  } catch (e) {
    // 典型场景：credit_code 与已有客户唯一键冲突 → 整体放弃回填，但不影响维度落库
    return { updated: false, fields: [], error: e.message };
  }
}

// 采集：遍历所有渠道（含未配置），逐个调用并记录任务；配置齐全的渠道落 raw + 维度
export async function collectPartner(partnerId) {
  const partner = await getPartner(partnerId);
  if (!partner) throw new Error('客户不存在');

  const recordRaw = await getSetting('collect.recordRaw', true);
  const allowed = resolveAllowedChannels(getChannelPrimary());
  const connectors = listConnectors().filter((c) => !allowed || allowed.has(c.key));
  const tasks = [];
  for (const c of connectors) {
    const started = Date.now();
    let status;
    let reasonCode = null;
    let errMsg = null;
    let basicFilled = [];
    let mode = null;

    if (!c.enabled) {
      // 用户没启用该渠道 → 属于预期内的"不参与本次采集"，不能出现在失败提示里
      status = 'skipped';
      reasonCode = REASON.DISABLED;
      errMsg = '未启用，本次不参与采集';
    } else if (!c.isConfigured()) {
      // 开关是打开的却缺 Key：这是配置问题，必须提示，否则会永远静默不工作
      status = 'error';
      reasonCode = REASON.NOT_CONFIGURED;
      errMsg = '渠道已启用但未填写 API Key（请求未发出）';
    } else {
      try {
        // 第二个参数传入完整 partner，便于渠道做主体校验（信用代码/名称/曾用名/法人）
        const result = partner.credit_code
          ? await c.fetchDetail(partner.credit_code, partner)
          : await c.search(partner.name, partner);

        mode = result?.mode || null;
        if (result && result.ok) {
          status = 'ok';
          if (recordRaw) await saveRaw(partnerId, c.key, partner.credit_code || partner.name, result);
          const normalized = result.normalized || {};
          if (normalized.basic) {
            const fill = await backfillPartnerBasic(partner, normalized.basic);
            basicFilled = fill.fields || [];
            if (fill.error) errMsg = `基本信息回填失败：${fill.error}`;
          }
          if (Array.isArray(normalized.judicial)) await saveJudicial(partnerId, normalized.judicial);
          if (Array.isArray(normalized.credit)) await saveCredit(partnerId, normalized.credit);
          if (Array.isArray(normalized.finance)) await saveFinance(partnerId, normalized.finance);
        } else {
          // 失败原因一律由渠道给出 reasonCode，这里只做映射；老渠道没给就按"是否真发过请求"兜底
          const mismatch = result?.meta?.match && result.meta.match.matched === false;
          reasonCode = result?.reasonCode || (mismatch ? REASON.MISMATCH : mode ? REASON.API_ERROR : REASON.NOT_IMPLEMENTED);
          if (mismatch) reasonCode = REASON.MISMATCH;
          status = STATUS_OF_REASON[reasonCode] || 'error';
          errMsg = result?.reason || '渠道未返回数据';
          if (recordRaw) await saveRaw(partnerId, c.key, partner.credit_code || partner.name, result || null);
        }
      } catch (e) {
        // 抛异常基本都是网络/超时/代码 bug，不能混同为"未实现"
        reasonCode = reasonOfException(e);
        status = STATUS_OF_REASON[reasonCode] || 'error';
        errMsg = e.message;
      }
    }

    const costMs = Date.now() - started;
    await db.run(
      'INSERT INTO fetch_task (partner_id, channel, status, reason_code, cost_ms, err_msg, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [partnerId, c.key, status, reasonCode, costMs, errMsg, now()],
    );
    const meta = reasonMeta(reasonCode);
    tasks.push({
      channel: c.key,
      channelLabel: CHANNEL_LABEL[c.key] || c.key,
      status,
      reasonCode,
      reasonLabel: status === 'ok' ? '成功' : meta.label,
      category: status === 'ok' ? null : meta.category,
      hint: status === 'ok' ? null : meta.hint,
      costMs,
      err: errMsg,
      mode,
      basicFilled,
    });
  }

  // 系统设置：采集后自动重算（失败不阻断采集结果返回）
  let scored = null;
  let scoreError = null;
  if (await getSetting('scoring.autoRecalcOnCollect', true)) {
    try {
      const { ratePartner } = await import('./scoring-service.js');
      scored = await ratePartner(partnerId);
    } catch (e) {
      scoreError = e.message;
    }
  }

  // 结果摘要：只汇总「实际参与本次采集」的渠道。
  // 未启用的渠道（如没配 Key 的企查查）属于预期不参与，不列出、不计失败，避免误导成报错。
  const active = tasks.filter((t) => t.status !== 'skipped');
  const skippedCount = tasks.length - active.length;

  const okCount = active.filter((t) => t.status === 'ok').length;
  const failed = active.filter((t) => t.status === 'error' || t.status === 'mismatch').length;

  const byCategory = {};
  for (const t of active) {
    if (t.status === 'ok') continue;
    const cat = t.category || 'unknown';
    (byCategory[cat] ||= []).push(CHANNEL_LABEL[t.channel] || t.channel);
  }

  const summary =
    active
      .map((t) => {
        const label = CHANNEL_LABEL[t.channel] || t.channel;
        return t.status === 'ok' ? `${label} 成功` : `${label} ${t.reasonLabel}`;
      })
      .join('；') || '本次没有启用的采集渠道';

  const detail = active
    .filter((t) => t.status !== 'ok')
    .map((t) => {
      const label = CHANNEL_LABEL[t.channel] || t.channel;
      const raw = String(t.err || t.hint || '无返回');
      // 错误文案常以渠道名开头，避免“天眼查：天眼查返回错误…”重复
      const text = raw.startsWith(label) ? raw.slice(label.length).trim() : raw;
      return `${label}（${CATEGORY_LABEL[t.category] || '未知'}）：${text}`;
    })
    .join('；');

  // 按“最该先处理”的顺序给一句行动建议
  const ADVICE_ORDER = ['billing', 'quota', 'entitlement', 'config', 'network', 'data', 'code', 'api', 'unknown'];
  const ADVICE = {
    billing: '账户余额不足 → 需到开放平台充值，不是系统问题',
    quota: '本地日额度用尽 → 可在「系统设置 → 数据渠道」上调日调用/日成本上限',
    entitlement: '接口未开通 → 需在开放平台购买/开通对应接口',
    config: '配置问题 → 检查 API Key、渠道开关与鉴权头（裸 token，不带 Bearer）',
    network: '网络/超时 → 稍后重试，或检查本机网络与代理',
    data: '数据问题 → 客户档案缺字段或主体不一致，按明细补全/核对',
    code: '系统问题 → 相关渠道 Connector 尚未实现，需开发补齐',
    api: '渠道返回业务错误 → 见明细中的原始报文',
    unknown: '原因未识别 → 见明细中的原始错误',
  };
  const firstCat = ADVICE_ORDER.find((c) => byCategory[c]?.length);
  const advice = firstCat ? ADVICE[firstCat] : null;

  return {
    partnerId,
    tasks,
    summary,
    detail,
    advice,
    byCategory,
    okCount,
    failed,
    skippedCount,
    scored,
    scoreError,
  };
}

export async function listFetchTasks(partnerId) {
  return db.all('SELECT * FROM fetch_task WHERE partner_id = ? ORDER BY id DESC', [partnerId]);
}

// 采集任务汇总：按渠道+状态计数
export async function getCollectSummary(partnerId) {
  const rows = await db.all(
    `SELECT channel, status, COUNT(*) AS cnt
     FROM fetch_task WHERE partner_id = ?
     GROUP BY channel, status ORDER BY channel, status`,
    [partnerId],
  );
  const items = rows.map((r) => ({ channel: r.channel, status: r.status, count: Number(r.cnt) }));
  return { total: items.reduce((s, x) => s + x.count, 0), items };
}

// 只返回有案号的司法记录：无案号的历史 AI 推断（2026-10 之前写入）不参与评分，也不展示。
// 数据仍在表里可追溯，需要彻底清理时按 data_source='ai' AND case_no='' 单独处理。
//
// 例外：天眼AI（data_source='tyc_mcp'）是渠道核实数据，可信度与 AI 推断不同。
// 失信被执行人 / 限制高消费 在官方返回里允许没有案号（只有主体 + 发布日期），
// 若一并按「无案号即丢弃」处理，会让评分卡的一票否决（失信/限高）永远不触发，故豁免。
export async function getJudicial(partnerId) {
  return db.all(
    `SELECT * FROM partner_judicial
      WHERE partner_id = ?
        AND (IFNULL(case_no, '') <> '' OR data_source = 'tyc_mcp')
      ORDER BY id DESC`,
    [partnerId],
  );
}

// 空壳合规记录（只有类型，无事由/机关/日期）不展示、不计分：
// 这类记录没有可核验内容，却会按"条数"扣分，属于典型的 AI 幻觉产物。
export async function getCredit(partnerId) {
  return db.all(
    `SELECT * FROM partner_credit
      WHERE partner_id = ?
        AND NOT (IFNULL(reason, '') = '' AND IFNULL(authority, '') = '' AND date IS NULL)
      ORDER BY id DESC`,
    [partnerId],
  );
}

export async function getFinance(partnerId) {
  const rows = await db.all('SELECT * FROM partner_finance WHERE partner_id = ? ORDER BY id DESC', [partnerId]);
  // 兼容早期写在 detail_json 里的上市公司字段（现已有独立列），列上为空时回填
  return rows.map((r) => {
    if (r.stock_code || !r.detail_json) return r;
    let d = {};
    try {
      d = JSON.parse(r.detail_json) || {};
    } catch {
      return r;
    }
    return {
      ...r,
      stock_code: r.stock_code || d.stockCode || null,
      report_period: r.report_period || d.reportPeriod || null,
      listed_status: r.listed_status || d.listedStatus || null,
    };
  });
}

// ===== 手工录入：司法 / 信用 / 财务 单条 CRUD（渠道不可用时的真实数据入口）=====
const DIMENSIONS = {
  judicial: {
    table: 'partner_judicial',
    fields: {
      caseType: 'case_type',
      partyRole: 'party_role',
      caseNo: 'case_no',
      court: 'court',
      amount: 'amount',
      status: 'status',
      date: 'date',
    },
    prefix: ['case_type', 'party_role', 'case_no', 'court', 'amount', 'status', 'date', 'detail_json', 'fetched_at'],
  },
  credit: {
    table: 'partner_credit',
    fields: {
      itemType: 'item_type',
      authority: 'authority',
      reason: 'reason',
      penalty: 'penalty',
      date: 'date',
    },
    prefix: ['item_type', 'authority', 'reason', 'penalty', 'date', 'detail_json', 'fetched_at'],
  },
  finance: {
    table: 'partner_finance',
    fields: {
      src: 'src',
      stockCode: 'stock_code',
      reportPeriod: 'report_period',
      listedStatus: 'listed_status',
      revYoy: 'rev_yoy',
      profit: 'profit',
      scaleTag: 'scale_tag',
      employeeCnt: 'employee_cnt',
      bidCnt: 'bid_cnt',
    },
    prefix: [
      'src',
      'stock_code',
      'report_period',
      'listed_status',
      'rev_yoy',
      'profit',
      'scale_tag',
      'employee_cnt',
      'bid_cnt',
      'detail_json',
      'fetched_at',
    ],
  },
};

function dimDef(kind) {
  const def = DIMENSIONS[kind];
  if (!def) throw new Error(`不支持的维度类型: ${kind}`);
  return def;
}

function pickColumns(def, item = {}) {
  const cols = [];
  const params = [];
  for (const [key, col] of Object.entries(def.fields)) {
    if (item[key] === undefined) continue;
    let v = item[key];
    if (v === '') v = null;
    cols.push(col);
    params.push(v);
  }
  if (item.detail !== undefined) {
    cols.push('detail_json');
    params.push(item.detail === null ? null : JSON.stringify(item.detail));
  }
  return { cols, params };
}

export async function listDimension(kind, partnerId) {
  const def = dimDef(kind);
  return db.all(`SELECT * FROM ${def.table} WHERE partner_id = ? ORDER BY id DESC`, [Number(partnerId)]);
}

export async function createDimension(kind, partnerId, item = {}) {
  const def = dimDef(kind);
  // 硬约束：司法记录必须有案号。没有案号既无法核验真伪，也无法与后续天眼查司法接口对齐，
  // 一律不予落库（AI 路径在 ai-service 已先过滤，这里兜住手工录入）。
  if (kind === 'judicial' && !String(item.caseNo || '').trim()) {
    throw new Error('司法记录必须填写案号，否则不予记录');
  }
  const { cols, params } = pickColumns(def, item);
  const source = ['manual', 'channel', 'ai', 'demo'].includes(item.dataSource) ? item.dataSource : 'manual';
  const allCols = ['partner_id', ...cols, 'fetched_at', 'data_source'];
  const allParams = [Number(partnerId), ...params, now(), source];
  const r = await db.run(
    `INSERT INTO ${def.table} (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')})`,
    allParams,
  );
  return db.get(`SELECT * FROM ${def.table} WHERE id = ?`, [Number(r.lastInsertRowid)]);
}

export async function updateDimension(kind, partnerId, id, item = {}) {
  const def = dimDef(kind);
  const row = await db.get(`SELECT * FROM ${def.table} WHERE id = ? AND partner_id = ?`, [Number(id), Number(partnerId)]);
  if (!row) throw new Error('记录不存在');
  const { cols, params } = pickColumns(def, item);
  if (!cols.length) return row;
  const sets = cols.map((c) => `${c} = ?`).join(', ');
  await db.run(`UPDATE ${def.table} SET ${sets}, fetched_at = ? WHERE id = ? AND partner_id = ?`, [
    ...params,
    now(),
    Number(id),
    Number(partnerId),
  ]);
  return db.get(`SELECT * FROM ${def.table} WHERE id = ?`, [Number(id)]);
}

export async function deleteDimension(kind, partnerId, id) {
  const def = dimDef(kind);
  const row = await db.get(`SELECT id FROM ${def.table} WHERE id = ? AND partner_id = ?`, [Number(id), Number(partnerId)]);
  if (!row) throw new Error('记录不存在');
  await db.run(`DELETE FROM ${def.table} WHERE id = ? AND partner_id = ?`, [Number(id), Number(partnerId)]);
  return { deleted: true };
}
