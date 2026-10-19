import { channels as channelConfig } from '../../config/channels.js';
import { registerConnector, clearRegistry } from './registry.js';
import { QccConnector } from './qcc-connector.js';
import { TianyanchaConnector } from './tianyancha-connector.js';
import { getChannelSettings } from '../services/setting-service.js';

let initialized = false;

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
  // 只保留两个商业数据源；公开渠道（信用中国/执行信息公开网）已剔除，
  // 司法与经营风险数据统一由天眼查开放平台提供（见 config/channels.js 注释）
  registerConnector(new QccConnector(channelConfig.qcc));
  registerConnector(new TianyanchaConnector(mergeTianyancha(channelConfig.tianyancha, saved)));
  initialized = true;
}

// 系统设置里改了渠道参数后调用：重建 Connector 实例，使新 Key/地址立即生效
export async function reloadChannels() {
  clearRegistry();
  initialized = false;
  await initChannels();
}
