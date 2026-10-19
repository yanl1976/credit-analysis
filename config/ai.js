import 'dotenv/config';

// AI 配置（OpenAI 兼容 chat/completions）：默认走 MiniMax，可用通用变量覆盖
export const aiConfig = {
  enabled: String(process.env.USE_LLM || 'false').toLowerCase() === 'true',
  apiKey: process.env.LLM_API_KEY || process.env.MINIMAX_API_KEY || '',
  baseUrl:
    process.env.LLM_API_URL ||
    process.env.MINIMAX_API_URL ||
    'https://api.minimax.chat/v1/chat/completions',
  model: process.env.LLM_MODEL || process.env.MINIMAX_MODEL || 'MiniMax-M2.5-highspeed',
  stripThinking: String(process.env.MINIMAX_STRIP_THINKING || 'true').toLowerCase() === 'true',
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 90000),
  maxTokens: Number(process.env.LLM_MAX_TOKENS || 2400),

  // 联网检索（可选）：配置任一搜索 Key 后，AI 分析前会先检索网页并把摘要作为证据
  search: {
    provider:
      process.env.SEARCH_PROVIDER ||
      (process.env.TAVILY_API_KEY
        ? 'tavily'
        : process.env.SERPER_API_KEY
          ? 'serper'
          : process.env.BING_SEARCH_KEY
            ? 'bing'
            : ''),
    tavilyKey: process.env.TAVILY_API_KEY || '',
    serperKey: process.env.SERPER_API_KEY || '',
    bingKey: process.env.BING_SEARCH_KEY || '',
    maxResults: Number(process.env.SEARCH_MAX_RESULTS || 6),
    timeoutMs: Number(process.env.SEARCH_TIMEOUT_MS || 15000),
  },
};

export function isAiReady() {
  return aiConfig.enabled && Boolean(aiConfig.apiKey);
}
