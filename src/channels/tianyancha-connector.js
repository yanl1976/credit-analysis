import { BaseConnector } from './base-connector.js';

// 天眼查 Connector（配置驱动：TIAN_YAN_CHA_API_KEY 未配置时 enabled=false，自动跳过）
export class TianyanchaConnector extends BaseConnector {
  constructor(cfg = {}) {
    super({
      ...cfg,
      requiresAuth: true,
      capabilities: ['basic', 'judicial', 'credit', 'finance'],
    });
  }

  async search(keyword) {
    if (!this.isConfigured()) return { ok: false, reason: '未配置天眼查 API Key' };
    // TODO: 待账号开通后接入天眼查搜索接口并做字段映射
    return { ok: false, reason: '天眼查 Connector 已启用但接口尚未接入（待账号）', keyword };
  }

  async fetchDetail(creditCode) {
    if (!this.isConfigured()) return { ok: false, reason: '未配置天眼查 API Key' };
    // TODO: 待账号开通后接入天眼查详情接口并做字段映射
    return { ok: false, reason: '天眼查 Connector 已启用但接口尚未接入（待账号）', creditCode };
  }
}
