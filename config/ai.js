import 'dotenv/config';

// 联网检索 provider 探测：显式指定优先；MiniMax 内置搜索会额外消耗模型额度，故不自动回退
function detectSearchProvider() {
  const explicit = String(process.env.SEARCH_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.TAVILY_API_KEY) return 'tavily';
  if (process.env.SERPER_API_KEY) return 'serper';
  if (process.env.BING_SEARCH_KEY) return 'bing';
  const minimaxOn = String(process.env.SEARCH_MINIMAX_ENABLED || '').toLowerCase() === 'true';
  if (minimaxOn && process.env.MINIMAX_API_KEY) return 'minimax';
  return '';
}

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
    provider: detectSearchProvider(),
    tavilyKey: process.env.TAVILY_API_KEY || '',
    serperKey: process.env.SERPER_API_KEY || '',
    bingKey: process.env.BING_SEARCH_KEY || '',
    maxResults: Number(process.env.SEARCH_MAX_RESULTS || 6),
    timeoutMs: Number(process.env.SEARCH_TIMEOUT_MS || 15000),
    // MiniMax 内置搜索（Server Tools · web_search，Beta）：走 Responses API，服务端自动执行
    minimax: {
      url: process.env.MINIMAX_RESPONSES_URL || 'https://api.minimax.cn/v1/responses',
      messagesUrl: process.env.MINIMAX_MESSAGES_URL || 'https://api.minimax.cn/anthropic/v1/messages',
      // 两条通道负载相互独立，实测一条 529 时另一条常可用，故交替重试
      channels: String(process.env.MINIMAX_SEARCH_CHANNELS || 'responses,messages')
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter((x) => x === 'responses' || x === 'messages'),
      anthropicVersion: process.env.MINIMAX_ANTHROPIC_VERSION || '2023-06-01',
      apiKey: process.env.MINIMAX_SEARCH_KEY || process.env.MINIMAX_API_KEY || '',
      model: process.env.MINIMAX_SEARCH_MODEL || 'MiniMax-M3.1-Flash',
      timeoutMs: Number(process.env.SEARCH_MINIMAX_TIMEOUT_MS || 120000),
      retries: Number(process.env.SEARCH_MINIMAX_RETRIES || 1),
      maxOutputTokens: Number(process.env.SEARCH_MINIMAX_MAX_TOKENS || 800),
    },
  },
};

export function isAiReady() {
  return aiConfig.enabled && Boolean(aiConfig.apiKey);
}
