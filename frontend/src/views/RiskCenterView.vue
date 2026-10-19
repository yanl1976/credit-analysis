<template>
  <div>
    <div class="stat-row">
      <div class="stat-card">
        <div class="label">待处理</div>
        <div class="value">{{ stats.pendingTotal || 0 }}</div>
      </div>
      <div class="stat-card">
        <div class="label">近 {{ days }} 天预警</div>
        <div class="value">{{ stats.total }}</div>
      </div>
      <div class="stat-card">
        <div class="label">等级变化</div>
        <div class="value">{{ typeCount('GRADE_CHANGE') }}</div>
      </div>
      <div class="stat-card">
        <div class="label">近 {{ days }} 天已关闭</div>
        <div class="value">{{ stats.closedCount || 0 }}</div>
      </div>
    </div>

    <div class="page-card">
      <h3 class="page-title">预警中心</h3>
      <p class="page-sub">评分等级发生变化时自动记录，按客户归属组织做数据隔离；每条预警可跟踪处置进度。</p>

      <div class="toolbar">
        <el-select v-model="days" style="width: 140px" @change="loadStats">
          <el-option label="近 7 天" :value="7" />
          <el-option label="近 30 天" :value="30" />
          <el-option label="近 90 天" :value="90" />
        </el-select>
        <el-select v-model="eventType" clearable placeholder="事件类型" style="width: 160px" @change="load(1)">
          <el-option label="等级变化" value="GRADE_CHANGE" />
        </el-select>
        <el-select v-model="statusFilter" clearable placeholder="处置状态" style="width: 140px" @change="load(1)">
          <el-option label="待处理" value="OPEN" />
          <el-option label="处理中" value="PROCESSING" />
          <el-option label="已关闭" value="CLOSED" />
        </el-select>
        <el-button type="primary" @click="load(1)">刷新</el-button>
      </div>

      <el-table v-loading="loading" :data="rows" border stripe>
        <el-table-column prop="createdAt" label="时间" width="170" />
        <el-table-column label="客户" min-width="200">
          <template #default="{ row }">
            <el-link type="primary" @click="openPartner(row.partnerId)">{{ row.partnerName || '-' }}</el-link>
            <div class="sub">{{ row.partnerCreditCode || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="eventType" label="事件" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="row.eventType === 'GRADE_CHANGE' ? 'warning' : 'info'">
              {{ eventLabel(row.eventType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="等级变化" width="140">
          <template #default="{ row }">
            <el-tag size="small" :type="gradeTagType(row.oldGrade)">{{ row.oldGrade || '-' }}</el-tag>
            <span class="arrow">→</span>
            <el-tag size="small" :type="gradeTagType(row.newGrade)" effect="dark">
              {{ row.newGrade || '-' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="分数变化" width="110">
          <template #default="{ row }">
            {{ row.detail?.prevScore ?? '-' }} → {{ row.detail?.score ?? '-' }}
          </template>
        </el-table-column>
        <el-table-column label="风险级别" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.detail?.riskLevel" size="small" :type="riskTagType(row.detail.riskLevel)">
              {{ row.detail.riskLevel }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="处置状态" width="150">
          <template #default="{ row }">
            <el-tag size="small" :type="statusTagType(row.status)">{{ statusLabel(row.status) }}</el-tag>
            <div v-if="row.handleNote" class="sub note" :title="row.handleNote">{{ row.handleNote }}</div>
          </template>
        </el-table-column>
        <el-table-column label="处理人" width="150">
          <template #default="{ row }">
            <template v-if="row.handledByName">
              {{ row.handledByName }}
              <div v-if="row.handledAt" class="sub">{{ row.handledAt }}</div>
            </template>
            <span v-else class="sub">-</span>
          </template>
        </el-table-column>
        <el-table-column v-if="auth.hasPerm('customer:manage')" label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openHandle(row)">处置</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        class="pager"
        layout="total, prev, pager, next"
        :total="total"
        :current-page="page"
        :page-size="pageSize"
        @current-change="load"
      />
    </div>

    <el-dialog v-model="handleVisible" title="预警处置" width="520px">
      <el-form label-width="84px">
        <el-form-item label="客户">{{ handleForm.partnerName }}</el-form-item>
        <el-form-item label="处置状态">
          <el-radio-group v-model="handleForm.status">
            <el-radio-button value="OPEN">待处理</el-radio-button>
            <el-radio-button value="PROCESSING">处理中</el-radio-button>
            <el-radio-button value="CLOSED">已关闭</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="处置备注">
          <el-input
            v-model="handleForm.note"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="如：已联系采购部暂停下单，等待对方说明被执行案件进展"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="handleVisible = false">取消</el-button>
        <el-button type="primary" :loading="handleSaving" @click="submitHandle">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { riskApi } from '../api/index.js';
import { gradeTagType, riskTagType } from '../utils/grade.js';
import { ElMessage } from '../utils/feedback.js';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const auth = useAuthStore();
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const days = ref(30);
const eventType = ref('');
const statusFilter = ref('');
const stats = ref({ total: 0, byType: [], byGrade: [], pendingTotal: 0, closedCount: 0 });

// 处置对话框
const handleVisible = ref(false);
const handleSaving = ref(false);
const handleForm = reactive({ id: 0, partnerName: '', status: 'PROCESSING', note: '' });

const STATUS_LABELS = { OPEN: '待处理', PROCESSING: '处理中', CLOSED: '已关闭' };
const STATUS_TYPES = { OPEN: 'warning', PROCESSING: 'primary', CLOSED: 'success' };

function statusLabel(status) {
  return STATUS_LABELS[status] || '待处理';
}

function statusTagType(status) {
  return STATUS_TYPES[status] || 'info';
}

function eventLabel(type) {
  return type === 'GRADE_CHANGE' ? '等级变化' : type || '-';
}

function typeCount(type) {
  return stats.value.byType?.find((x) => x.eventType === type)?.count || 0;
}

function openPartner(partnerId) {
  router.push({ name: 'partner-report', params: { id: partnerId } });
}

function openHandle(row) {
  Object.assign(handleForm, {
    id: row.id,
    partnerName: row.partnerName || '-',
    status: row.status || 'OPEN',
    note: row.handleNote || '',
  });
  handleVisible.value = true;
}

async function submitHandle() {
  handleSaving.value = true;
  try {
    await riskApi.handle(handleForm.id, { status: handleForm.status, note: handleForm.note });
    ElMessage.success(`已更新为「${statusLabel(handleForm.status)}」`);
    handleVisible.value = false;
    await Promise.all([load(), loadStats()]);
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e.message || '处置保存失败');
  } finally {
    handleSaving.value = false;
  }
}

async function load(p = page.value) {
  loading.value = true;
  try {
    page.value = Number(p) || 1;
    const data = await riskApi.list({
      eventType: eventType.value || undefined,
      status: statusFilter.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    rows.value = data.items || [];
    total.value = data.total || 0;
  } finally {
    loading.value = false;
  }
}

async function loadStats() {
  stats.value = await riskApi.stats(days.value);
}

onMounted(async () => {
  try {
    const { settingApi } = await import('../api/index.js');
    const pub = await settingApi.public();
    if (pub?.pageSize) pageSize.value = Number(pub.pageSize) || 20;
  } catch {
    /* 使用默认分页 */
  }
  await Promise.all([load(1), loadStats()]);
});
</script>

<style scoped>
.sub {
  color: #909399;
  font-size: 12px;
}
.arrow {
  margin: 0 6px;
  color: #909399;
}
.note {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pager {
  margin-top: 14px;
  justify-content: flex-end;
}
</style>
