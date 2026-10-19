<template>
  <div v-loading="loading">
    <div class="page-card head">
      <div class="head-main">
        <div>
          <h3 class="page-title">{{ partner.name || '-' }}</h3>
          <p class="page-sub">
            信用代码：{{ partner.credit_code || '-' }} · 法定代表人：{{ partner.legal_person || '-' }}
            · 工商状态：{{ partner.reg_status || '-' }}
            <el-tag size="small" :type="sourceTagType(partner.data_source)" class="ml8">
              {{ sourceLabel(partner.data_source) }}
            </el-tag>
          </p>
        </div>
        <div class="head-actions">
          <el-button @click="$router.back()">返回</el-button>
          <el-button
            v-if="auth.hasPerm('customer:manage')"
            :loading="collecting"
            @click="handleCollect"
          >
            触发采集
          </el-button>
          <el-button
            v-if="auth.hasPerm('customer:manage')"
            type="warning"
            plain
            :loading="aiCollecting"
            @click="handleAiCollect"
          >
            AI 检索
          </el-button>
          <el-button
            v-if="auth.hasPerm('report:view')"
            type="primary"
            :loading="rating"
            @click="handleRate"
          >
            重算评分
          </el-button>
        </div>
      </div>
    </div>

    <el-alert
      v-if="aiNote"
      type="warning"
      :closable="true"
      show-icon
      class="mb12"
      title="AI 检索结果说明"
      :description="aiNote"
    />

    <div class="score-row">
      <div class="page-card score-card">
        <div class="score-label">信用评分</div>
        <div class="score-value" :class="scoreClass">{{ ratingData ? ratingData.score : '-' }}</div>
        <div class="score-meta">
          <el-tag v-if="ratingData" :type="gradeTagType(ratingData.grade)" effect="dark">
            {{ ratingData.grade }}
          </el-tag>
          <el-tag v-if="ratingData" :type="riskTagType(ratingData.riskLevel)">
            风险 {{ ratingData.riskLevel }}
          </el-tag>
          <el-tag v-if="ratingData?.veto" type="danger" effect="dark">一票否决</el-tag>
          <el-tag v-if="!ratingData" type="info">未评分</el-tag>
        </div>
        <div class="score-foot">
          <span v-if="ratingData">模型 {{ ratingData.calcVersion }} · {{ ratingData.calculatedAt }}</span>
          <span v-else>点击「重算评分」生成</span>
        </div>
      </div>

      <div class="page-card reasons-card">
        <div class="reasons-title">评分明细（可解释）</div>
        <el-empty v-if="!ratingData?.reasons?.length" description="无扣分项" :image-size="60" />
        <el-table v-else :data="ratingData.reasons" size="small" border>
          <el-table-column prop="category" label="维度" width="90" />
          <el-table-column prop="reason" label="说明" min-width="240" />
          <el-table-column label="变化" width="90" align="right">
            <template #default="{ row }">
              <span :class="deltaClass(row.delta)">
                {{ row.delta > 0 ? '+' : '' }}{{ row.delta }}
              </span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <div class="page-card">
      <el-tabs v-model="tab">
        <el-tab-pane label="司法信息" name="judicial">
          <div class="toolbar">
            <el-button v-if="auth.hasPerm('customer:manage')" type="primary" size="small" @click="openDim('judicial')">
              新增司法记录
            </el-button>
            <span class="hint">手工录入的数据即为本系统司法风险依据，保存后自动重算评分。</span>
          </div>
          <el-table :data="judicial" border size="small">
            <el-table-column prop="case_type" label="案件类型" width="120" />
            <el-table-column prop="party_role" label="当事人角色" width="110" />
            <el-table-column prop="case_no" label="案号" min-width="160" />
            <el-table-column prop="court" label="法院" min-width="140" />
            <el-table-column prop="amount" label="标的(元)" width="120" align="right" />
            <el-table-column prop="status" label="状态" width="90" />
            <el-table-column prop="date" label="日期" width="120" />
            <el-table-column label="来源" width="100">
              <template #default="{ row }">
                <el-tag size="small" :type="sourceTagType(row.data_source)">{{ sourceLabel(row.data_source) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column v-if="auth.hasPerm('customer:manage')" label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openDim('judicial', row)">编辑</el-button>
                <el-button link type="danger" @click="removeDim('judicial', row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="信用/合规" name="credit">
          <div class="toolbar">
            <el-button v-if="auth.hasPerm('customer:manage')" type="primary" size="small" @click="openDim('credit')">
              新增合规记录
            </el-button>
            <span class="hint">支持行政处罚、经营异常、严重违法失信、税收违法等类型。</span>
          </div>
          <el-table :data="credit" border size="small">
            <el-table-column prop="item_type" label="类型" width="130" />
            <el-table-column prop="authority" label="机关" min-width="140" />
            <el-table-column prop="reason" label="原因" min-width="200" />
            <el-table-column prop="penalty" label="处罚内容" min-width="140" />
            <el-table-column prop="date" label="日期" width="120" />
            <el-table-column label="来源" width="100">
              <template #default="{ row }">
                <el-tag size="small" :type="sourceTagType(row.data_source)">{{ sourceLabel(row.data_source) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column v-if="auth.hasPerm('customer:manage')" label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openDim('credit', row)">编辑</el-button>
                <el-button link type="danger" @click="removeDim('credit', row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="财务线索" name="finance">
          <div class="toolbar">
            <el-button v-if="auth.hasPerm('customer:manage')" type="primary" size="small" @click="openDim('finance')">
              新增财务线索
            </el-button>
            <span class="hint">规模标签（小微/个体等）参与评分，其余字段仅作报告展示。</span>
          </div>
          <el-table :data="finance" border size="small">
            <el-table-column prop="src" label="来源" width="140" />
            <el-table-column prop="scale_tag" label="规模标签" width="130" />
            <el-table-column prop="rev_yoy" label="营收同比" width="110" align="right" />
            <el-table-column prop="profit" label="利润" width="130" align="right" />
            <el-table-column prop="employee_cnt" label="员工数" width="100" align="right" />
            <el-table-column label="来源" width="100">
              <template #default="{ row }">
                <el-tag size="small" :type="sourceTagType(row.data_source)">{{ sourceLabel(row.data_source) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column v-if="auth.hasPerm('customer:manage')" label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openDim('finance', row)">编辑</el-button>
                <el-button link type="danger" @click="removeDim('finance', row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="评分历史" name="history">
          <el-table :data="history" border size="small">
            <el-table-column prop="calculatedAt" label="计算时间" width="170" />
            <el-table-column prop="score" label="分数" width="80" align="right" />
            <el-table-column prop="grade" label="等级" width="80" />
            <el-table-column prop="riskLevel" label="风险" width="80" />
            <el-table-column prop="calcVersion" label="模型版本" width="100" />
            <el-table-column label="否决" width="80">
              <template #default="{ row }">{{ row.veto ? '是' : '否' }}</template>
            </el-table-column>
            <el-table-column label="扣分项" min-width="220">
              <template #default="{ row }">
                {{ (row.reasons || []).map((r) => `${r.reason}(${r.delta})`).join('；') || '-' }}
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- AI 检索进度：检索 + 大模型抽取通常 1~3 分钟，必须让用户看到"还在跑" -->
    <el-dialog
      :model-value="!!aiJob"
      title="AI 检索进行中"
      width="480px"
      align-center
      :show-close="false"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <div class="ai-job">
        <el-progress
          :percentage="Math.round(aiJob?.progress || 0)"
          :stroke-width="16"
          :text-inside="true"
          striped
          striped-flow
        />
        <div class="ai-job-step">{{ aiJob?.step || '准备中' }}</div>
        <div class="ai-job-meta">
          已耗时 {{ Math.floor((aiJob?.elapsedMs || 0) / 1000) }} 秒 ·
          检索包含联网搜索与大模型抽取，请勿关闭或刷新页面
        </div>
      </div>
    </el-dialog>

    <!-- 手工录入：司法 / 信用 / 财务 -->
    <el-dialog v-model="dimDialog" :title="dimTitle" width="560px">
      <el-form :model="dimForm" label-width="100px">
        <el-form-item v-for="f in dimFields" :key="f.key" :label="f.label" :required="f.required">
          <el-select v-if="f.type === 'select'" v-model="dimForm[f.key]" style="width: 100%" clearable>
            <el-option v-for="o in f.options" :key="o" :label="o" :value="o" />
          </el-select>
          <el-input-number
            v-else-if="f.type === 'number'"
            v-model="dimForm[f.key]"
            style="width: 100%"
            :min="0"
            :precision="2"
            :controls="false"
          />
          <el-date-picker
            v-else-if="f.type === 'date'"
            v-model="dimForm[f.key]"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
          <el-input v-else v-model="dimForm[f.key]" :maxlength="f.maxLength || 120" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dimDialog = false">取消</el-button>
        <el-button type="primary" :loading="dimSaving" @click="saveDim">保存并重算</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { ElMessage } from '../utils/feedback.js';
import { partnerApi, aiApi } from '../api/index.js';
import { useAuthStore } from '../stores/auth.js';
import { gradeTagType, riskTagType, deltaClass, sourceLabel, sourceTagType } from '../utils/grade.js';

const route = useRoute();
const auth = useAuthStore();
const id = Number(route.params.id);

const loading = ref(false);
const collecting = ref(false);
const aiCollecting = ref(false);
const aiNote = ref('');
// AI 检索进度：{ progress, step, elapsedMs }，null 表示无进行中任务
const aiJob = ref(null);
let aiPollTimer = null;
const rating = ref(false);
const tab = ref('judicial');

const partner = ref({});
const ratingData = ref(null);
const history = ref([]);
const judicial = ref([]);
const credit = ref([]);
const finance = ref([]);

// 手工录入字段定义（与后端维度表字段一一对应）
const DIM_FIELD_DEFS = {
  judicial: [
    { key: 'caseType', label: '案件类型', type: 'select', required: true, options: ['失信被执行人', '执行案件', '民事裁判', '破产', '限制高消费'] },
    { key: 'partyRole', label: '当事人角色', type: 'select', options: ['被告', '原告', '被执行人'] },
    { key: 'caseNo', label: '案号', required: true },
    { key: 'court', label: '法院' },
    { key: 'amount', label: '标的(元)', type: 'number' },
    { key: 'status', label: '状态', type: 'select', options: ['未结', '已结', '执行中'] },
    { key: 'date', label: '日期', type: 'date' },
  ],
  credit: [
    { key: 'itemType', label: '类型', type: 'select', required: true, options: ['行政处罚', '经营异常', '严重违法失信', '税收违法'] },
    { key: 'authority', label: '作出机关' },
    { key: 'reason', label: '原因' },
    { key: 'penalty', label: '处罚内容' },
    { key: 'date', label: '日期', type: 'date' },
  ],
  finance: [
    { key: 'src', label: '数据来源' },
    { key: 'scaleTag', label: '规模标签', type: 'select', options: ['大型', '中型', '小型', '微型', '小微企业', '个体工商户'] },
    { key: 'revYoy', label: '营收同比' },
    { key: 'profit', label: '利润' },
    { key: 'employeeCnt', label: '员工数', type: 'number' },
    { key: 'bidCnt', label: '招投标数', type: 'number' },
  ],
};

const DIM_LABELS = { judicial: '司法记录', credit: '合规记录', finance: '财务线索' };
const DIM_ROW_MAP = {
  judicial: { caseType: 'case_type', partyRole: 'party_role', caseNo: 'case_no', court: 'court', amount: 'amount', status: 'status', date: 'date' },
  credit: { itemType: 'item_type', authority: 'authority', reason: 'reason', penalty: 'penalty', date: 'date' },
  finance: { src: 'src', revYoy: 'rev_yoy', profit: 'profit', scaleTag: 'scale_tag', employeeCnt: 'employee_cnt', bidCnt: 'bid_cnt' },
};

const dimDialog = ref(false);
const dimKind = ref('judicial');
const dimSaving = ref(false);
const dimForm = reactive({ id: null });

const dimFields = computed(() => DIM_FIELD_DEFS[dimKind.value] || []);
const dimTitle = computed(() => `${dimForm.id ? '编辑' : '新增'}${DIM_LABELS[dimKind.value]}`);

function openDim(kind, row = null) {
  dimKind.value = kind;
  for (const k of Object.keys(dimForm)) delete dimForm[k];
  dimForm.id = row?.id || null;
  for (const f of DIM_FIELD_DEFS[kind]) {
    const col = DIM_ROW_MAP[kind][f.key];
    dimForm[f.key] = row ? row[col] ?? (f.type === 'number' ? null : '') : f.type === 'number' ? null : '';
  }
  dimDialog.value = true;
}

async function saveDim() {
  for (const f of dimFields.value) {
    if (f.required && !dimForm[f.key]) return ElMessage.warning(`请填写${f.label}`);
  }
  const payload = {};
  for (const f of dimFields.value) payload[f.key] = dimForm[f.key];
  dimSaving.value = true;
  try {
    const res = dimForm.id
      ? await partnerApi.updateDim(id, dimKind.value, dimForm.id, payload)
      : await partnerApi.createDim(id, dimKind.value, payload);
    dimDialog.value = false;
    const s = res?.scored;
    ElMessage.success(s ? `已保存，评分已重算：${s.score} 分 / ${s.grade}` : '已保存');
    await loadAll();
  } finally {
    dimSaving.value = false;
  }
}

async function removeDim(kind, row) {
  await ElMessageBox.confirm(`确认删除这条${DIM_LABELS[kind]}？删除后评分将按剩余数据重算。`, '删除确认', {
    type: 'warning',
  });
  const res = await partnerApi.removeDim(id, kind, row.id);
  const s = res?.scored;
  ElMessage.success(s ? `已删除，评分已重算：${s.score} 分 / ${s.grade}` : '已删除');
  await loadAll();
}

const scoreClass = computed(() => {
  const s = ratingData.value?.score;
  if (s === undefined || s === null) return '';
  if (s >= 85) return 'good';
  if (s >= 55) return 'mid';
  return 'bad';
});

async function loadAll() {
  loading.value = true;
  try {
    const [p, j, c, f, h] = await Promise.all([
      partnerApi.detail(id),
      partnerApi.judicial(id),
      partnerApi.credit(id),
      partnerApi.finance(id),
      partnerApi.ratingHistory(id, 20),
    ]);
    partner.value = p || {};
    judicial.value = j || [];
    credit.value = c || [];
    finance.value = f || [];
    history.value = h || [];
    try {
      ratingData.value = await partnerApi.rating(id);
    } catch {
      ratingData.value = null;
    }
  } finally {
    loading.value = false;
  }
}

async function handleRate() {
  rating.value = true;
  try {
    const res = await partnerApi.rate(id);
    ElMessage.success(`评分完成：${res.score} 分 / ${res.grade}`);
    await loadAll();
  } finally {
    rating.value = false;
  }
}

async function handleCollect() {
  collecting.value = true;
  try {
    const res = await partnerApi.collect(id);
    // 只列「实际参与本次采集」的渠道；未启用的（如没配 Key 的企查查）属于预期不参与，
    // 不应出现在报错提示里，否则会把用户吓成"系统坏了"
    const active = (res?.tasks || []).filter((t) => t.status !== 'skipped');
    const items = active.map((t) => {
      const label = t.channelLabel || t.channel;
      if (t.status === 'ok') {
        const filled = t.basicFilled?.length ? `，回填 ${t.basicFilled.length} 个字段` : '';
        return `${label}：成功${filled}`;
      }
      const detail = String(t.err || t.hint || '').trim();
      return `${label}：${t.reasonLabel || t.status}${detail ? ` — ${detail}` : ''}`;
    });
    if (!items.length) {
      items.push('没有启用的采集渠道，请先在「系统设置 → 数据渠道」中启用并填写 API Key');
    }
    const opts = { items, advice: res?.advice };
    if (res?.okCount > 0 && !res?.failed) ElMessage.success({ title: '采集完成', ...opts });
    else if (res?.okCount > 0) ElMessage.warning({ title: '采集部分成功', ...opts });
    else if (res?.failed > 0) ElMessage.error({ title: '采集失败', ...opts });
    else ElMessage.warning({ title: '未取到数据', ...opts });
    await loadAll();
  } finally {
    collecting.value = false;
  }
}

// 轮询异步任务的进度；返回最后一次任务结果
function waitAiJob(jobId) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const j = await aiApi.collectJob(jobId);
        // 服务端进度只在步骤切换时跳变；这里做小幅追赶（最多超出服务端 6 个点），
        // 既不让进度条长时间僵住像"死掉"，也不会虚报成快完成
        const prev = aiJob.value?.progress || 0;
        const shown = Math.max(j.progress, Math.min(j.progress + 6, prev + 0.6));
        aiJob.value = {
          progress: j.status === 'done' ? 100 : shown,
          step: j.step,
          elapsedMs: j.elapsedMs,
        };
        if (j.status === 'done') return resolve(j.result);
        if (j.status === 'error') {
          const err = new Error(j.error || 'AI 检索失败');
          err.fromJob = true;
          return reject(err);
        }
        aiPollTimer = setTimeout(tick, 800);
      } catch (e) {
        reject(e);
      }
    };
    tick();
  });
}

async function handleAiCollect() {
  aiCollecting.value = true;
  aiNote.value = '';
  aiJob.value = { progress: 0, step: '提交任务…', elapsedMs: 0 };
  try {
    const started = await aiApi.startCollect(id);
    const res = await waitAiJob(started.jobId);
    const a = res.added || {};
    const s = res.scored;
    const items = [
      `司法记录：新增 ${a.judicial || 0} 条`,
      `合规记录：新增 ${a.credit || 0} 条`,
      `财务记录：新增 ${a.finance || 0} 条`,
    ];
    if (a.noCaseNo) items.push(`已忽略无案号的司法记录：${a.noCaseNo} 条（司法记录必须有案号）`);
    if (a.skipped) items.push(`去重跳过：${a.skipped} 条`);
    if (s) items.push(`重新评分：${s.score} 分 / ${s.grade}`);
    const searchNote = res.meta?.search?.configured
      ? `已联网检索 ${res.meta.search.count} 条资料`
      : '未配置搜索 Key，本次未联网，仅为模型知识推断，可能存在缺漏';
    items.push(searchNote);
    aiNote.value = `${res.disclaimer}（${searchNote}；所有 AI 记录来源标记为「AI 推断」，请核验）`;
    ElMessage.success({ title: 'AI 检索完成', items, advice: '所有 AI 推断记录均需人工核验后再采用' });
    await loadAll();
  } catch (e) {
    // HTTP 层错误已由请求拦截器弹过提示，这里只处理"任务本身执行失败"
    if (e?.fromJob) ElMessage.error({ title: 'AI 检索失败', items: [String(e.message || e)] });
  } finally {
    aiCollecting.value = false;
    aiJob.value = null;
    if (aiPollTimer) {
      clearTimeout(aiPollTimer);
      aiPollTimer = null;
    }
  }
}

onMounted(loadAll);

onUnmounted(() => {
  if (aiPollTimer) clearTimeout(aiPollTimer);
});
</script>

<style scoped>
.head {
  margin-bottom: 12px;
}
.head-main {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.head-actions {
  display: flex;
  gap: 8px;
}
.score-row {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.score-card {
  width: 260px;
  text-align: center;
}
.score-label {
  color: #909399;
  font-size: 13px;
}
.score-value {
  font-size: 56px;
  font-weight: 700;
  line-height: 1.1;
  margin: 6px 0;
}
.score-value.good {
  color: #67c23a;
}
.score-value.mid {
  color: #e6a23c;
}
.score-value.bad {
  color: #f56c6c;
}
.score-meta {
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}
.score-foot {
  margin-top: 10px;
  color: #909399;
  font-size: 12px;
}
.reasons-card {
  flex: 1;
  min-width: 320px;
}
.reasons-title {
  font-weight: 600;
  margin-bottom: 10px;
}
.ml8 {
  margin-left: 8px;
}
.hint {
  color: #909399;
  font-size: 13px;
  margin-left: auto;
}
.mb12 {
  margin-bottom: 12px;
}
:deep(.delta-minus) {
  color: #f56c6c;
  font-weight: 600;
}
:deep(.delta-plus) {
  color: #67c23a;
  font-weight: 600;
}
:deep(.delta-zero) {
  color: #909399;
}

/* AI 检索进度弹窗 */
.ai-job {
  padding: 6px 4px 2px;
  text-align: center;
}
.ai-job-step {
  margin-top: 14px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.ai-job-meta {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: #909399;
}
</style>
