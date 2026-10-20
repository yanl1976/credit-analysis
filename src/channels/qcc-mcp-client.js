import 'dotenv/config';

// 企查查官方 MCP 客户端（Streamable HTTP + JSON-RPC 2.0）
// 与天眼AI MCP 同协议，区别在于：企查查按业务域拆分 endpoint，
// 形如 https://agent.qcc.com/mcp/<domain>/stream，各业务域共用同一 Bearer Token。
// 业务域 domain 见 QCC_DOMAINS（company/risk/ipr/legal-case ...）。
//
// 安全：Token 仅来自配置（环境变量 QCC_API_KEY 或系统设置 channel.qcc.apiKey），
// 绝不硬编码；接口侧已对 secret 项脱敏。

const PROTOCOL_VERSION = '2025-06-18';

export class QccMcpError extends Error {
  constructor(message, { status = null, code = null, hint = '' } = {}) {
    super(message);
    this.name = 'QccMcpError';
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

// SSE 文本解析：返回与请求 id 匹配的 JSON-RPC 对象（兼容服务器自发心跳/注释帧）
function parseSse(text, id) {
  const events = String(text).split(/\r?\n\r?\n/);
  for (const ev of events) {
    const dataLines = ev
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    if (!dataLines.length) continue;
    const raw = dataLines.join('\n');
    try {
      const obj = JSON.parse(raw);
      if (id === undefined || obj.id === id) return obj;
    } catch {
      // 忽略无法解析的心跳/注释帧
    }
  }
  return null;
}

export class QccMcpClient {
  constructor({
    base = process.env.QCC_MCP_BASE || 'https://agent.qcc.com/mcp',
    token = process.env.QCC_API_KEY || '',
    domain = 'company',
    timeoutMs = Number(process.env.QCC_MCP_TIMEOUT_MS || 30000),
    protocolVersion = PROTOCOL_VERSION,
  } = {}) {
    this.base = String(base || 'https://agent.qcc.com/mcp').replace(/\/+$/, '');
    // 兼容用户误填「Bearer xxx」：统一剥离前缀，最终按 Authorization: Bearer <纯token> 发送
    this.token = String(token || '').trim().replace(/^Bearer\s+/i, '');
    this.domain = String(domain || 'company').trim();
    this.endpoint = `${this.base}/${this.domain}/stream`;
    this.timeoutMs = timeoutMs;
    this.protocolVersion = protocolVersion;
    this.sessionId = null;
    this.serverInfo = null;
    this._id = 0;
  }

  get configured() {
    return Boolean(this.token);
  }

  async _post(payload) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': 'credit-analysis/0.1 (+node)',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
      headers['MCP-Protocol-Version'] = this.protocolVersion;
    }

    let res;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new QccMcpError(`企查查 MCP 连接失败：${e.cause?.code || e.message}`, {
        hint: '请检查网络/代理，或 QCC_MCP_BASE 是否正确',
      });
    }

    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (res.status === 401) {
      const body = await res.text().catch(() => '');
      throw new QccMcpError('企查查 MCP 鉴权失败（401）：缺少或无效的 Authorization', {
        status: 401,
        hint: '需要在系统设置 → 数据渠道 · 企查查 填入有效的 MCP Token',
      });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new QccMcpError(`企查查 MCP 请求失败 HTTP ${res.status}：${body.slice(0, 200)}`, { status: res.status });
    }
    if (res.status === 202 || payload.id === undefined) return null;

    const ct = String(res.headers.get('content-type') || '');
    const text = await res.text();
    if (ct.includes('text/event-stream')) {
      const obj = parseSse(text, payload.id);
      if (!obj) throw new QccMcpError('企查查 MCP 返回的 SSE 中未找到对应响应', { hint: text.slice(0, 200) });
      return obj;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new QccMcpError('企查查 MCP 返回内容不是合法 JSON', { hint: text.slice(0, 200) });
    }
  }

  async _rpc(method, params = {}) {
    this._id += 1;
    const resp = await this._post({ jsonrpc: '2.0', id: this._id, method, params });
    if (resp?.error) {
      throw new QccMcpError(`企查查 MCP 错误 ${resp.error.code}：${resp.error.message}`, { code: resp.error.code });
    }
    return resp?.result ?? null;
  }

  async connect() {
    const result = await this._rpc('initialize', {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: 'credit-analysis', version: '0.1.0' },
    });
    this.serverInfo = result?.serverInfo || null;
    await this._post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return { serverInfo: this.serverInfo, protocolVersion: result?.protocolVersion || null };
  }

  async listTools() {
    const tools = [];
    let cursor;
    do {
      const r = await this._rpc('tools/list', cursor ? { cursor } : {});
      tools.push(...(r?.tools || []));
      cursor = r?.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name, args = {}) {
    const r = await this._rpc('tools/call', { name, arguments: args });
    if (r?.isError) {
      const msg = (r.content || []).map((c) => c.text).filter(Boolean).join('\n');
      throw new QccMcpError(`工具 ${name} 执行失败：${msg.slice(0, 300)}`);
    }
    return r?.structuredContent ?? r?.content ?? null;
  }
}

// 企查查 MCP 业务域清单（endpoint 路径，与用户提供的 mcpServers 一一对应）
export const QCC_DOMAINS = [
  'company',
  'risk',
  'ipr',
  'operation',
  'history',
  'executive',
  'regulation',
  'case',
  'tender',
  'document',
];

// 业务域 → 本系统数据维度（用于 capabilities 展示）
export const QCC_DOMAIN_DIMENSION = {
  company: 'basic',
  risk: 'credit',
  ipr: 'ipr',
  operation: 'basic',
  history: 'basic',
  executive: 'basic',
  regulation: 'credit',
  case: 'judicial',
  tender: 'tender',
  document: 'basic',
};

export function createQccMcpClient(domain, overrides = {}) {
  return new QccMcpClient({ domain, ...overrides });
}
