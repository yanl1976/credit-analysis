import db from '../db.js';

// 系统设置：白名单驱动，新增开关只需在此登记（含默认值/类型/范围），前端自动渲染
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
    key: 'warning.recordGradeChange',
    label: '等级变化写入预警',
    type: 'boolean',
    default: true,
    description: '关闭后重算仍更新评分，但不再产生等级变化预警事件',
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
    const v = Math.round(n);
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

// 设置列表（按分组，供前端渲染）
export async function listSettings() {
  const map = await getSettingsMap();
  return SETTING_DEFS.map((def) => ({
    ...def,
    value: map.get(def.key)?.value,
    updatedAt: map.get(def.key)?.updatedAt || null,
  }));
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

// 批量保存：values = { 'system.name': 'xxx', ... }，未知 key 直接忽略（防越权写入）
export async function saveSettings(values = {}) {
  const entries = Object.entries(values || {}).filter(([k]) => DEF_MAP.has(k));
  if (!entries.length) return listSettings();
  const now = new Date();
  for (const [key, raw] of entries) {
    const def = DEF_MAP.get(key);
    const value = coerce(def, raw);
    await db.run(
      `INSERT INTO sys_setting (setting_key, setting_value, description, updated_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), description = VALUES(description), updated_at = VALUES(updated_at)`,
      [key, serialize(value), def.description || null, now],
    );
  }
  invalidate();
  return listSettings();
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
