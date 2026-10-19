import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { authApi } from '../api/index.js';
import { getToken, setToken } from '../api/http.js';

const USER_KEY = 'ca_user';

function readUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref(getToken());
  const user = ref(readUser());
  const roles = ref(user.value?.roles || []);
  const perms = ref(user.value?.perms || []);

  const isLogged = computed(() => !!token.value);
  const displayName = computed(() => user.value?.realName || user.value?.username || '');

  function persist() {
    if (user.value) localStorage.setItem(USER_KEY, JSON.stringify(user.value));
    else localStorage.removeItem(USER_KEY);
  }

  async function login(username, password) {
    const data = await authApi.login(username, password);
    token.value = data.accessToken;
    setToken(data.accessToken);
    user.value = { ...data.user, roles: data.roles, perms: data.perms };
    roles.value = data.roles || [];
    perms.value = data.perms || [];
    persist();
    return data;
  }

  function logout() {
    token.value = '';
    user.value = null;
    roles.value = [];
    perms.value = [];
    setToken('');
    persist();
  }

  function hasPerm(key) {
    return perms.value.includes(key);
  }

  return { token, user, roles, perms, isLogged, displayName, login, logout, hasPerm };
});
