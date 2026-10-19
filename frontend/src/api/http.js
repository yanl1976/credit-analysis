import axios from 'axios';
import { ElMessage } from 'element-plus';

const TOKEN_KEY = 'ca_access_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

const http = axios.create({ baseURL: '/api', timeout: 30000 });

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => response.data?.data,
  (error) => {
    const status = error.response?.status;
    const message =
      error.response?.data?.message || error.response?.data?.error || error.message || '请求失败';

    if (status === 401) {
      setToken('');
      if (window.location.hash !== '#/login') window.location.hash = '#/login';
    }
    if (status !== 401) ElMessage.error(message);
    return Promise.reject(new Error(message));
  },
);

export default http;
