// 采集结果的失败原因分类（单一事实来源）
// 目的：把「欠费」「额度用尽」「配置错」「代码没写」「数据不一致」「网络问题」分开，
// 避免像以前那样全部塞进 not_implemented，导致无法判断到底该充值、改配置还是查代码。
//
// 每条原因都带 category，调用方（前端/运维/日志）按 category 就能定位责任方：
//   billing      需要充值（账户余额）
//   quota        额度用尽（本地预算 或 平台限流）
//   entitlement  需要开通/购买接口
//   config       配置错误（Key、鉴权、开关）
//   code         系统自身问题（Connector 未实现）
//   data         数据问题（主体不一致、入参缺失）
//   network      网络/超时
//   api          渠道返回其它业务错误

export const REASON = {
  // 用户明确没启用该渠道 → 属于"预期内的不参与"，不应当作错误提示
  DISABLED: 'disabled',
  // 已启用但缺 Key/开关异常 → 配置问题，必须提示，否则会永远静默不工作
  NOT_CONFIGURED: 'not_configured',
  NOT_IMPLEMENTED: 'not_implemented',
  MISMATCH: 'mismatch',
  MISSING_INPUT: 'missing_input',
  INSUFFICIENT_BALANCE: 'insufficient_balance',
  LOCAL_QUOTA: 'local_quota_exceeded',
  API_QUOTA: 'api_quota_exceeded',
  NOT_SUBSCRIBED: 'api_not_subscribed',
  AUTH_FAILED: 'auth_failed',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  API_ERROR: 'api_error',
  UNKNOWN: 'unknown',
};

export const REASON_META = {
  [REASON.DISABLED]: {
    category: 'disabled',
    label: '未启用',
    hint: '该渠道未在系统设置中启用，本次不参与采集',
  },
  [REASON.NOT_CONFIGURED]: {
    category: 'config',
    label: '缺少配置',
    hint: '渠道已启用但未填写 API Key，请求未发出',
  },
  [REASON.NOT_IMPLEMENTED]: {
    category: 'code',
    label: '渠道未实现',
    hint: '该渠道 Connector 尚未实现，请求未发出（系统开发问题，非账号问题）',
  },
  [REASON.MISMATCH]: {
    category: 'data',
    label: '主体不一致',
    hint: '查到企业但名称/信用代码/法人与档案不符，已拒绝回填',
  },
  [REASON.MISSING_INPUT]: {
    category: 'data',
    label: '资料不全',
    hint: '客户档案缺少调用所需字段（如法定代表人/信用代码），请先补全',
  },
  [REASON.INSUFFICIENT_BALANCE]: {
    category: 'billing',
    label: '账户欠费',
    hint: '开放平台账户余额不足（300006），需充值；与本地额度、系统代码无关',
  },
  [REASON.LOCAL_QUOTA]: {
    category: 'quota',
    label: '本地额度用尽',
    hint: '已达本系统设置的日调用/日成本上限，请求未发出；可在「系统设置 → 数据渠道」上调，与账户余额无关',
  },
  [REASON.API_QUOTA]: {
    category: 'quota',
    label: '平台限流',
    hint: '开放平台频率或并发受限（300007），稍后重试即可；不是欠费',
  },
  [REASON.NOT_SUBSCRIBED]: {
    category: 'entitlement',
    label: '接口未开通',
    hint: '账号未购买该接口（300005），需在控制台开通',
  },
  [REASON.AUTH_FAILED]: {
    category: 'config',
    label: '鉴权失败',
    hint: 'Token 无效，或鉴权头格式不对（300009；本平台要求裸 token，不带 Bearer）',
  },
  [REASON.TIMEOUT]: {
    category: 'network',
    label: '请求超时',
    hint: '网络或对端响应超时，可重试',
  },
  [REASON.NETWORK]: {
    category: 'network',
    label: '网络异常',
    hint: 'DNS/连接/TLS 失败，检查本机网络或代理',
  },
  [REASON.API_ERROR]: {
    category: 'api',
    label: '接口报错',
    hint: '渠道返回其它业务错误，见原始错误',
  },
  [REASON.UNKNOWN]: {
    category: 'unknown',
    label: '未知原因',
    hint: '未能归类，见原始错误',
  },
};

export function reasonMeta(code) {
  return REASON_META[code] || REASON_META[REASON.UNKNOWN];
}

export const CATEGORY_LABEL = {
  billing: '需充值',
  quota: '额度用尽',
  entitlement: '需开通接口',
  config: '配置问题',
  code: '系统问题',
  data: '数据问题',
  network: '网络问题',
  api: '接口报错',
  unknown: '未知原因',
};

// 天眼查开放平台 error_code → 原因分类
export function tycReasonOf(code) {
  switch (Number(code)) {
    case 300005:
      return REASON.NOT_SUBSCRIBED;
    case 300006:
      return REASON.INSUFFICIENT_BALANCE;
    case 300007:
      return REASON.API_QUOTA;
    case 300009:
      return REASON.AUTH_FAILED;
    default:
      return REASON.API_ERROR;
  }
}

// 网络层异常 → 原因分类（AbortSignal.timeout 抛 TimeoutError）
export function reasonOfException(e) {
  const name = String(e?.name || '');
  const msg = String(e?.message || '');
  if (name === 'TimeoutError' || /timeout|timed out|aborted/i.test(msg)) return REASON.TIMEOUT;
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|fetch failed/i.test(msg)) {
    return REASON.NETWORK;
  }
  return REASON.UNKNOWN;
}
