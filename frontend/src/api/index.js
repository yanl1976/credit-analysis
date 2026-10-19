import http from './http.js';

export const authApi = {
  login: (username, password) => http.post('/auth/login', { username, password }),
  me: () => http.get('/auth/me'),
  scope: () => http.get('/auth/scope'),
};

export const partnerApi = {
  list: (params) => http.get('/partners', { params }),
  detail: (id) => http.get(`/partners/${id}`),
  // 资信报告上下换页：按客户列表顺序取相邻客户（keyword 与列表检索保持一致）
  neighbors: (id, keyword) => http.get(`/partners/${id}/neighbors`, { params: { keyword } }),
  create: (body) => http.post('/partners', body),
  update: (id, body) => http.put(`/partners/${id}`, body),
  remove: (id) => http.delete(`/partners/${id}`),
  collect: (id) => http.post(`/partners/${id}/collect`),
  judicial: (id) => http.get(`/partners/${id}/judicial`),
  credit: (id) => http.get(`/partners/${id}/credit`),
  finance: (id) => http.get(`/partners/${id}/finance`),
  rate: (id, dryRun = false) => http.post(`/partners/${id}/rate${dryRun ? '?dryRun=1' : ''}`),
  rateBatch: (partnerIds) => http.post('/partners/rate-batch', partnerIds ? { partnerIds } : {}),
  rating: (id) => http.get(`/partners/${id}/rating`),
  ratingHistory: (id, limit = 20) => http.get(`/partners/${id}/rating-history`, { params: { limit } }),
  collectSummary: (id) => http.get(`/partners/${id}/collect-summary`),
  financeFromEastmoney: (id, body) => http.post(`/partners/${id}/finance/eastmoney`, body),
  // 天眼AI（MCP）：基础画像 4 项 + P0 风险明细 11 项（明细需 VIP 权益）
  tycProfile: (id) => http.get(`/partners/${id}/tyc-profile`),
  // 默认节流：缓存命中/已知无权限/额度用尽都会跳过，不重复扣额度
  // body.force=true 忽略缓存与权限记忆强制全量重调
  // 最坏情况仍是 15 个工具逐个调用（间隔 600ms + 网络往返），故必须放宽超时
  tycSync: (id, body = null) => http.post(`/partners/${id}/tyc-sync`, body, { timeout: 180000 }),
  // 只重解析已同步的原始报文，不再请求天眼AI（不消耗调用额度）
  tycResync: (id) => http.post(`/partners/${id}/tyc-resync`),
  createDim: (id, kind, body) => http.post(`/partners/${id}/${kind}`, body),
  updateDim: (id, kind, itemId, body) => http.put(`/partners/${id}/${kind}/${itemId}`, body),
  removeDim: (id, kind, itemId) => http.delete(`/partners/${id}/${kind}/${itemId}`),
};

export const riskApi = {
  list: (params) => http.get('/risk-events', { params }),
  stats: (days = 30) => http.get('/risk-events/stats', { params: { days } }),
  // 预警处置：OPEN 待处理 / PROCESSING 处理中 / CLOSED 已关闭
  handle: (id, body) => http.patch(`/risk-events/${id}`, body),
};

export const dashboardApi = {
  overview: () => http.get('/dashboard/overview'),
};

export const orgApi = {
  list: () => http.get('/orgs'),
  tree: () => http.get('/orgs/tree'),
  create: (body) => http.post('/orgs', body),
  update: (id, body) => http.put(`/orgs/${id}`, body),
  remove: (id) => http.delete(`/orgs/${id}`),
};

export const userApi = {
  list: (params) => http.get('/users', { params }),
  create: (body) => http.post('/users', body),
  update: (id, body) => http.put(`/users/${id}`, body),
  remove: (id) => http.delete(`/users/${id}`),
  roles: (id) => http.get(`/users/${id}/roles`),
  assignRoles: (id, roleIds) => http.put(`/users/${id}/roles`, { roleIds }),
};

export const roleApi = {
  list: () => http.get('/roles'),
  create: (body) => http.post('/roles', body),
  update: (id, body) => http.put(`/roles/${id}`, body),
  remove: (id) => http.delete(`/roles/${id}`),
  permissions: (id) => http.get(`/roles/${id}/permissions`),
  assignPermissions: (id, permissionIds) => http.put(`/roles/${id}/permissions`, { permissionIds }),
};

export const permissionApi = {
  list: () => http.get('/permissions'),
};

export const aiApi = {
  status: () => http.get('/ai/status'),
  profile: (name) => http.post('/ai/partner-profile', { name }),
  collect: (id) => http.post(`/ai/collect/${id}`),
  // 异步采集：先提交任务拿 jobId，再轮询进度（AI 检索要 1~3 分钟，长连接易被超时切断）
  startCollect: (id) => http.post(`/ai/collect/${id}/job`),
  collectJob: (jobId) => http.get(`/ai/collect/jobs/${jobId}`),
};

export const settingApi = {
  public: () => http.get('/settings/public'),
  grouped: () => http.get('/settings'),
  save: (values) => http.put('/settings', { values }),
  channels: () => http.get('/settings/channels'),
};
