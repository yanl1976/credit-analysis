import { aiConfig } from '../../config/ai.js';

// 联网检索适配：Tavily / Serper / Bing，配置任一 Key 即启用；未配置时返回 configured=false
export function getSearchStatus() {
  const s = aiConfig.search;
  const configured = Boolean(
    (s.provider === 'tavily' && s.tavilyKey) ||
      (s.provider === 'serper' && s.serperKey) ||
      (s.provider === 'bing' && s.bingKey),
  );
  return {
    configured,
    provider: configured ? s.provider : '',
    note: configured
      ? `联网检索已启用（${s.provider}），AI 分析将先检索网页再归纳`
      : '未配置搜索 Key：AI 仅能依据模型已有知识推断，可能过时；如需“全网搜索”请配置 TAVILY_API_KEY / SERPER_API_KEY / BING_SEARCH_KEY',
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

// 单次检索：失败返回空数组（不阻断 AI 分析），并带 error 便于排查
export async function searchWeb(query) {
  const status = getSearchStatus();
  if (!status.configured) return { configured: false, provider: '', results: [], error: null };
  try {
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

export function formatEvidence(results = []) {
  if (!results.length) return '';
  return results
    .map(
      (r, i) =>
        `[${i + 1}] ${r.title || '(无标题)'}\nURL: ${r.url}\n摘要: ${r.snippet || '(无摘要)'}${r.publishedAt ? `\n时间: ${r.publishedAt}` : ''}`,
    )
    .join('\n\n');
}
