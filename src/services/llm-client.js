import { aiConfig, isAiReady } from '../../config/ai.js';

// 去掉模型可能输出的“思考过程”/代码围栏，只保留正文
function stripThinking(text) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/^[\s\S]*?<\/think>/i, '');
  return s.trim();
}

export function extractJson(text) {
  if (!text) return null;
  let s = stripThinking(text);
  s = s.replace(/^\uFEFF/, '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1];
  const first = Math.min(...['{', '['].map((c) => (s.indexOf(c) < 0 ? Infinity : s.indexOf(c))));
  if (!Number.isFinite(first)) return null;
  const open = s[first];
  const close = open === '{' ? '}' : ']';
  const last = s.lastIndexOf(close);
  if (last <= first) return null;
  const candidate = s.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    // 常见问题：尾随逗号
    try {
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

export async function chat({ system, user, temperature = 0.2, maxTokens }) {
  if (!isAiReady()) throw new Error('AI 未启用或未配置 API Key（USE_LLM / MINIMAX_API_KEY）');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), aiConfig.timeoutMs);
  const started = Date.now();
  try {
    const resp = await fetch(aiConfig.baseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens || aiConfig.maxTokens,
      }),
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`AI 接口 ${resp.status}: ${text.slice(0, 200)}`);
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`AI 返回非 JSON: ${text.slice(0, 200)}`);
    }
    const choice = payload?.choices?.[0];
    let content = choice?.message?.content;
    if (Array.isArray(content)) content = content.map((c) => c?.text || '').join('');
    if (aiConfig.stripThinking) content = stripThinking(content);
    const usage = payload?.usage || null;

    return {
      content: content || '',
      json: extractJson(content),
      model: payload?.model || aiConfig.model,
      usage,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`AI 调用超时（>${aiConfig.timeoutMs}ms）`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
