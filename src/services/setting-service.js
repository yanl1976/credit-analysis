import db from '../db.js';
import { channels as channelDefaults } from '../../config/channels.js';

// 系统设置：白名单驱动，新增开关只需在此登记（含默认值/类型/范围），前端自动渲染
// 约定：
// - default 优先取环境变量（.env 作为兜底），DB 中的值覆盖 env
// - secret: true 的项在接口中脱敏返回，保存时留空表示不修改
export const SECRET_MASK = '••••••••';
export const SECRET_CLEAR = '__CLEAR__';

const tyc = channelDefaults.tianyancha || {};

export const SETTING_DEFS = [
  {
    group: '系统信息',
    key: 'system.name',
    label: '系统名称',
    type: 'string',
    default: '合作方资信分析系统',
    maxLength: 40,
    description: '登录页、侧边栏标题显示',
  },
  {
    group: '系统信息',
    key: 'system.owner',
    label: '运营单位',
    type: 'string',
    default: '',
    maxLength: 60,
    description: '可选，展示在系统信息中',
  },
  {
    group: '评分与预警',
    key: 'scoring.autoRecalcOnCollect',
    label: '采集后自动重算评分',
    type: 'boolean',
    default: true,
    description: '开启后，触发采集完成即自动重算该客户评分并留档',
  },
  {
    group: '评分与预警',
    key: 'scoring.autoRecalcOnManual',
    label: '手工录入后自动重算',
    type: 'boolean',
    default: true,
    description: '手工录入/修改/删除司法、信用、财务记录后，自动重算该客户评分',
  },
  {
    group: '评分与预警',
    key: 'warning.recordGradeChange',
    label: '等级变化写入预警',
    type: 'boolean',
    default: true,
    description: '关闭后重算仍更新评分，但不再产生等级变化预警事件',
  },
  {
    group: '评分与预警',
    key: 'review.cycleDays',
    label: '复审周期（天）',
    type: 'number',
    default: 90,
    min: 7,
    max: 1095,
    description: '评分完成或新建客户时，若客户未排复审日期，自动按该周期生成下次评估日期',
  },
  {
    group: '评分与预警',
    key: 'review.dueSoonDays',
    label: '复审临期提醒（天）',
    type: 'number',
    default: 14,
    min: 1,
    max: 365,
    description: '距下次评估日期小于该天数视为「临期」，看板与客户列表会提示；已过期视为「逾期」',
  },
  {
    group: '采集',
    key: 'collect.recordRaw',
    label: '保存渠道原始报文',
    type: 'boolean',
    default: true,
    description: '关闭后不再写入 partner_raw，可节省存储（排查问题时建议开启）',
  },
  {
    group: '界面',
    key: 'ui.pageSize',
    label: '列表默认分页条数',
    type: 'number',
    default: 20,
    min: 10,
    max: 100,
    description: '客户 / 预警列表默认每页条数',
  },

  // ===== 数据渠道：通用（主力选择） =====
  {
    group: '数据渠道 · 通用',
    key: 'channel.primary',
    label: '主力数据源',
    type: 'enum',
    default: 'auto',
    options: [
      { value: 'auto', label: '自动（企查查优先，失败回退天眼查）' },
      { value: 'qcc', label: '企查查（MCP）' },
      { value: 'tianyancha', label: '天眼查' },
    ],
    description: '采集时优先使用的渠道；auto 下企查查可用则优先，否则回退天眼查',
  },

  // ===== 数据渠道：企查查（MCP） =====
  {
    group: '数据渠道 · 企查查',
    key: 'channel.qcc.enabled',
    label: '启用企查查',
    type: 'boolean',
    default: Boolean(process.env.QCC_API_KEY),
    description: '开启后采集可调用企查查 MCP（company/risk/ipr/legal-case 等业务域）；需先配置下方 Token',
  },
  {
    group: '数据渠道 · 企查查',
    key: 'channel.qcc.apiKey',
    label: 'MCP Token',
    type: 'string',
    secret: true,
    default: process.env.QCC_API_KEY || '',
    maxLength: 200,
    description: '企查查 MCP 鉴权 Token（仅填 Token 值本身，不要带 Bearer 前缀，系统会自动添加）。保存后立即生效；接口不返回明文',
  },
  {
    group: '数据渠道 · 企查查',
    key: 'channel.qcc.base',
    label: 'MCP 网关地址',
    type: 'string',
    default: process.env.QCC_MCP_BASE || 'https://agent.qcc.com/mcp',
    maxLength: 200,
    description: '企查查 MCP 网关前缀，一般无需修改；各业务域 endpoint 在此之下拼接',
  },
  {
    group: '数据渠道 · 企查查',
    key: 'channel.qcc.unitCost',
    label: '单次调用成本（元）',
    type: 'number',
    decimals: 2,
    min: 0,
    max: 1000,
    default: Number(process.env.QCC_UNIT_COST || 0),
    description: '用于日成本预算累计，按实际采购价填写（0 表示不计成本）',
  },
  {
    group: '数据渠道 · 企查查',
    key: 'channel.qcc.dailyMaxCalls',
    label: '日调用上限（次）',
    type: 'number',
    min: 1,
    max: 100000,
    default: Number(process.env.QCC_DAILY_MAX_CALLS || 200),
    description: '超过上限后当天不再发起真实请求，避免烧穿预算',
  },
  {
    group: '数据渠道 · 企查查',
    key: 'channel.qcc.dailyMaxCost',
    label: '日成本上限（元）',
    type: 'number',
    decimals: 2,
    min: 0,
    max: 100000,
    default: Number(process.env.QCC_DAILY_MAX_COST || 0),
    description: '与「日调用上限」任一触达即停止当日调用；0 表示不限',
  },
  {
    group: '数据渠道 · 企查查',
    key: 'channel.qcc.riskDomains',
    label: '采集经营风险与司法域',
    type: 'boolean',
    default: false,
    description: '开启后采集企查查时额外调用 risk / regulation / legal-case 域，更新「经营风险」与「司法」维度；会多消耗额度，建议仅重点客户开启（默认关闭以节省额度）',
  },

  // ===== 数据渠道：天眼查 =====
  {
    group: '数据渠道 · 天眼查',
    key: 'channel.tianyancha.enabled',
    label: '启用天眼查',
    type: 'boolean',
    default: true,
    description: '关闭后采集时跳过该渠道（包括公开检索兜底）',
  },
  {
    group: '数据渠道 · 天眼查',
    key: 'channel.tianyancha.apiKey',
    label: 'API Key',
    type: 'string',
    secret: true,
    default: tyc.apiKey || '',
    maxLength: 200,
    description: '填写后走开放平台接口（按次计费、毫秒级）；留空则降级为公开检索兜底（约 1 分钟/家）。保存后立即生效',
  },
  {
    group: '数据渠道 · 天眼查',
    key: 'channel.tianyancha.base',
    label: '接口地址',
    type: 'string',
    default: tyc.base || 'https://open.api.tianyancha.com',
    maxLength: 200,
    description: '开放平台 API 根地址，一般无需修改',
  },
  {
    group: '数据渠道 · 天眼查',
    key: 'channel.tianyancha.baseinfoPath',
    label: '接口路径',
    type: 'string',
    default: tyc.baseinfoPath || '/services/open/ic/verify/2.0',
    maxLength: 200,
    description:
      '以开放平台控制台「已开通接口」为准。默认 /services/open/ic/verify/2.0（企业三要素验证 ID1074，只核验名称+代码+法人，不含注册资本等画像字段）；若已开通企业基本信息可改为 /services/v4/open/ic/baseinfo/normal',
  },
  {
    group: '数据渠道 · 天眼查',
    key: 'channel.tianyancha.riskApis',
    label: '采集经营风险接口',
    type: 'boolean',
    default: tyc.riskApis !== false,
    description:
      '开启后每个客户额外调用 7 个已开通接口（严重违法/经营异常/清算/欠税/税收违法/行政处罚/税务非正常户），按次计费；只做主体核验时可关闭',
  },
  {
    group: '数据渠道 · 天眼查',
    key: 'channel.tianyancha.unitCost',
    label: '单次调用成本（元）',
    type: 'number',
    decimals: 2,
    min: 0,
    max: 1000,
    default: Number(tyc.unitCost || 0.15),
    description: '用于日成本预算累计，按你的实际采购价填写',
  },
  {
    group: '数据渠道 · 天眼查',
    key: 'channel.tianyancha.dailyMaxCalls',
    label: '日调用上限（次）',
    type: 'number',
    min: 1,
    max: 100000,
    default: Number(tyc.dailyMaxCalls || 200),
    description: '超过上限后当天不再发起真实请求，避免批量导入烧穿预算',
  },
  {
    group: '数据渠道 · 天眼查',
    key: 'channel.tianyancha.dailyMaxCost',
    label: '日成本上限（元）',
    type: 'number',
    decimals: 2,
    min: 0,
    max: 100000,
    default: Number(tyc.dailyMaxCost || 50),
    description: '与「日调用上限」任一触达即停止当日调用',
  },
];

