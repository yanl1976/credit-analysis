// 渠道注册器：各 Connector 启动时注册；未配置的由 isConfigured() 自动排除。
const registry = new Map();

export function registerConnector(connector) {
  if (!connector || !connector.key) throw new Error('connector.key 必填');
  registry.set(connector.key, connector);
  return connector;
}

export function getConnector(key) {
  return registry.get(key);
}

export function listConnectors() {
  return [...registry.values()];
}

// 仅返回配置齐全、可实际调用的渠道
export function listEnabledConnectors() {
  return listConnectors().filter((c) => c.isConfigured());
}

// 渠道状态列表（含未配置项，便于前端显示"未配置"）
export function listStatuses() {
  return listConnectors().map((c) => c.status());
}

// 仅测试用：清空注册表
export function clearRegistry() {
  registry.clear();
}
