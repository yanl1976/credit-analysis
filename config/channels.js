import 'dotenv/config';

// 渠道配置（配置驱动）：暂无账号的渠道 enabled=false，Connector 会自动跳过。
// 主力 API 二选一（企查查 / 天眼查）；公开渠道默认启用、无需 Key。
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
    enabled: Boolean(process.env.TIAN_YAN_CHA_API_KEY),
    apiKey: process.env.TIAN_YAN_CHA_API_KEY || '',
    base: process.env.TIAN_YAN_CHA_API_BASE || 'https://open.tianyancha.com',
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
