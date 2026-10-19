import http from './http.js';

export const authApi = {
  login: (username, password) => http.post('/auth/login', { username, password }),
  me: () => http.get('/auth/me'),
  scope: () => http.get('/auth/scope'),
};

export const partnerApi = {
  list: (params) => http.get('/partners', { params }),
  detail: (id) => http.get(`/partners/${id}`),
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
};

export const riskApi = {
  list: (params) => http.get('/risk-events', { params }),
  stats: (days = 30) => http.get('/risk-events/stats', { params: { days } }),
};

export const orgApi = {
  list: () => http.get('/orgs'),
};
