import { createRouter, createWebHashHistory } from 'vue-router';
import { getToken } from '../api/http.js';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    path: '/',
    component: () => import('../layouts/AppLayout.vue'),
    redirect: '/partners',
    children: [
      {
        path: 'partners',
        name: 'partners',
        component: () => import('../views/PartnerListView.vue'),
        meta: { title: '客户管理' },
      },
      {
        path: 'partners/:id',
        name: 'partner-report',
        component: () => import('../views/PartnerReportView.vue'),
        meta: { title: '资信报告' },
      },
      {
        path: 'risk-center',
        name: 'risk-center',
        component: () => import('../views/RiskCenterView.vue'),
        meta: { title: '预警中心' },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/partners' },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach((to) => {
  const logged = !!getToken();
  if (!to.meta.public && !logged) return { name: 'login', query: { redirect: to.fullPath } };
  if (to.name === 'login' && logged) return { name: 'partners' };
  document.title = to.meta.title ? `${to.meta.title} · 合作方资信分析系统` : '合作方资信分析系统';
  return true;
});

export default router;
