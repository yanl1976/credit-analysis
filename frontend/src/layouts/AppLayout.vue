<template>
  <el-container class="layout">
    <el-aside width="200px" class="aside">
      <div class="brand">合作方资信分析</div>
      <el-menu :default-active="activeMenu" router class="menu">
        <el-menu-item index="/partners">客户管理</el-menu-item>
        <el-menu-item index="/risk-center">预警中心</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span class="title">{{ route.meta.title || '' }}</span>
        <div class="user">
          <span>{{ auth.displayName }}</span>
          <el-button link type="primary" @click="handleLogout">退出</el-button>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const activeMenu = computed(() => (route.path.startsWith('/partners') ? '/partners' : route.path));

function handleLogout() {
  auth.logout();
  router.replace({ name: 'login' });
}
</script>

<style scoped>
.layout {
  height: 100%;
}
.aside {
  background: #1f2d3d;
  color: #fff;
}
.brand {
  height: 56px;
  line-height: 56px;
  text-align: center;
  font-weight: 600;
  color: #fff;
  letter-spacing: 1px;
}
.menu {
  border-right: none;
  background: transparent;
}
.menu :deep(.el-menu-item) {
  color: #c0c4cc;
}
.menu :deep(.el-menu-item.is-active) {
  color: #fff;
  background: #263445;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}
.header .title {
  font-size: 15px;
  font-weight: 600;
}
.user {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #606266;
  font-size: 13px;
}
.main {
  background: #f5f7fa;
  padding: 16px;
}
</style>
