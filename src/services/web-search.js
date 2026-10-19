import { aiConfig } from '../../config/ai.js';

// 联网检索适配：Tavily / Serper / Bing / MiniMax 内置搜索，配置任一即启用；未配置时返回 configured=false
export function getSearchStatus() {
  const s = aiConfig.search;
  const configured = Boolean(
    (s.provider === 'tavily' && s.tavilyKey) ||
      (s.provider === 'serper' && s.serperKey) ||
      (s.provider === 'bing' && s.bingKey) ||
      (s.provider === 'minimax' && s.minimax?.apiKey),
  );
  return {
    configured,
    provider: configured ? s.provider : '',
    minimaxAvailable: Boolean(s.minimax?.apiKey),
    note: configured
      ? `联网检索已启用（${s.provider}），AI 分析将先检索网页再归纳`
      : '未配置搜索能力：AI 仅能依据模型已有知识推断，可能过时；如需“全网搜索”可配置 TAVILY_API_KEY / SERPER_API_KEY / BING_SEARCH_KEY，或设 SEARCH_PROVIDER=minimax 复用 MiniMax 内置搜索',
  };
}

async function withTimeout(fn, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function tavily(query) {
  const s = aiConfig.search;
  const resp = await withTimeout(
    (signal) =>
      fetch('https://api.tavily.com/search', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: s.tavilyKey,
          query,
          max_results: s.maxResults,
          search_depth: 'basic',
          include_answer: false,
        }),
      }),
    s.timeoutMs,
  );
  if (!resp.ok) throw new Error(`Tavily ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
  const data = await resp.json();
  return (data.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: (r.content || '').slice(0, 500),
    publishedAt: r.published_date || null,
  }));
}

async function serper(query) {
  const s = aiConfig.search;
  const resp = await withTimeout(
    (signal) =>
      fetch('https://google.serper.dev/search', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': s.serperKey },
        body: JSON.stringify({ q: query, num: s.maxResults, gl: 'cn', hl: 'zh-cn' }),
      }),
    s.timeoutMs,
  );
  if (!resp.ok) throw new Error(`Serper ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
  const data = await resp.json();
  return (data.organic || []).slice(0, s.maxResults).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: (r.snippet || '').slice(0, 500),
    publishedAt: r.date || null,
  }));
}

async function bing(query) {
  const s = aiConfig.search;
  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${s.maxResults}&mkt=zh-CN`;
  const resp = await withTimeout(
    (signal) => fetch(url, { signal, headers: { 'Ocp-Apim-Subscription-Key': s.bingKey } }),
    s.timeoutMs,
  );
  if (!resp.ok) throw new Error(`Bing ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
  const data = await resp.json();
  return (data.webPages?.value || []).map((r) => ({
    title: r.name,
    url: r.url,
    snippet: (r.snippet || '').slice(0, 500),
    publishedAt: r.dateLastCrawled || null,
  }));
}

