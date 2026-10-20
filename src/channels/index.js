import { channels as channelConfig } from '../../config/channels.js';
import { registerConnector, clearRegistry } from './registry.js';
import { QccConnector } from './qcc-connector.js';
import { TianyanchaConnector } from './tianyancha-connector.js';
import { getChannelSettings } from '../services/setting-service.js';

let initialized = false;
let channelPrimary = 'auto';

function positiveNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// 系统设置（DB）优先，.env 兜底：让运营在页面上改完即生效，无需重启
function mergeTianyancha(base = {}, saved = {}) {
  return {
    ...base,
    enabled: saved.enabled === undefined || saved.enabled === null ? base.enabled !== false : Boolean(saved.enabled),
    apiKey: String(saved.apiKey || base.apiKey || ''),
    base: String(saved.base || base.base || 'https://open.api.tianyancha.com'),
    baseinfoPath: String(saved.baseinfoPath || base.baseinfoPath || '/services/open/ic/verify/2.0'),
    // 官方示例为裸 token（Authorization: <token>）；带 Bearer 会被判 300009 账号信息有误
    authScheme: saved.authScheme ?? base.authScheme ?? '',
    // 经营风险类接口总开关（每个客户多 7 次按次计费调用）
    riskApis: saved.riskApis === undefined || saved.riskApis === null ? base.riskApis !== false : Boolean(saved.riskApis),
    unitCost: positiveNumber(saved.unitCost, positiveNumber(base.unitCost, 0.15)),
    dailyMaxCalls: positiveNumber(saved.dailyMaxCalls, positiveNumber(base.dailyMaxCalls, 200)),
    dailyMaxCost: positiveNumber(saved.dailyMaxCost, positiveNumber(base.dailyMaxCost, 50)),
  };
}

// 企查查（MCP）配置合并：DB 覆盖优先，未配置时回落 .env
function mergeQcc(base = {}, saved = {}) {
  return {
    ...base,
    enabled: saved.enabled === undefined || saved.enabled === null ? base.enabled !== false : Boolean(saved.enabled),
    apiKey: String(saved.apiKey || base.apiKey || ''),
    base: String(saved.base || base.base || 'https://agent.qcc.com/mcp'),
    unitCost: positiveNumber(saved.unitCost, positiveNumber(base.unitCost, 0)),
    dailyMaxCalls: positiveNumber(saved.dailyMaxCalls, positiveNumber(base.dailyMaxCalls, 200)),
    dailyMaxCost: positiveNumber(saved.dailyMaxCost, positiveNumber(base.dailyMaxCost, 0)),
    riskDomains: saved.riskDomains === undefined || saved.riskDomains === null ? base.riskDomains !== false : Boolean(saved.riskDomains),
  };
}

// 采集路由读取：决定渠道优先级（auto / qcc / tianyancha）
export function getChannelPrimary() {
  return channelPrimary;
}

// 初始化并注册全部渠道 Connector（幂等）
export async function initChannels() {
  if (initialized) return;
  let saved = {};
  try {
    saved = await getChannelSettings();
  } catch {
    // 表未就绪或读取失败时退回 .env 配置，不阻断启动
    saved = {};
  }
  const qccSaved = saved.qcc || {};
  const tycSaved = saved.tianyancha || {};
  channelPrimary = saved.primary || 'auto';
  registerConnector(new QccConnector(mergeQcc(channelConfig.qcc, qccSaved)));
  registerConnector(new TianyanchaConnector(mergeTianyancha(channelConfig.tianyancha, tycSaved)));
  initialized = true;
}

// 系统设置里改了渠道参数后调用：重建 Connector 实例，使新 Key/地址立即生效
export async function reloadChannels() {
  clearRegistry();
  initialized = false;
  await initChannels();
}
