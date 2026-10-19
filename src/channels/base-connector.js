// 渠道 Connector 抽象基类：统一 search / fetchDetail / normalize 能力与配置自检。
// 子类按渠道实现具体接口；未配置（无 Key/开关关闭）时由 registry 自动跳过。
export class BaseConnector {
  constructor({
    key,
    name,
    enabled = false,
    apiKey = '',
    base = '',
    requiresAuth = true,
    capabilities = [],
  }) {
    this.key = key;
    this.name = name;
    this.enabled = Boolean(enabled);
    this.apiKey = apiKey;
    this.base = base;
    this.requiresAuth = Boolean(requiresAuth);
    this.capabilities = capabilities;
  }

  // 是否可用：开关开启，且需要鉴权的渠道已配置 Key
  isConfigured() {
    return this.enabled && (!this.requiresAuth || Boolean(this.apiKey));
  }

  // 渠道状态（不含 Key，供前端/运维查看）
  status() {
    return {
      key: this.key,
      name: this.name,
      enabled: this.enabled,
      configured: this.isConfigured(),
      requiresAuth: this.requiresAuth,
      capabilities: this.capabilities,
      base: this.base,
    };
  }

  async search(keyword) {
    throw new Error(`${this.key}: search 未实现`);
  }

  async fetchDetail(creditCode) {
    throw new Error(`${this.key}: fetchDetail 未实现`);
  }

  normalize(raw) {
    return raw;
  }
}
