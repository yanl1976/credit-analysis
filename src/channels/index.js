import { channels as channelConfig } from '../../config/channels.js';
import { registerConnector } from './registry.js';
import { QccConnector } from './qcc-connector.js';
import { TianyanchaConnector } from './tianyancha-connector.js';

let initialized = false;

// 初始化并注册全部渠道 Connector（幂等）
export function initChannels() {
  if (initialized) return;
  registerConnector(new QccConnector(channelConfig.qcc));
  registerConnector(new TianyanchaConnector(channelConfig.tianyancha));
  initialized = true;
}
