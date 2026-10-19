import 'dotenv/config';

// 渠道配置（配置驱动）
// - 天眼查：有 TIAN_YAN_CHA_API_KEY 走开放平台 API；无 Key 时自动降级为「公开检索兜底」
// - 企查查：需 Key，未配置自动跳过
// - 公开渠道（信用中国/执行信息）：默认启用、无需 Key
export const channels = {
  qcc: {
    key: 'qcc',
    name: '企查查',
    enabled: Boolean(process.env.QCC_API_KEY),
    apiKey: process.env.QCC_API_KEY || '',
    base: process.env.QCC_API_BASE || 'https://api.qcc.com',
  },
  tianyancha: {
    key: 'tianyancha',
    name: '天眼查',
    // 是否允许该渠道参与采集；实际可用性由 Connector 的 mode 决定（api / search / off）
    enabled: String(process.env.TIAN_YAN_CHA_ENABLED || 'true').toLowerCase() !== 'false',
    apiKey: process.env.TIAN_YAN_CHA_API_KEY || '',
    // 真实网关域名：api.tianyancha.com 并不存在（公共 DNS 均 NXDOMAIN），正确为 open.api.tianyancha.com
    base: process.env.TIAN_YAN_CHA_API_BASE || 'https://open.api.tianyancha.com',
    // 接口路径：不同账号开通的接口不同，故可配；以开放平台控制台「已开通接口」为准。
    // 默认走 ID 1074「企业三要素验证」/services/open/ic/verify/2.0：
    //   仅核验 企业名称 + 统一社会信用代码 + 法定代表人 三者是否一致；
    //   不返回注册资本/成立日期/经营范围等工商画像字段。
    // 若账号已开通「企业基本信息」，可改为 /services/v4/open/ic/baseinfo/2.0 或
    //   /services/v4/open/ic/baseinfoV2/2.0（以控制台文档路径为准）。
    baseinfoPath: process.env.TIAN_YAN_CHA_BASEINFO_PATH || '/services/open/ic/verify/2.0',
    // 官方示例为 get.setHeader("Authorization", token)：裸 token，不带 Bearer 前缀。
    // 带 Bearer 会返回 error_code 300009「账号信息有误」，可用环境变量覆盖回退。
    authScheme: process.env.TIAN_YAN_CHA_AUTH_SCHEME ?? '',
    // 是否叠加采集经营风险类接口（严重违法/经营异常/清算/欠税/税收违法/行政处罚/税务非正常户）
    // 每个客户会多消耗 7 次按次计费调用；只想做主体核验时置 false
    riskApis: String(process.env.TIAN_YAN_CHA_RISK_APIS || 'true').toLowerCase() !== 'false',
    unitCost: Number(process.env.TIAN_YAN_CHA_UNIT_COST || 0.15),
    timeoutMs: Number(process.env.TIAN_YAN_CHA_TIMEOUT_MS || 15000),
    cacheTtlMs: Number(process.env.CHANNEL_CACHE_TTL_MS || 86400000),
    dailyMaxCalls: Number(process.env.CHANNEL_DAILY_MAX_CALLS || 200),
    dailyMaxCost: Number(process.env.CHANNEL_DAILY_MAX_COST || 50),
  },
  creditChina: {
    key: 'creditChina',
    name: '信用中国',
    enabled: true,
    apiKey: '',
    base: 'https://www.creditchina.gov.cn',
  },
  zhixing: {
    key: 'zhixing',
    name: '执行信息公开网',
    enabled: true,
    apiKey: '',
    base: 'http://zxgk.court.gov.cn',
  },
};

// 返回当前已启用（配置了 Key / 默认公开）的渠道列表
export function getEnabledChannels() {
  return Object.values(channels).filter((c) => c.enabled);
}

// 返回首选主力 API（企查查优先，其次天眼查），无则 null
export function getPrimaryApi() {
  if (channels.qcc.enabled) return channels.qcc;
  if (channels.tianyancha.enabled) return channels.tianyancha;
  return null;
}
