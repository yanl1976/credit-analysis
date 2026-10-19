<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <div class="brand">合作方资信分析系统</div>
      <div class="sub">客户资信 · 风险评分 · 变更预警</div>
      <el-form :model="form" @submit.prevent="handleLogin">
        <el-form-item>
          <el-input v-model="form.username" placeholder="用户名" size="large" autofocus />
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            size="large"
            show-password
            @keyup.enter="handleLogin"
          />
        </el-form-item>
        <el-button type="primary" size="large" class="submit" :loading="loading" @click="handleLogin">
          登录
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const loading = ref(false);
const form = reactive({ username: '', password: '' });

async function handleLogin() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    await auth.login(form.username.trim(), form.password);
    ElMessage.success('登录成功');
    router.replace(route.query.redirect || '/dashboard');
  } catch {
    // 拦截器已提示
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1f2d3d 0%, #3a5169 100%);
}
.login-card {
  width: 380px;
}
.brand {
  font-size: 20px;
  font-weight: 600;
  text-align: center;
}
.sub {
  color: #909399;
  font-size: 12px;
  text-align: center;
  margin: 8px 0 22px;
}
.submit {
  width: 100%;
}
</style>
