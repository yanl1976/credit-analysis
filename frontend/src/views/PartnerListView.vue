<template>
  <div class="page-card">
    <h3 class="page-title">客户管理</h3>
    <p class="page-sub">按统一社会信用代码归一主体；评分与预警均以客户为维度。</p>

    <div class="toolbar">
      <el-input
        v-model="keyword"
        placeholder="按名称 / 信用代码检索"
        clearable
        style="width: 260px"
        @keyup.enter="load(1)"
        @clear="load(1)"
      />
      <el-button type="primary" @click="load(1)">检索</el-button>
      <el-button v-if="auth.hasPerm('customer:manage')" @click="openCreate">新建客户</el-button>
      <el-button
        v-if="auth.hasPerm('report:view')"
        type="warning"
        plain
        :loading="batchLoading"
        @click="handleBatchRate"
      >
        批量重算（当前范围）
      </el-button>
      <span class="hint">共 {{ total }} 个客户</span>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column prop="name" label="客户名称" min-width="220" show-overflow-tooltip />
      <el-table-column prop="credit_code" label="统一社会信用代码" width="200" />
      <el-table-column prop="legal_person" label="法定代表人" width="120" />
      <el-table-column label="工商状态" width="110">
        <template #default="{ row }">
          <el-tag v-if="row.reg_status" size="small" :type="isRiskyStatus(row.reg_status) ? 'danger' : 'success'">
            {{ row.reg_status }}
          </el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column prop="industry" label="行业" width="120" />
      <el-table-column prop="province" label="省份" width="100" />
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openReport(row)">资信报告</el-button>
          <el-button
            v-if="auth.hasPerm('report:view')"
            link
            type="warning"
            :loading="ratingId === row.id"
            @click="handleRate(row)"
          >
            重算评分
          </el-button>
          <el-button
            v-if="auth.hasPerm('customer:manage')"
            link
            type="danger"
            @click="handleDelete(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="pager"
      layout="total, prev, pager, next, sizes"
      :total="total"
      :current-page="page"
      :page-size="pageSize"
      :page-sizes="[10, 20, 50]"
      @current-change="load"
      @size-change="onSizeChange"
    />

    <el-dialog v-model="createVisible" title="新建客户" width="520px">
      <el-form :model="form" label-width="120px">
        <el-form-item label="客户名称" required>
          <el-input v-model="form.name" placeholder="企业全称" />
        </el-form-item>
        <el-form-item label="信用代码">
          <el-input v-model="form.creditCode" placeholder="统一社会信用代码（同码自动归一）" />
        </el-form-item>
        <el-form-item label="法定代表人">
          <el-input v-model="form.legalPerson" />
        </el-form-item>
        <el-form-item label="工商状态">
          <el-select v-model="form.regStatus" clearable style="width: 100%">
            <el-option v-for="s in regStatuses" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="行业">
          <el-input v-model="form.industry" />
        </el-form-item>
        <el-form-item label="省份">
          <el-input v-model="form.province" />
        </el-form-item>
        <el-form-item v-if="scope.isFull" label="归属组织">
          <el-select v-model="form.ownerOrgId" clearable style="width: 100%" placeholder="默认当前组织">
            <el-option v-for="o in orgs" :key="o.id" :label="o.org_name" :value="o.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleCreate">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { partnerApi, authApi, orgApi, settingApi } from '../api/index.js';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();

const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const keyword = ref('');
const loading = ref(false);
const batchLoading = ref(false);
const ratingId = ref(0);
const scope = reactive({ isFull: false, orgIds: [] });
const orgs = ref([]);

const regStatuses = ['存续', '在营', '开业', '吊销', '注销', '迁出', '停业'];

const createVisible = ref(false);
const saving = ref(false);
const form = reactive({
  name: '',
  creditCode: '',
  legalPerson: '',
  regStatus: '存续',
  industry: '',
  province: '',
  ownerOrgId: null,
});

function isRiskyStatus(status) {
  return /吊销|注销|停业/.test(status || '');
}

async function load(p = page.value) {
  loading.value = true;
  try {
    page.value = Number(p) || 1;
    const data = await partnerApi.list({
      keyword: keyword.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    rows.value = data.items || [];
    total.value = data.total || 0;
  } finally {
    loading.value = false;
  }
}

function onSizeChange(size) {
  pageSize.value = size;
  load(1);
}

function openCreate() {
  Object.assign(form, {
    name: '',
    creditCode: '',
    legalPerson: '',
    regStatus: '存续',
    industry: '',
    province: '',
    ownerOrgId: null,
  });
  createVisible.value = true;
}

async function handleCreate() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写客户名称');
    return;
  }
  saving.value = true;
  try {
    const created = await partnerApi.create({ ...form, ownerOrgId: form.ownerOrgId || undefined });
    ElMessage.success(created?._normalized ? '已存在同信用代码客户，已直接复用' : '创建成功');
    createVisible.value = false;
    await load(1);
  } finally {
    saving.value = false;
  }
}

function openReport(row) {
  router.push({ name: 'partner-report', params: { id: row.id } });
}

async function handleRate(row) {
  ratingId.value = row.id;
  try {
    const res = await partnerApi.rate(row.id);
    ElMessage.success(
      `评分完成：${res.score} 分 / ${res.grade}${res.gradeChanged ? '（等级变化）' : ''}`,
    );
  } finally {
    ratingId.value = 0;
  }
}

async function handleBatchRate() {
  await ElMessageBox.confirm(
    '将对当前数据范围内的全部客户重新计算评分，且每次重算都会写入历史。是否继续？',
    '批量重算',
    { type: 'warning' },
  );
  batchLoading.value = true;
  try {
    const res = await partnerApi.rateBatch();
    ElMessage.success(
      `重算完成：成功 ${res.succeeded}/${res.total}，等级变化 ${res.gradeChanged} 个，失败 ${res.failed} 个`,
    );
  } finally {
    batchLoading.value = false;
  }
}

async function handleDelete(row) {
  await ElMessageBox.confirm(`确认删除客户「${row.name}」及其全部采集/评分数据？`, '删除确认', {
    type: 'warning',
  });
  await partnerApi.remove(row.id);
  ElMessage.success('已删除');
  await load();
}

onMounted(async () => {
  try {
    const pub = await settingApi.public();
    if (pub?.pageSize) pageSize.value = Number(pub.pageSize) || 20;
  } catch {
    /* 使用默认分页 */
  }
  await load(1);
  const s = await authApi.scope();
  Object.assign(scope, s);
  if (s.isFull) orgs.value = (await orgApi.list()) || [];
});
</script>

<style scoped>
.hint {
  color: #909399;
  font-size: 13px;
  margin-left: auto;
}
.pager {
  margin-top: 14px;
  justify-content: flex-end;
}
</style>