// ---------- MiniMax 内置搜索（Server Tools · web_search，Beta）----------
// 只给 tools 声明 {type:'web_search'}：实测传 force_search / max_keyword / limit 会被静默忽略（不报错但无效）
// 该通道一次请求由服务端自行并发多关键词，故多查询合并为单次调用，避免 N 次模型往返
// 529（集群过载 2064）在高峰时段非常常见，退避需足够长才有机会挤进去
const MINIMAX_RETRY_DELAYS = [3000, 8000, 15000, 20000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupeByUrl(citations) {
  const seen = new Set();
  const out = [];
  for (const c of citations) {
    if (!c?.url || seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

// Responses API：来源在 message.content[].annotations[].url_citation
function parseResponsesPayload(payload) {
  const queries = [];
  const citations = [];
  const texts = [];
  for (const item of payload?.output || []) {
    if (item?.type === 'web_search_call') {
      const q = item.action?.query;
      if (q) queries.push(q);
    } else if (item?.type === 'message') {
      for (const c of item.content || []) {
        if (c?.type === 'output_text' && c.text) texts.push(c.text);
        for (const a of c?.annotations || []) {
          if (a?.type === 'url_citation' && a.url) {
            citations.push({
              title: a.title || a.url,
              url: a.url,
              snippet: String(a.content || '').slice(0, 500),
              publishedAt: null,
            });
          }
        }
      }
    }
  }
  return {
    results: dedupeByUrl(citations),
    answer: String(payload?.output_text || texts.join('\n')).trim(),
    queries,
    status: payload?.status || '',
    incomplete: payload?.incomplete_details || null,
  };
}

// Anthropic Messages API：来源在 web_search_tool_result.content[]，关键词在 server_tool_use.input.query
function parseMessagesPayload(payload) {
  const queries = [];
  const citations = [];
  const texts = [];
  for (const b of payload?.content || []) {
    if (b?.type === 'server_tool_use') {
      const q = b.input?.query;
      if (q) queries.push(q);
    } else if (b?.type === 'web_search_tool_result') {
      // 检索失败时 content 可能是 {type:'web_search_tool_result_error'} 而非数组
      for (const r of Array.isArray(b.content) ? b.content : []) {
        if (r?.type === 'web_search_result' && r.url) {
          citations.push({
            title: r.title || r.url,
            url: r.url,
            snippet: String(r.content || '').slice(0, 500),
            publishedAt: r.page_age || null,
          });
        }
      }
    } else if (b?.type === 'text' && b.text) {
      texts.push(b.text);
    }
  }
  return {
    results: dedupeByUrl(citations),
    answer: texts.join('\n').trim(),
    queries,
    status: payload?.stop_reason || '',
    incomplete: payload?.stop_reason === 'pause_turn' ? { reason: 'pause_turn' } : null,
  };
}

async function minimaxFetch(query, channel) {
  const m = aiConfig.search.minimax;
  const prompt = `请联网检索下列信息，只依据检索结果作答，不要编造；若检索不到请明确说明：\n${query}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), m.timeoutMs);
  try {
    let url;
    let headers;
    let body;
    if (channel === 'messages') {
      url = m.messagesUrl;
      headers = { 'Content-Type': 'application/json', 'x-api-key': m.apiKey, 'anthropic-version': m.anthropicVersion };
      body = {
        model: m.model,
        max_tokens: m.maxOutputTokens,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      };
    } else {
      url = m.url;
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${m.apiKey}` };
      body = { model: m.model, input: prompt, tools: [{ type: 'web_search' }], max_output_tokens: m.maxOutputTokens };
    }
    const resp = await fetch(url, { method: 'POST', signal: controller.signal, headers, body: JSON.stringify(body) });
    const text = await resp.text();
    if (!resp.ok) {
      const err = new Error(`MiniMax 搜索(${channel}) ${resp.status}: ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
      // 429 / 5xx（含 529 集群负载 2064）才重试；4xx 参数错误重试无意义
      err.retryable = resp.status === 429 || resp.status >= 500;
      throw err;
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`MiniMax 搜索(${channel}) 返回非 JSON: ${text.slice(0, 200)}`);
    }
    const parsed = channel === 'messages' ? parseMessagesPayload(payload) : parseResponsesPayload(payload);
    return { ...parsed, channel };
  } finally {
    clearTimeout(timer);
  }
}

async function minimaxSearch(query) {
  const m = aiConfig.search.minimax;
  const channels = m.channels?.length ? m.channels : ['responses'];
  // retries 语义为「重试次数」，总尝试次数 = retries + 1；两条通道交替，避开单条通道的过载窗口
  const attempts = Math.max(1, Number(m.retries || 0) + 1);
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    const channel = channels[i % channels.length];
    try {
      return await minimaxFetch(query, channel);
    } catch (e) {
      lastErr = e;
      const retryable = e.name === 'AbortError' ? false : e.retryable !== false;
      if (!retryable || i === attempts - 1) break;
      await sleep(MINIMAX_RETRY_DELAYS[Math.min(i, MINIMAX_RETRY_DELAYS.length - 1)]);
    }
  }
  if (lastErr?.name === 'AbortError') throw new Error(`MiniMax 搜索超时（>${m.timeoutMs}ms）`);
  if (lastErr && /2064|已经?载较高|overloaded/i.test(lastErr.message)) {
    throw new Error(`MiniMax 搜索集群过载（529），已重试 ${attempts - 1} 次仍失败`);
  }
  throw lastErr || new Error('MiniMax 搜索失败');
}

// ---- 结果缓存 + 限流冷却 ----
// 实测：MiniMax 内置搜索有未公开的账号级配额，短时间高频调用会持续 529（此时普通对话接口仍 200）
// 故：同一 query 命中缓存直接复用；连续失败进入冷却期，避免每个请求都白等一轮重试
const minimaxCache = new Map();
let minimaxCooldownUntil = 0;
let minimaxFailStreak = 0;

function cacheTtlMs() {
  return Number(process.env.SEARCH_CACHE_TTL_MS || 600000);
}

function cooldownMs() {
  return Number(process.env.SEARCH_COOLDOWN_MS || 180000);
}

function cacheGet(key) {
  const hit = minimaxCache.get(key);
  if (!hit) return null;
  if (hit.expire < Date.now()) {
    minimaxCache.delete(key);
    return null;
  }
  return hit.payload;
}

function cacheSet(key, payload) {
  if (minimaxCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of minimaxCache) if (v.expire < now) minimaxCache.delete(k);
    if (minimaxCache.size > 200) minimaxCache.delete(minimaxCache.keys().next().value);
  }
  minimaxCache.set(key, { expire: Date.now() + cacheTtlMs(), payload });
}

export function resetMinimaxSearchState() {
  minimaxCache.clear();
  minimaxCooldownUntil = 0;
  minimaxFailStreak = 0;
}

async function minimaxSearchCached(query) {
  const cached = cacheGet(query);
  if (cached) return { ...cached, cached: true };

  if (Date.now() < minimaxCooldownUntil) {
    const left = Math.ceil((minimaxCooldownUntil - Date.now()) / 1000);
    return { configured: true, provider: 'minimax', results: [], error: `MiniMax 搜索处于限流冷却期，${left}s 后自动恢复`, cooldown: true };
  }

  try {
    const r = await minimaxSearch(query);
    minimaxFailStreak = 0;
    minimaxCooldownUntil = 0;
    const payload = {
      configured: true,
      provider: 'minimax',
      results: r.results.slice(0, aiConfig.search.maxResults),
      error: null,
      answer: r.answer,
      queries: r.queries,
      channel: r.channel,
    };
    cacheSet(query, payload);
    return payload;
  } catch (e) {
    if (/529|过载|overloaded/i.test(e.message)) {
      minimaxFailStreak += 1;
      if (minimaxFailStreak >= 2) minimaxCooldownUntil = Date.now() + cooldownMs();
    }
    return { configured: true, provider: 'minimax', results: [], error: e.message };
  }
}

// 单次检索：失败返回空数组（不阻断 AI 分析），并带 error 便于排查
export async function searchWeb(query) {
  const status = getSearchStatus();
  if (!status.configured) return { configured: false, provider: '', results: [], error: null };
  try {
    if (status.provider === 'minimax') return await minimaxSearchCached(query);
    const fn = status.provider === 'tavily' ? tavily : status.provider === 'serper' ? serper : bing;
    const results = await fn(query);
    return { configured: true, provider: status.provider, results, error: null };
  } catch (e) {
    return { configured: true, provider: status.provider, results: [], error: e.message };
  }
}

// 批量检索并去重（按 url），限制总条数
export async function searchMany(queries = [], limit = 12) {
  const status = getSearchStatus();
  if (!status.configured) return { configured: false, provider: '', results: [], errors: [] };

  // MiniMax：服务端一次请求内自行并发多关键词，合并成单次调用（省时且省额度）
  if (status.provider === 'minimax' && queries.length > 0) {
    const r = await searchWeb(queries.join('\n'));
    return {
      configured: true,
      provider: 'minimax',
      results: r.results.slice(0, limit).map((item) => ({ ...item, query: queries[0] })),
      errors: r.error ? [{ query: queries.join(' / '), error: r.error }] : [],
      answer: r.answer || '',
      queries: r.queries || [],
      channel: r.channel || '',
      cached: Boolean(r.cached),
      cooldown: Boolean(r.cooldown),
    };
  }

  const seen = new Set();
  const results = [];
  const errors = [];
  for (const q of queries) {
    const r = await searchWeb(q);
    if (r.error) errors.push({ query: q, error: r.error });
    for (const item of r.results) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      results.push({ ...item, query: q });
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }
  return { configured: true, provider: status.provider, results, errors };
}

// summary 仅 MiniMax 内置搜索提供（服务端模型对检索结果的归纳），标注为二手线索，避免与原始来源混同
export function formatEvidence(results = [], summary = '') {
  const parts = [];
  if (results.length) {
    parts.push(
      results
        .map(
          (r, i) =>
            `[${i + 1}] ${r.title || '(无标题)'}\nURL: ${r.url}\n摘要: ${r.snippet || '(无摘要)'}${r.publishedAt ? `\n时间: ${r.publishedAt}` : ''}`,
        )
        .join('\n\n'),
    );
  }
  if (summary) {
    parts.push(
      `【检索摘要（服务端模型对来源的归纳，属二手线索；与上方原始来源冲突时以上方为准，仍不确定的字段必须填 null）】\n${String(summary).slice(0, 1200)}`,
    );
  }
  return parts.join('\n\n');
}
