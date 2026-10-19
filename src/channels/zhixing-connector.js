import { BaseConnector } from './base-connector.js';

// 中国执行信息公开网（公开渠道，无需 Key；抓取实现待第四章接入）
export class ZhixingConnector extends BaseConnector {
  constructor(cfg = {}) {
    super({ ...cfg, requiresAuth: false, capabilities: ['judicial'] });
  }

  async search(keyword) {
    return { ok: false, reason: '执行信息公开网 Connector 待实现（公开渠道抓取）', keyword };
  }

  async fetchDetail(creditCode) {
    return { ok: false, reason: '执行信息公开网 Connector 待实现（公开渠道抓取）', creditCode };
  }
}
