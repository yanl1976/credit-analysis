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

    <el-table v-loading="loading" :data="rows" border stripe class="partner-table">
      <el-table-column prop="name" label="客户名称" min-width="220" show-overflow-tooltip />
      <el-table-column prop="credit_code" label="统一社会信用代码" min-width="180" show-overflow-tooltip />
      <el-table-column prop="legal_person" label="法定代表人" min-width="100" show-overflow-tooltip />
      <el-table-column label="工商状态" min-width="100" show-overflow-tooltip>
        <template #default="{ row }">
          <el-tag v-if="row.reg_status" size="small" :type="isRiskyStatus(row.reg_status) ? 'danger' : 'success'">
            {{ row.reg_status }}
          </el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="信用评分" min-width="130" align="center">
        <template #default="{ row }">
          <el-tooltip v-if="hasRating(row)" :content="ratingTip(row)" placement="top">
            <span class="score-cell">
              <span class="score-num" :class="scoreClass(row)">{{ row.rating_score }}</span>
              <el-tag size="small" :type="gradeTagType(row.rating_grade)" effect="plain">{{ row.rating_grade }}</el-tag>
            </span>
          </el-tooltip>
          <span v-else class="score-empty">未评分</span>
        </template>
      </el-table-column>
      <el-table-column label="数据来源" min-width="100" show-overflow-tooltip>
        <template #default="{ row }">
          <el-tag size="small" :type="sourceTagType(row.data_source)">{{ sourceLabel(row.data_source) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="industry" label="行业" min-width="120" show-overflow-tooltip />
      <el-table-column prop="province" label="省份" min-width="80" show-overflow-tooltip />
      <el-table-column label="操作" min-width="230" fixed="right">
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

    <el-dialog v-model="createVisible" title="新建客户" width="560px">
      <div v-if="aiStatus.configured" class="ai-bar">
        <el-input
          v-model="aiQuery"
          placeholder="输入企业名称，AI 查询后自动填充下方字段"
          clearable
          @keyup.enter="aiFill"
        />
        <el-button type="primary" plain :loading="aiLoading" @click="aiFill">AI 查询填充</el-button>
      </div>
      <el-alert
        v-if="aiStatus.configured && !aiStatus.search?.configured"
        type="warning"
        :closable="false"
        show-icon
        class="mb10"
        title="当前未配置搜索 Key，AI 只能依据已有知识推断，可能过时；请务必核验后再保存。"
      />
      <el-alert
        v-if="aiMeta"
        :type="aiMeta.confidence === 'low' ? 'warning' : 'success'"
        :closable="false"
        show-icon
        class="mb10"
        :title="`AI 生成草稿（置信度 ${aiMeta.confidence}），共 ${aiMeta.evidence?.length || 0} 条检索证据，保存前请逐项核验`"
      >
        <div v-if="aiMeta.notes?.length" class="ai-notes">
          <div v-for="(n, i) in aiMeta.notes" :key="i">· {{ n }}</div>
        </div>
        <div v-if="aiMeta.evidence?.length" class="ai-notes">
          <div v-for="(e, i) in aiMeta.evidence" :key="'e' + i">
            · <el-link type="primary" :href="e.url" target="_blank">{{ e.title || e.url }}</el-link>
          </div>
        </div>
      </el-alert>

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
import { ElMessageBox } from 'element-plus';
import { ElMessage } from '../utils/feedback.js';
import { partnerApi, authApi, orgApi, settingApi, aiApi } from '../api/index.js';
import { useAuthStore } from '../stores/auth.js';
import { sourceLabel, sourceTagType, gradeTagType } from '../utils/grade.js';

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
const aiStatus = reactive({ configured: false, search: { configured: false }, note: '' });
const aiQuery = ref('');
const aiLoading = ref(false);
const aiFilled = ref(false);
const aiMeta = ref(null);
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

// 信用评分列：有评分才显示分数+等级，未评分给明确占位（0 分是合法值，不能用真假判断）
function hasRating(row) {
  return row?.rating_score !== null && row?.rating_score !== undefined;
}

function scoreClass(row) {
  const score = Number(row?.rating_score);
  if (score >= 80) return 'score-good';
  if (score >= 60) return 'score-mid';
  return 'score-bad';
}

function ratingTip(row) {
  const risk = row?.rating_risk_level || '-';
  const at = row?.rating_calculated_at || '-';
  return `风险等级：${risk} · 计算时间：${at}`;
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
  aiQuery.value = '';
  aiFilled.value = false;
  aiMeta.value = null;
  createVisible.value = true;
}

async function aiFill() {
  const name = (aiQuery.value || form.name || '').trim();
  if (!name) return ElMessage.warning('请输入企业名称');
  aiLoading.value = true;
  try {
    const res = await aiApi.profile(name);
    const p = res.profile || {};
    if (p.name) form.name = p.name;
    if (p.creditCode) form.creditCode = p.creditCode;
    if (p.legalPerson) form.legalPerson = p.legalPerson;
    if (p.regStatus) form.regStatus = p.regStatus;
    if (p.province) form.province = p.province;
    if (p.industry) form.industry = p.industry;
    aiFilled.value = true;
    aiMeta.value = { confidence: res.confidence, notes: res.notes || [], evidence: res.evidence || [], meta: res.meta };
    ElMessage.success(`AI 已填充（置信度 ${res.confidence}），请核验后保存`);
  } finally {
    aiLoading.value = false;
  }
}

async function handleCreate() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写客户名称');
    return;
  }
  saving.value = true;
  try {
    const created = await partnerApi.create({
      ...form,
      ownerOrgId: form.ownerOrgId || undefined,
      dataSource: aiFilled.value ? 'ai' : 'manual',
    });
    ElMessage.success(created?._normalized ? '已存在同信用代码客户，已直接复用' : '创建成功');
    createVisible.value = false;
    await load(1);
  } finally {
    saving.value = false;
  }
}

function openReport(row) {
  // 带上当前检索词，报告页的「上一条/下一条」会在同一筛选范围内翻页
  router.push({
    name: 'partner-report',
    params: { id: row.id },
    query: keyword.value ? { keyword: keyword.value } : {},
  });
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
  if (auth.hasPerm('customer:manage')) {
    try {
      Object.assign(aiStatus, await aiApi.status());
    } catch {
      /* AI 未启用时忽略 */
    }
  }
});
</script>

<style scoped>
.hint {
  color: #909399;
  font-size: 13px;
  margin-left: auto;
}
/* 列不换行 + 按 min-width 自适应；内容超长由 show-overflow-tooltip 提供悬浮提示 */
.partner-table :deep(.el-table__cell .cell) {
  white-space: nowrap;
}
.score-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.score-num {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.score-good {
  color: #67c23a;
}
.score-mid {
  color: #e6a23c;
}
.score-bad {
  color: #f56c6c;
}
.score-empty {
  color: #909399;
}
.pager {
  margin-top: 14px;
  justify-content: flex-end;
}
.ai-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.mb10 {
  margin-bottom: 10px;
}
.ai-notes {
  font-size: 12px;
  color: #606266;
  line-height: 1.7;
  margin-top: 4px;
}
</style>
