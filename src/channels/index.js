import { channels as channelConfig } from '../../config/channels.js';
import { registerConnector } from './registry.js';
import { QccConnector } from './qcc-connector.js';
import { TianyanchaConnector } from './tianyancha-connector.js';
import { CreditChinaConnector } from './credit-china-connector.js';
import { ZhixingConnector } from './zhixing-connector.js';

let initialized = false;

// 初始化并注册全部渠道 Connector（幂等）
export function initChannels() {
  if (initialized) return;
  registerConnector(new QccConnector(channelConfig.qcc));
  registerConnector(new TianyanchaConnector(channelConfig.tianyancha));
  registerConnector(new CreditChinaConnector(channelConfig.creditChina));
  registerConnector(new ZhixingConnector(channelConfig.zhixing));
  initialized = true;
}
