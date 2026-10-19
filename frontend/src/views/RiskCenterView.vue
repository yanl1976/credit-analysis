<template>
  <div>
    <div class="stat-row">
      <div class="stat-card">
        <div class="label">近 {{ days }} 天预警</div>
        <div class="value">{{ stats.total }}</div>
      </div>
      <div class="stat-card">
        <div class="label">等级变化</div>
        <div class="value">{{ typeCount('GRADE_CHANGE') }}</div>
      </div>
      <div class="stat-card">
        <div class="label">涉及客户（本页）</div>
        <div class="value">{{ rows.length }}</div>
      </div>
    </div>

    <div class="page-card">
      <h3 class="page-title">预警中心</h3>
      <p class="page-sub">评分等级发生变化时自动记录，按客户归属组织做数据隔离。</p>

      <div class="toolbar">
        <el-select v-model="days" style="width: 140px" @change="loadStats">
          <el-option label="近 7 天" :value="7" />
          <el-option label="近 30 天" :value="30" />
          <el-option label="近 90 天" :value="90" />
        </el-select>
        <el-select v-model="eventType" clearable placeholder="事件类型" style="width: 160px" @change="load(1)">
          <el-option label="等级变化" value="GRADE_CHANGE" />
        </el-select>
        <el-button type="primary" @click="load(1)">刷新</el-button>
      </div>

      <el-table v-loading="loading" :data="rows" border stripe>
        <el-table-column prop="createdAt" label="时间" width="170" />
        <el-table-column label="客户" min-width="220">
          <template #default="{ row }">
            <el-link type="primary" @click="openPartner(row.partnerId)">{{ row.partnerName || '-' }}</el-link>
            <div class="sub">{{ row.partnerCreditCode || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="eventType" label="事件" width="130">
          <template #default="{ row }">
            <el-tag size="small" :type="row.eventType === 'GRADE_CHANGE' ? 'warning' : 'info'">
              {{ eventLabel(row.eventType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="等级变化" width="150">
          <template #default="{ row }">
            <el-tag size="small" :type="gradeTagType(row.oldGrade)">{{ row.oldGrade || '-' }}</el-tag>
            <span class="arrow">→</span>
            <el-tag size="small" :type="gradeTagType(row.newGrade)" effect="dark">
              {{ row.newGrade || '-' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="分数变化" width="120">
          <template #default="{ row }">
            {{ row.detail?.prevScore ?? '-' }} → {{ row.detail?.score ?? '-' }}
          </template>
        </el-table-column>
        <el-table-column label="风险级别" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.detail?.riskLevel" size="small" :type="riskTagType(row.detail.riskLevel)">
              {{ row.detail.riskLevel }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="detail.calcVersion" label="模型版本" width="100" />
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
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { riskApi } from '../api/index.js';
import { gradeTagType, riskTagType } from '../utils/grade.js';

const router = useRouter();
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const days = ref(30);
const eventType = ref('');
const stats = ref({ total: 0, byType: [], byGrade: [] });

function eventLabel(type) {
  return type === 'GRADE_CHANGE' ? '等级变化' : type || '-';
}

function typeCount(type) {
  return stats.value.byType?.find((x) => x.eventType === type)?.count || 0;
}

function openPartner(partnerId) {
  router.push({ name: 'partner-report', params: { id: partnerId } });
}

async function load(p = page.value) {
  loading.value = true;
  try {
    page.value = Number(p) || 1;
    const data = await riskApi.list({
      eventType: eventType.value || undefined,
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
.pager {
  margin-top: 14px;
  justify-content: flex-end;
}
</style>
