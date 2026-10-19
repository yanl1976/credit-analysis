import { BaseConnector } from './base-connector.js';

// 信用中国（公开渠道，无需 Key；抓取实现待第四章接入）
export class CreditChinaConnector extends BaseConnector {
  constructor(cfg = {}) {
    super({ ...cfg, requiresAuth: false, capabilities: ['credit'] });
  }

  async search(keyword) {
    return { ok: false, reason: '信用中国 Connector 待实现（公开渠道抓取）', keyword };
  }

  async fetchDetail(creditCode) {
    return { ok: false, reason: '信用中国 Connector 待实现（公开渠道抓取）', creditCode };
  }
}