const DEF_MAP = new Map(SETTING_DEFS.map((d) => [d.key, d]));

const CACHE_TTL_MS = 3000;
let cache = { at: 0, map: null };

function invalidate() {
  cache = { at: 0, map: null };
}

function coerce(def, raw) {
  if (def.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const s = String(raw).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(s)) return false;
    throw new Error(`设置项 ${def.key} 需要布尔值`);
  }
  if (def.type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`设置项 ${def.key} 需要数字`);
    const v = def.decimals ? Number(n.toFixed(def.decimals)) : Math.round(n);
    if (def.min !== undefined && v < def.min) throw new Error(`设置项 ${def.key} 不能小于 ${def.min}`);
    if (def.max !== undefined && v > def.max) throw new Error(`设置项 ${def.key} 不能大于 ${def.max}`);
    return v;
  }
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (def.key === 'system.name' && !s) throw new Error('系统名称不能为空');
  if (def.maxLength && s.length > def.maxLength) throw new Error(`设置项 ${def.key} 长度不能超过 ${def.maxLength}`);
  return s;
}

function serialize(value) {
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

function deserialize(def, raw) {
  if (raw === null || raw === undefined || raw === '') return def.default;
  try {
    return coerce(def, raw);
  } catch {
    return def.default;
  }
}

// 读取当前生效值（默认值 + DB 覆盖），带短缓存避免评分高频查询
// 注意：此处的 secret 项返回明文，仅供服务端内部使用；对外接口一律走 listSettings 脱敏
export async function getSettingsMap() {
  if (cache.map && Date.now() - cache.at < CACHE_TTL_MS) return cache.map;
  const rows = await db.all('SELECT * FROM sys_setting');
  const stored = new Map(rows.map((r) => [r.setting_key, r]));
  const map = new Map();
  for (const def of SETTING_DEFS) {
    const row = stored.get(def.key);
    map.set(def.key, {
      value: row ? deserialize(def, row.setting_value) : def.default,
      updatedAt: row?.updated_at || null,
    });
  }
  cache = { at: Date.now(), map };
  return map;
}

export async function getSetting(key, fallback = undefined) {
  const def = DEF_MAP.get(key);
  if (!def) return fallback;
  const map = await getSettingsMap();
  const item = map.get(key);
  return item ? item.value : fallback === undefined ? def.default : fallback;
}

// 设置列表（按分组，供前端渲染）：secret 项脱敏，只回传是否已配置
export async function listSettings() {
  const map = await getSettingsMap();
  return SETTING_DEFS.map((def) => {
    const item = map.get(def.key);
    const raw = item?.value;
    const base = { ...def, updatedAt: item?.updatedAt || null };
    if (def.secret) {
      const hasValue = Boolean(raw && String(raw).trim());
      return { ...base, value: hasValue ? SECRET_MASK : '', hasValue };
    }
    return { ...base, value: raw };
  });
}

export async function listGroupedSettings() {
  const items = await listSettings();
  const groups = [];
  for (const it of items) {
    let g = groups.find((x) => x.group === it.group);
    if (!g) {
      g = { group: it.group, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

async function writeSetting(key, value, def) {
  await db.run(
    `INSERT INTO sys_setting (setting_key, setting_value, description, updated_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), description = VALUES(description), updated_at = VALUES(updated_at)`,
    [key, serialize(value), def.description || null, new Date()],
  );
}

// 批量保存：values = { 'system.name': 'xxx', ... }，未知 key 直接忽略（防越权写入）
// secret 项：留空或传掩码 = 不修改；传 SECRET_CLEAR = 清空
export async function saveSettings(values = {}) {
  const entries = Object.entries(values || {}).filter(([k]) => DEF_MAP.has(k));
  if (!entries.length) return listSettings();

  for (const [key, raw] of entries) {
    const def = DEF_MAP.get(key);

    if (def.secret) {
      const s = raw === null || raw === undefined ? '' : String(raw).trim();
      if (!s || s === SECRET_MASK) continue;
      if (s === SECRET_CLEAR) {
        await writeSetting(key, '', def);
        continue;
      }
      await writeSetting(key, coerce(def, s), def);
      continue;
    }

    await writeSetting(key, coerce(def, raw), def);
  }

  invalidate();
  return listSettings();
}

// 渠道配置（明文）：DB 覆盖优先，未配置时回落到 .env 默认值
export async function getChannelSettings() {
  const map = await getSettingsMap();
  const qccDefaults = channelDefaults.qcc || {};
  const pick = (prefix, k, fallback) => {
    const v = map.get(`${prefix}.${k}`)?.value;
    if (v === undefined || v === null || v === '') return fallback;
    return v;
  };
  return {
    primary: String(pick('channel', 'primary', 'auto')),
    qcc: {
      enabled: pick('channel.qcc', 'enabled', qccDefaults.enabled !== false),
      apiKey: pick('channel.qcc', 'apiKey', qccDefaults.apiKey || ''),
      base: pick('channel.qcc', 'base', qccDefaults.base || 'https://agent.qcc.com/mcp'),
      unitCost: Number(pick('channel.qcc', 'unitCost', qccDefaults.unitCost || 0)),
      dailyMaxCalls: Number(pick('channel.qcc', 'dailyMaxCalls', qccDefaults.dailyMaxCalls || 200)),
      dailyMaxCost: Number(pick('channel.qcc', 'dailyMaxCost', qccDefaults.dailyMaxCost || 0)),
      riskDomains: Boolean(pick('channel.qcc', 'riskDomains', qccDefaults.riskDomains)),
    },
    tianyancha: {
      enabled: pick('channel.tianyancha', 'enabled', tyc.enabled !== false),
      apiKey: pick('channel.tianyancha', 'apiKey', tyc.apiKey || ''),
      base: pick('channel.tianyancha', 'base', tyc.base || 'https://open.api.tianyancha.com'),
      baseinfoPath: pick('channel.tianyancha', 'baseinfoPath', tyc.baseinfoPath || '/services/open/ic/verify/2.0'),
      authScheme: tyc.authScheme ?? '',
      riskApis: pick('channel.tianyancha', 'riskApis', tyc.riskApis !== false),
      unitCost: Number(pick('channel.tianyancha', 'unitCost', tyc.unitCost || 0.15)),
      dailyMaxCalls: Number(pick('channel.tianyancha', 'dailyMaxCalls', tyc.dailyMaxCalls || 200)),
      dailyMaxCost: Number(pick('channel.tianyancha', 'dailyMaxCost', tyc.dailyMaxCost || 50)),
    },
  };
}

// 登录前可读的公开项
export async function getPublicSettings() {
  const map = await getSettingsMap();
  return {
    name: map.get('system.name')?.value || '合作方资信分析系统',
    owner: map.get('system.owner')?.value || '',
    pageSize: map.get('ui.pageSize')?.value || 20,
    version: '0.1.0',
  };
}
