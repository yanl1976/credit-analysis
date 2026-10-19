<template>
  <div v-loading="loading">
    <div class="stat-row">
      <div class="stat-card">
        <div class="label">客户总数</div>
        <div class="value">{{ data.partnerCount }}</div>
      </div>
      <div class="stat-card">
        <div class="label">已评分 / 未评分</div>
        <div class="value">{{ data.ratedCount }} <span class="unit">/ {{ data.unratedCount }}</span></div>
      </div>
      <div class="stat-card">
        <div class="label">平均分</div>
        <div class="value">{{ data.avgScore ?? '-' }}</div>
      </div>
      <div class="stat-card">
        <div class="label">一票否决客户</div>
        <div class="value danger">{{ data.vetoCount }}</div>
      </div>
    </div>

    <div class="grid">
      <div class="page-card">
        <div class="card-title">信用等级分布</div>
        <el-empty v-if="!data.gradeDistribution?.length" description="暂无评分，去客户管理点「重算评分」" :image-size="70" />
        <div v-for="g in data.gradeDistribution" :key="g.grade" class="grade-row">
          <el-tag :type="gradeTagType(g.grade)" effect="dark" class="grade-tag">{{ g.grade }}</el-tag>
          <el-progress
            class="grade-bar"
            :percentage="percent(g.count)"
            :stroke-width="14"
            :show-text="false"
            :color="gradeColor(g.grade)"
          />
          <span class="grade-count">{{ g.count }} 家</span>
        </div>
      </div>

      <div class="page-card">
        <div class="card-title">风险级别 / 数据覆盖</div>
        <div class="kv">
          <span class="k">风险级别</span>
          <span class="v">
            <el-tag
              v-for="r in data.riskDistribution"
              :key="r.riskLevel"
              :type="riskTagType(r.riskLevel)"
              class="mr6"
            >
              {{ r.riskLevel }} {{ r.count }}
            </el-tag>
            <span v-if="!data.riskDistribution?.length">-</span>
          </span>
        </div>
        <el-divider />
        <div class="kv"><span class="k">司法记录</span><span class="v">{{ data.dimensionTotals?.judicial }} 条</span></div>
        <div class="kv"><span class="k">信用/合规记录</span><span class="v">{{ data.dimensionTotals?.credit }} 条</span></div>
        <div class="kv"><span class="k">财务线索</span><span class="v">{{ data.dimensionTotals?.finance }} 条</span></div>
      </div>
    </div>

    <div class="grid">
      <div class="page-card">
        <div class="card-title">
          高风险客户 TOP5
          <el-link type="primary" class="more" @click="$router.push('/partners')">客户管理</el-link>
        </div>
        <el-empty v-if="!data.topRiskPartners?.length" description="暂无评分数据" :image-size="70" />
        <el-table v-else :data="data.topRiskPartners" size="small" border>
          <el-table-column label="客户" min-width="200">
            <template #default="{ row }">
              <el-link type="primary" @click="openPartner(row.partnerId)">{{ row.name }}</el-link>
              <el-tag v-if="row.veto" size="small" type="danger" class="ml6">否决</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="score" label="分数" width="80" align="right" />
          <el-table-column label="等级" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="gradeTagType(row.grade)" effect="dark">{{ row.grade }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="风险" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="riskTagType(row.riskLevel)">{{ row.riskLevel }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="page-card">
        <div class="card-title">
          近期预警
          <el-link type="primary" class="more" @click="$router.push('/risk-center')">预警中心</el-link>
        </div>
        <el-empty v-if="!data.recentRiskEvents?.length" description="暂无等级变化" :image-size="70" />
        <el-timeline v-else>
          <el-timeline-item
            v-for="ev in data.recentRiskEvents"
            :key="ev.id"
            :timestamp="ev.createdAt"
            :type="ev.newGrade === 'D' ? 'danger' : 'warning'"
          >
            <el-link type="primary" @click="openPartner(ev.partnerId)">{{ ev.partnerName }}</el-link>
            <span class="ev">等级 {{ ev.oldGrade }} → </span>
            <el-tag size="small" :type="gradeTagType(ev.newGrade)" effect="dark">{{ ev.newGrade }}</el-tag>
            <span class="ev">（{{ ev.detail?.prevScore }} → {{ ev.detail?.score }} 分）</span>
          </el-timeline-item>
        </el-timeline>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { dashboardApi } from '../api/index.js';
import { gradeTagType, riskTagType } from '../utils/grade.js';

const router = useRouter();
const loading = ref(false);
const data = reactive({
  partnerCount: 0,
  ratedCount: 0,
  unratedCount: 0,
  avgScore: null,
  vetoCount: 0,
  gradeDistribution: [],
  riskDistribution: [],
  dimensionTotals: { judicial: 0, credit: 0, finance: 0 },
  recentRiskEvents: [],
  topRiskPartners: [],
});

const GRADE_COLORS = {
  AAA: '#67c23a',
  AA: '#95d475',
  A: '#409eff',
  B: '#e6a23c',
  C: '#f56c6c',
  D: '#c45656',
};

function gradeColor(grade) {
  return GRADE_COLORS[grade] || '#909399';
}

function percent(count) {
  const total = data.ratedCount || 0;
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function openPartner(id) {
  router.push({ name: 'partner-report', params: { id } });
}

onMounted(async () => {
  loading.value = true;
  try {
    Object.assign(data, await dashboardApi.overview());
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}
@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.card-title {
  font-weight: 600;
  margin-bottom: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.grade-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.grade-tag {
  width: 52px;
  text-align: center;
}
.grade-bar {
  flex: 1;
}
.grade-count {
  width: 56px;
  text-align: right;
  color: #606266;
  font-size: 13px;
}
.kv {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  font-size: 14px;
}
.kv .k {
  color: #909399;
}
.mr6 {
  margin-right: 6px;
}
.ml6 {
  margin-left: 6px;
}
.more {
  font-size: 13px;
  font-weight: 400;
}
.ev {
  color: #606266;
  font-size: 13px;
  margin: 0 4px;
}
.unit {
  font-size: 16px;
  color: #909399;
}
.value.danger {
  color: #f56c6c;
}
</style>
