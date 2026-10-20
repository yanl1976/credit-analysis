import 'dotenv/config';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { channels } from '../../config/channels.js';

// 天眼AI（天眼查官方 MCP 服务）客户端
// 协议：Streamable HTTP + JSON-RPC 2.0（响应可能是 application/json，也可能是 text/event-stream）
// 鉴权：Authorization: Bearer <token>（token 形如 tyc_*** 或注册页复制的配置里的值）
// 会话：initialize 响应头返回 Mcp-Session-Id，后续请求必须回传
//
// 注意：这是「能力型」通道，工具清单由服务端 tools/list 动态返回（官方称 162 个），
// 因此不在此硬编码工具名；调用前先 tools/list 再按需 tools/call，工具清单可缓存到 data/ 供映射表使用。

const DEFAULT_ENDPOINT = 'https://mcp.tianyancha.com/v1';
const PROTOCOL_VERSION = '2025-06-18';

export class TycMcpError extends Error {
  constructor(message, { status = null, code = null, hint = '' } = {}) {
    super(message);
    this.name = 'TycMcpError';
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

function parseSse(text, id) {
  const events = text.split(/\r?\n\r?\n/);
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

export class TycMcpClient {
  constructor({
    endpoint = process.env.TIANYANCHA_MCP_URL || DEFAULT_ENDPOINT,
    token = process.env.TIANYANCHA_MCP_TOKEN || '',
    timeoutMs = Number(process.env.TIANYANCHA_MCP_TIMEOUT_MS || 30000),
    protocolVersion = PROTOCOL_VERSION,
  } = {}) {
    this.endpoint = String(endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '');
    // 兼容用户误填「Bearer xxx」：统一剥离前缀，最终按 Authorization: Bearer <纯token> 发送
    this.token = String(token || '').trim().replace(/^Bearer\s+/i, '');
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
      throw new TycMcpError(`天眼AI 连接失败：${e.cause?.code || e.message}`, {
        hint: '请检查网络/代理，或 TIANYANCHA_MCP_URL 是否正确',
      });
    }

    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (res.status === 401) {
      const body = await res.text().catch(() => '');
      throw new TycMcpError('天眼AI 鉴权失败（401）：缺少或无效的 Authorization', {
        status: 401,
        hint:
          '需要 Bearer token：到 https://ai.tianyancha.com 免费注册，复制 MCP 配置里的 Authorization 值，' +
          `写入 .env 的 TIANYANCHA_MCP_TOKEN。服务端返回：${body.slice(0, 200)}`,
      });
    }
    if (res.status === 404 && /invalid session/i.test(await res.clone().text().catch(() => ''))) {
      this.sessionId = null;
      throw new TycMcpError('天眼AI 会话失效，请重新 connect()', { status: 404 });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new TycMcpError(`天眼AI 请求失败 HTTP ${res.status}：${body.slice(0, 200)}`, { status: res.status });
    }
    if (res.status === 202 || payload.id === undefined) return null;

    const ct = String(res.headers.get('content-type') || '');
    const text = await res.text();
    if (ct.includes('text/event-stream')) {
      const obj = parseSse(text, payload.id);
      if (!obj) throw new TycMcpError('天眼AI 返回的 SSE 中未找到对应响应', { hint: text.slice(0, 200) });
      return obj;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new TycMcpError('天眼AI 返回内容不是合法 JSON', { hint: text.slice(0, 200) });
    }
  }

  async _rpc(method, params = {}) {
    this._id += 1;
    const resp = await this._post({ jsonrpc: '2.0', id: this._id, method, params });
    if (resp?.error) {
      throw new TycMcpError(`天眼AI 错误 ${resp.error.code}：${resp.error.message}`, { code: resp.error.code });
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
    // 协议要求：initialize 之后必须发送 initialized 通知
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
      throw new TycMcpError(`工具 ${name} 执行失败：${msg.slice(0, 300)}`);
    }
    return r?.structuredContent ?? r?.content ?? null;
  }
}

export function createTycMcpClient(overrides = {}) {
  const cfg = channels.tianyanchaMcp || {};
  return new TycMcpClient({
    endpoint: overrides.endpoint || cfg.endpoint,
    token: overrides.token || cfg.token,
    timeoutMs: overrides.timeoutMs || cfg.timeoutMs,
  });
}

// 直接运行本文件即自检：node src/channels/tyc-mcp-client.js [--dump]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = createTycMcpClient();
  if (!client.configured) {
    console.log('未配置 TIANYANCHA_MCP_TOKEN，无法连接天眼AI。');
    console.log('获取方式：https://ai.tianyancha.com 免费注册 → 复制 MCP 配置中的 Authorization → 写入 .env');
    process.exit(1);
  }
  try {
    console.log('连接', client.endpoint);
    const info = await client.connect();
    console.log('服务端：', JSON.stringify(info));
    const tools = await client.listTools();
    console.log('可用工具数：', tools.length);
    if (process.argv.includes('--dump')) {
      fs.mkdirSync('data', { recursive: true });
      fs.writeFileSync('data/tyc-mcp-tools.json', JSON.stringify(tools, null, 2), 'utf8');
      console.log('工具清单已写入 data/tyc-mcp-tools.json');
    }
    for (const t of tools) {
      console.log(`- ${t.name} | ${String(t.description || '').slice(0, 90)}`);
    }
  } catch (e) {
    console.error(`\n[失败] ${e.message}`);
    if (e.hint) console.error(`[提示] ${e.hint}`);
    process.exit(2);
  }
  process.exit(0);
}
