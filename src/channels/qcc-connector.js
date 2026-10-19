import { BaseConnector } from './base-connector.js';

// 企查查 Connector（配置驱动：QCC_API_KEY 未配置时 enabled=false，自动跳过）
export class QccConnector extends BaseConnector {
  constructor(cfg = {}) {
    super({
      ...cfg,
      requiresAuth: true,
      capabilities: ['basic', 'judicial', 'credit', 'finance'],
    });
  }

  async search(keyword) {
    if (!this.isConfigured()) return { ok: false, reason: '未配置企查查 API Key' };
    // TODO: 待账号开通后接入企查查搜索接口并做字段映射
    return { ok: false, reason: '企查查 Connector 已启用但接口尚未接入（待账号）', keyword };
  }

  async fetchDetail(creditCode) {
    if (!this.isConfigured()) return { ok: false, reason: '未配置企查查 API Key' };
    // TODO: 待账号开通后接入企查查详情接口并做字段映射
    return { ok: false, reason: '企查查 Connector 已启用但接口尚未接入（待账号）', creditCode };
  }
}
