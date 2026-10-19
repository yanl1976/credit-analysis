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
          <el-button-group class="nav-group">
            <el-button :disabled="!neighbors.prev" title="上一条（客户列表中更靠前）" @click="goNeighbor('prev')">
              ↑ 上一条
            </el-button>
            <el-button :disabled="!neighbors.next" title="下一条（客户列表中更靠后）" @click="goNeighbor('next')">
              下一条 ↓
            </el-button>
          </el-button-group>
          <span v-if="neighbors.total" class="nav-pos">{{ neighbors.index }} / {{ neighbors.total }}</span>
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
        <el-tab-pane label="企业画像" name="profile">
          <div class="toolbar">
            <el-button
              v-if="auth.hasPerm('customer:manage')"
              type="primary"
              size="small"
              :loading="tycLoading"
              @click="syncTyc"
            >
              同步企业画像
            </el-button>
            <el-button
              v-if="auth.hasPerm('customer:manage')"
              size="small"
              :loading="tycResyncLoading"
              @click="resyncTyc"
            >
              重解析已同步数据
            </el-button>
            <el-checkbox v-model="tycForce" :disabled="tycLoading" size="small" style="margin-right: 8px">
              强制重新调用
            </el-checkbox>
            <span class="hint">
              基础画像 4 项（工商登记/简介/风险总览/创新力评分）+ 风险明细 11 项（失信/限高/被执行/裁判文书/经营异常/严重违法/行政处罚/税收违法/欠税公告/财务数据/企业规模）；
              明细需 VIP 权益。同步默认节流：{{ tyc?.toolPolicy?.cacheHours ?? 24 }} 小时内已取过的工具直接复用缓存，
              已知无权限的工具不再重复调用，额度用尽自动切换下一个账号；勾选「强制重新调用」可忽略缓存与权限记忆（套餐升级后补齐数据用）。
            </span>
            <span v-if="tyc && tyc.syncedAt" class="tyc-sync-time">最后同步 {{ tyc.syncedAt }}</span>
          </div>
          <div v-if="tyc && tyc.dimensions" class="hint" style="margin-bottom: 8px">
            已落库天眼AI 明细：司法 {{ tyc.dimensions.judicial }} 条 · 合规 {{ tyc.dimensions.credit }} 条 · 财务 {{ tyc.dimensions.finance }} 条
            <span style="margin-left: 6px">（明细直接参与评分，「重解析已同步数据」不会再次调用天眼AI）</span>
          </div>
          <div v-if="tyc && tyc.toolPolicy?.accounts" class="hint" style="margin-bottom: 8px">
            天眼AI 账号池：已配置 {{ tyc.toolPolicy.accounts }} 个账号，今日可用 {{ tyc.toolPolicy.availableAccounts }} 个；某个账号额度用尽或未开通某工具时自动切换到下一个。
            <span v-if="tyc.toolPolicy.invalidAccounts?.length" style="color: #f56c6c; margin-left: 6px">
              其中 {{ tyc.toolPolicy.invalidAccounts.length }} 个账号 key 无效/连不上（第
              {{ tyc.toolPolicy.invalidAccounts.map((a) => a.index).join('、') }} 个），请检查 .env 的 TIANYANCHA_MCP_TOKENS。
            </span>
          </div>
          <el-alert
            v-if="tyc && tyc.toolPolicy?.quotaExhaustedToday"
            type="error"
            :closable="false"
            show-icon
            style="margin-bottom: 8px"
            :title="`今日 ${tyc.toolPolicy.accounts} 个天眼AI 账号的额度均已用尽：同步会直接跳过全部工具，等次日配额重置或升级套餐后再同步。`"
          />
          <el-alert
            v-if="tyc && tyc.toolPolicy?.denied?.length"
            type="warning"
            :closable="false"
            show-icon
            style="margin-bottom: 8px"
          >
            <template #title>
              有 {{ tyc.toolPolicy.denied.length }} 项工具因账号权益未开通被跳过，同步时不再重复调用（也不占用额度）
            </template>
            <div class="tyc-denied-list">{{ tycDeniedText }}</div>
            <div class="hint">
              升级 VIP/SVIP 后可勾选「强制重新调用」立即补齐；否则 {{ tyc.toolPolicy.deniedTtlDays }} 天后会自动重试探测。
            </div>
          </el-alert>

          <el-empty
            v-if="!tyc || !tyc.syncedAt"
            :description="tyc && !tyc.configured ? '未配置天眼AI 访问令牌（TIANYANCHA_MCP_TOKEN / TIANYANCHA_MCP_TOKENS）' : '尚未同步企业画像数据'"
          />

          <template v-else>
            <div class="tyc-hero">
              <div class="tyc-hero-main">
                <span class="tyc-name">{{ tyc.registration?.name || partner.name }}</span>
                <el-tag size="small" type="success" effect="plain">{{ tyc.registration?.regStatus || '-' }}</el-tag>
                <el-tag
                  v-for="t in tyc.registration?.tags || []"
                  :key="t"
                  size="small"
                  effect="plain"
                  class="tyc-tag"
                >
                  {{ t }}
                </el-tag>
              </div>
              <div class="tyc-hero-sub">
                信用代码 {{ tyc.registration?.creditCode || '-' }} ·
                法定代表人 {{ tyc.registration?.legalPersonName || '-' }} ·
                注册资本 {{ tyc.registration?.regCapital || '-' }}
              </div>
            </div>

            <el-descriptions v-if="tyc.registration" :column="3" border size="small" class="tyc-desc">
              <el-descriptions-item label="实缴资本">{{ tyc.registration.actualCapital || '-' }}</el-descriptions-item>
              <el-descriptions-item label="成立日期">{{ (tyc.registration.estiblishTime || '').slice(0, 10) || '-' }}</el-descriptions-item>
              <el-descriptions-item label="核准日期">{{ (tyc.registration.approvedTime || '').slice(0, 10) || '-' }}</el-descriptions-item>
              <el-descriptions-item label="参保人数">{{ tyc.registration.socialStaffNum ?? '-' }}</el-descriptions-item>
              <el-descriptions-item label="人员规模">{{ tyc.registration.staffNumRange || '-' }}</el-descriptions-item>
              <el-descriptions-item label="企业类型">{{ tyc.registration.companyOrgType || '-' }}</el-descriptions-item>
              <el-descriptions-item label="所属行业">
                {{ tyc.registration.industrySmall || tyc.registration.industry || '-' }}
              </el-descriptions-item>
              <el-descriptions-item label="登记机关">{{ tyc.registration.regInstitute || '-' }}</el-descriptions-item>
              <el-descriptions-item label="曾用名">{{ (tyc.registration.historyNames || []).join('、') || '-' }}</el-descriptions-item>
              <el-descriptions-item label="注册地址" :span="3">{{ tyc.registration.regLocation || '-' }}</el-descriptions-item>
              <el-descriptions-item label="经营范围" :span="3">{{ tyc.registration.businessScope || '-' }}</el-descriptions-item>
            </el-descriptions>

            <el-row :gutter="16" class="tyc-row">
              <el-col :xs="24" :md="14">
                <div v-if="tyc.profile" class="tyc-block">
                  <div class="tyc-title">企业简介</div>
                  <p class="tyc-text">{{ tyc.profile }}</p>
                </div>
              </el-col>
              <el-col :xs="24" :md="10">
                <div v-if="tyc.iprScore" class="tyc-block">
                  <div class="tyc-title">创新力评分</div>
                  <div class="tyc-kpis">
                    <div class="tyc-kpi">
                      <div class="tyc-kpi-value">{{ tyc.iprScore.scienceAndTechnologyScore ?? '-' }}</div>
                      <div class="tyc-kpi-label">科技评分</div>
                    </div>
                    <div class="tyc-kpi">
                      <div class="tyc-kpi-value">{{ tyc.iprScore.scoreRank || '-' }}</div>
                      <div class="tyc-kpi-label">行业排名</div>
                    </div>
                    <div class="tyc-kpi">
                      <div class="tyc-kpi-value">{{ tyc.iprScore.scienceAndTechnologyGrade || '-' }}</div>
                      <div class="tyc-kpi-label">科技评级</div>
                    </div>
                  </div>
                  <div class="tyc-kpi-sub">
                    发明授权 {{ tyc.iprScore.inventionLicensingCount ?? '-' }} · 实用新型 {{ tyc.iprScore.utilityModelCount ?? '-' }} ·
                    发明公开 {{ tyc.iprScore.inventionAnnouncementCount ?? '-' }} · 软著 {{ tyc.iprScore.softwareCopyrightCount ?? '-' }}
                  </div>
                </div>
              </el-col>
            </el-row>

            <div class="tyc-block tyc-section">
              <div class="tyc-title">
                风险明细
                <span class="tyc-sub">仅统计天眼AI 已落库明细，已直接参与评分</span>
              </div>
              <div class="tyc-risk-grid">
                <div
                  v-for="d in tycRisk.items"
                  :key="d.key"
                  class="tyc-risk-item"
                  :class="{
                    'is-zero': !d.count,
                    'is-veto': ['dishonest', 'limit', 'bankrupt'].includes(d.key) && d.count > 0,
                  }"
                >
                  <div class="tyc-risk-top">
                    <span class="tyc-risk-label">{{ d.label }}</span>
                    <span class="tyc-risk-count">{{ d.count }}</span>
                  </div>
                  <div class="tyc-risk-meta">
                    <template v-if="d.key === 'executed' && d.amount">合计 {{ fmtWan(d.amount) }}</template>
                    <template v-else-if="d.lastDate">{{ d.lastDate }}</template>
                    <template v-else>-</template>
                  </div>
                  <div class="tyc-risk-note">{{ d.note }}</div>
                </div>
              </div>
              <div class="hint" style="margin-top: 8px">
                司法 {{ tycRisk.judicialTotal }} 条 · 合规 {{ tycRisk.creditTotal }} 条；手工录入与其他渠道的记录请到「司法信息」「信用/合规」页签查看。
                <span v-if="!tycRisk.hasData">
                  当前 0 条：若只同步过基础画像（4 项），需重新点「同步企业画像」才会拉取 11 项风险明细；
                  若已同步仍为 0，则是工具权益未开通、今日调用额度已用尽，或该企业确无公开记录（同步结果的提示里会写明是哪一种）。
                </span>
              </div>
            </div>

            <div v-if="tycFiscal.hasScale || tycFiscal.hasFiscal" class="tyc-block tyc-section">
              <div class="tyc-title">
                财务与规模
                <span class="tyc-sub">来自天眼AI，只展示识别到的科目；未识别则不参与财务评分</span>
              </div>
              <div class="tyc-kpis tyc-kpis-4">
                <div class="tyc-kpi">
                  <div class="tyc-kpi-value">{{ tycFiscal.scaleTag || '-' }}</div>
                  <div class="tyc-kpi-label">企业规模</div>
                </div>
                <div class="tyc-kpi">
                  <div class="tyc-kpi-value">{{ tycFiscal.employeeCnt ?? '-' }}</div>
                  <div class="tyc-kpi-label">参保/员工数</div>
                </div>
                <div class="tyc-kpi">
                  <div class="tyc-kpi-value">{{ fmtPct(tycFiscal.metrics?.debtRatio) || '-' }}</div>
                  <div class="tyc-kpi-label">资产负债率</div>
                </div>
                <div class="tyc-kpi">
                  <div class="tyc-kpi-value">{{ fmtX(tycFiscal.metrics?.currentRatio) || '-' }}</div>
                  <div class="tyc-kpi-label">流动比率</div>
                </div>
              </div>
              <div class="tyc-kpi-sub">
                报告期 {{ tycFiscal.period || '-' }}
                <template v-if="tycFiscal.metrics">
                  · 利息保障 {{ fmtX(tycFiscal.metrics.interestCover) || '-' }}
                  · 有息负债/净资产 {{ fmtX(tycFiscal.metrics.debtToEquity) || '-' }}
                  · 经营现金流 {{ fmtWan(tycFiscal.metrics.ocf) || '-' }}
                </template>
                <template v-else>
                  · 未识别到「资产总计 + 负债合计」等科目，已保存原始报文但不参与财务评分（避免猜测）
                </template>
              </div>
            </div>

            <div v-if="tyc.riskOverview" class="tyc-block tyc-section">
              <div class="tyc-title">
                风险总览
                <span class="tyc-sub">聚合计数，非事件总数；不跨类别相加</span>
              </div>
              <el-table :data="tyc.riskOverview.groups" border size="small">
                <el-table-column prop="name" label="风险类别" width="120" />
                <el-table-column prop="count" label="上游计数" width="96" align="right" />
                <el-table-column label="构成明细" min-width="360">
                  <template #default="{ row }">
                    <el-tag
                      v-for="i in row.items"
                      :key="i.name"
                      size="small"
                      :type="row.name.includes('自身') ? 'danger' : 'info'"
                      effect="plain"
                      class="tyc-tag"
                    >
                      {{ i.name }} {{ i.total }}
                    </el-tag>
                    <span v-if="!row.items.length" class="hint">无记录</span>
                  </template>
                </el-table-column>
              </el-table>
              <div class="hint" style="margin-top: 6px">
                自身风险为本企业记录，参与评分；周边风险与历史风险属关联方与既往，仅供参考，不计入本企业评分。
                上方逐条明细已落库时以明细为准，聚合计数仅在明细不足时补足，避免重复扣分。
              </div>
            </div>
          </template>
        </el-tab-pane>

        <el-tab-pane label="司法信息" name="judicial">
          <div class="toolbar">
            <el-button v-if="auth.hasPerm('customer:manage')" type="primary" size="small" @click="openDim('judicial')">
              新增司法记录
            </el-button>
            <span class="hint">手工录入的数据即为本系统司法风险依据，保存后自动重算评分。</span>
          </div>
          <el-table :data="judicial" border size="small" empty-text="暂无司法记录（天眼AI 明细需先「同步企业画像」）">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="detail-box">
                  <div class="detail-meta">
                    采集工具：{{ toolLabel(row._detail?.tool) }}
                    <span v-if="!row._detail" class="hint">该记录无原始报文（手工录入或历史数据）</span>
                  </div>
                  <pre v-if="row._detail" class="detail-json">{{ prettyJson(row._detail) }}</pre>
                </div>
              </template>
            </el-table-column>
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
          <el-table :data="credit" border size="small" empty-text="暂无合规记录（天眼AI 明细需先「同步企业画像」）">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="detail-box">
                  <div class="detail-meta">
                    采集工具：{{ toolLabel(row._detail?.tool) }}
                    <span v-if="!row._detail" class="hint">该记录无原始报文（手工录入或历史数据）</span>
                  </div>
                  <pre v-if="row._detail" class="detail-json">{{ prettyJson(row._detail) }}</pre>
                </div>
              </template>
            </el-table-column>
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
            <template v-if="auth.hasPerm('customer:manage')">
              <el-input v-model="emStockCode" size="small" placeholder="股票代码，如 600192" style="width: 170px" />
              <el-select v-model="emListedStatus" size="small" style="width: 130px">
                <el-option label="母公司上市" value="母公司上市" />
                <el-option label="本公司上市" value="本公司上市" />
              </el-select>
              <el-button type="success" size="small" :loading="emLoading" @click="fetchEastmoneyFinance">
                从东方财富获取财报
              </el-button>
            </template>
            <span class="hint">
              上市公司/上市子公司直接填股票代码，从东方财富取真实财报（营收、归母净利、同比）；取不到就报错，不会用推测值顶替。
            </span>
          </div>
          <el-table :data="finance" border size="small" empty-text="暂无财务线索（天眼AI 明细需先「同步企业画像」）">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="detail-box">
                  <template v-if="row._fiscal">
                    <div v-for="g in row._fiscal.groups" :key="g.name" class="fiscal-group">
                      <div class="fiscal-title">{{ g.name }}</div>
                      <div class="fiscal-grid">
                        <div v-for="it in g.items" :key="it.label" class="fiscal-item">
                          <span class="fiscal-label">{{ it.label }}</span>
                          <span class="fiscal-value">{{ it.value }}</span>
                        </div>
                      </div>
                    </div>
                    <div v-if="row._fiscal.ratios" class="fiscal-ratio">推导指标：{{ row._fiscal.ratios }}</div>
                  </template>
                  <div class="detail-meta">
                    采集工具：{{ toolLabel(row._detail?.tool) }}
                    <span v-if="!row._detail" class="hint">该记录无原始报文（手工录入或历史数据）</span>
                  </div>
                  <pre v-if="row._detail" class="detail-json">{{ prettyJson(row._detail) }}</pre>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="src" label="数据来源" min-width="140" show-overflow-tooltip />
            <el-table-column prop="stock_code" label="股票代码" width="100" />
            <el-table-column prop="report_period" label="报告期" width="110" />
            <el-table-column prop="listed_status" label="上市关系" width="110" />
            <el-table-column prop="scale_tag" label="规模标签" width="130" />
            <el-table-column prop="rev_yoy" label="营收同比" width="110" align="right" />
            <el-table-column prop="profit" label="利润" width="130" align="right" />
            <el-table-column prop="employee_cnt" label="员工数" width="100" align="right" />
            <el-table-column label="偿债指标" width="170" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row._fiscal?.summary">{{ row._fiscal.summary }}</span>
                <span v-else class="hint">-</span>
              </template>
            </el-table-column>
            <el-table-column label="录入方式" width="100">
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
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { ElMessage } from '../utils/feedback.js';
import { partnerApi, aiApi } from '../api/index.js';
import { useAuthStore } from '../stores/auth.js';
import { gradeTagType, riskTagType, deltaClass, sourceLabel, sourceTagType } from '../utils/grade.js';
import {
  summarizeTycRisk,
  parseTycFiscal,
  parseDetail,
  prettyJson,
  toolLabel,
  fiscalView,
  fmtWan,
  fmtPct,
  fmtX,
} from '../utils/tyc-summary.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const id = Number(route.params.id);

// 上下换页：沿用客户列表顺序（id DESC），检索词随列表带入，避免切换后跳出筛选范围
const neighbors = reactive({ prev: null, next: null, index: 0, total: 0 });

async function loadNeighbors() {
  try {
    const keyword = route.query.keyword ? String(route.query.keyword) : undefined;
    Object.assign(neighbors, await partnerApi.neighbors(id, keyword));
  } catch {
    Object.assign(neighbors, { prev: null, next: null, index: 0, total: 0 });
  }
}

function goNeighbor(dir) {
  const target = dir === 'prev' ? neighbors.prev : neighbors.next;
  if (!target) return;
  const keyword = route.query.keyword;
  router.push({
    name: 'partner-report',
    params: { id: target.id },
    query: keyword ? { keyword: String(keyword) } : {},
  });
}

const loading = ref(false);
const collecting = ref(false);
const aiCollecting = ref(false);
const aiNote = ref('');
// AI 检索进度：{ progress, step, elapsedMs }，null 表示无进行中任务
const aiJob = ref(null);
let aiPollTimer = null;
const rating = ref(false);
const tab = ref('profile');

const partner = ref({});
const ratingData = ref(null);
const history = ref([]);
const judicial = ref([]);
const credit = ref([]);
const finance = ref([]);
// 天眼AI 画像
const tyc = ref(null);
const tycLoading = ref(false);
const tycResyncLoading = ref(false);
// 忽略缓存与权限记忆，强制全量重调（套餐升级后补齐数据用，会真实消耗额度）
const tycForce = ref(false);
// 东方财富财报同步
const emStockCode = ref('');
const emListedStatus = ref('母公司上市');
const emLoading = ref(false);

// 企业画像内容：只统计 data_source='tyc_mcp' 的明细，避免手工/AI 记录混入天眼AI 口径
const tycRisk = computed(() => summarizeTycRisk(judicial.value, credit.value));
const tycFiscal = computed(() => parseTycFiscal(finance.value));
// 被账号权益挡掉的工具（后端记忆，跨客户共享）：列出名称让用户知道缺了什么
const tycDeniedText = computed(() =>
  (tyc.value?.toolPolicy?.denied || []).map((d) => d.label || d.tool).join('、'),
);

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
    { key: 'stockCode', label: '股票代码' },
    { key: 'reportPeriod', label: '报告期' },
    {
      key: 'listedStatus',
      label: '上市关系',
      type: 'select',
      options: ['本公司上市', '母公司上市', '未上市'],
    },
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
  finance: {
    src: 'src',
    stockCode: 'stock_code',
    reportPeriod: 'report_period',
    listedStatus: 'listed_status',
    revYoy: 'rev_yoy',
    profit: 'profit',
    scaleTag: 'scale_tag',
    employeeCnt: 'employee_cnt',
    bidCnt: 'bid_cnt',
  },
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
    const [p, j, c, f, h, t] = await Promise.all([
      partnerApi.detail(id),
      partnerApi.judicial(id),
      partnerApi.credit(id),
      partnerApi.finance(id),
      partnerApi.ratingHistory(id, 20),
      partnerApi.tycProfile(id).catch(() => null),
    ]);
    partner.value = p || {};
    // _detail：把 detail_json 预先解析好，供展开行溯源；_fiscal：财务行的科目拆解
    judicial.value = (j || []).map((r) => ({ ...r, _detail: parseDetail(r.detail_json) }));
    credit.value = (c || []).map((r) => ({ ...r, _detail: parseDetail(r.detail_json) }));
    finance.value = (f || []).map((r) => {
      const detail = parseDetail(r.detail_json);
      return { ...r, _detail: detail, _fiscal: fiscalView(detail?.fiscal) };
    });
    history.value = h || [];
    tyc.value = t || null;
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

// 同步天眼AI：基础画像 4 项 + P0 风险明细 11 项，后端同步后自动重算评分
// 后端默认节流：缓存命中/已知无权限/额度用尽都会跳过，只有真正需要的工具才发起调用
async function syncTyc() {
  tycLoading.value = true;
  try {
    const res = await partnerApi.tycSync(id, tycForce.value ? { force: true } : null);
    const s = res?.summary || {};
    const ok = s.ok ?? (res?.synced?.length || 0);
    const failed = res?.failed || [];
    const called = s.called ?? ok;
    const denied = failed.filter((f) => f.permissionDenied).length;
    const quota = failed.filter((f) => f.quotaExceeded).length;
    const dim = res?.dimensions || {};
    const skipParts = [
      s.skippedCache ? `已缓存 ${s.skippedCache}` : null,
      s.skippedPermission ? `无权限 ${s.skippedPermission}` : null,
      s.skippedQuota ? `额度用尽 ${s.skippedQuota}` : null,
      s.skippedUnavailable ? `账号不可用 ${s.skippedUnavailable}` : null,
    ].filter(Boolean);

    const parts = [`成功 ${ok} 项`, `发起调用 ${called} 次（成功取数才计入额度）`];
    if (s.accounts > 1) parts.push(`账号池 ${s.availableAccounts}/${s.accounts} 可用`);
    if (skipParts.length) parts.push(`跳过 ${skipParts.join(' / ')} 项`);
    if (failed.length) {
      const reasons = [denied ? `${denied} 项权益未开通（需 VIP）` : null, quota ? `${quota} 项今日额度已用尽` : null]
        .filter(Boolean)
        .join(' / ');
      parts.push(`失败 ${failed.length} 项${reasons ? `（${reasons}）` : ''}`);
    }
    parts.push(`新增/更新明细 司法 ${dim.judicial || 0} / 合规 ${dim.credit || 0} / 财务 ${dim.finance || 0}`);
    const msg = parts.join('，');

    if (failed.length) {
      ElMessage.warning(`${msg}；首个失败：${failed[0].label || failed[0].key} - ${failed[0].message}`);
    } else if (!called) {
      // 一次都没调：全部走缓存或权限跳过，额度零消耗
      ElMessage.info(`${msg}（未消耗调用额度）`);
    } else {
      ElMessage.success(`${msg}，评分已重算`);
    }
    await loadAll();
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e.message || '同步失败');
  } finally {
    tycLoading.value = false;
  }
}

// 只重解析已落库的原始报文，不再请求天眼AI（不消耗调用额度）
async function resyncTyc() {
  tycResyncLoading.value = true;
  try {
    const res = await partnerApi.tycResync(id);
    if (res?.empty) {
      ElMessage.warning(res.hint || '该客户还没有天眼AI 同步记录');
    } else {
      const dim = res?.dimensions || {};
      ElMessage.success(
        `重解析完成：新增明细 司法 ${dim.judicial || 0} / 合规 ${dim.credit || 0} / 财务 ${dim.finance || 0}（未调用天眼AI）`,
      );
    }
    await loadAll();
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e.message || '重解析失败');
  } finally {
    tycResyncLoading.value = false;
  }
}

// 从东方财富按股票代码取真实财报（上市客户 / 上市子公司）
async function fetchEastmoneyFinance() {
  const code = String(emStockCode.value || '').trim();
  if (!/^\d{6}$/.test(code)) return ElMessage.warning('请填写 6 位股票代码（如 600192 长城电工）');
  emLoading.value = true;
  try {
    const res = await partnerApi.financeFromEastmoney(id, {
      stockCode: code,
      listedStatus: emListedStatus.value,
    });
    const items = (res.items || []).map((x) =>
      x.skipped
        ? `${x.reportPeriod}：已存在，跳过`
        : `${x.reportPeriod}：营收 ${(x.revenueYuan / 1e8).toFixed(2)} 亿元（同比 ${x.revenueYoy?.toFixed(2)}%）、` +
          `归母净利 ${(x.netProfitYuan / 1e8).toFixed(2)} 亿元（同比 ${x.netProfitYoy?.toFixed(2)}%）`,
    );
    ElMessage.success({
      title: `已同步 ${res.name}（${res.stockCode}）财报`,
      items,
      advice: res.scored ? `评分已重算：${res.scored.score} 分 / ${res.scored.grade}` : '数据来源：东方财富业绩报表',
    });
    await loadAll();
  } catch {
    // 失败提示由请求拦截器统一弹出（含后端返回的具体原因，如代码不存在、接口报错）
  } finally {
    emLoading.value = false;
  }
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
    if (a.emptyCredit) items.push(`已忽略空壳合规记录：${a.emptyCredit} 条（无事由/机关/日期）`);
    if (a.noFinanceSrc) items.push(`已忽略无来源的财务线索：${a.noFinanceSrc} 条`);
    if (a.emptyFinance) items.push(`已忽略无具体数值的财务线索：${a.emptyFinance} 条`);
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

onMounted(() => {
  loadAll();
  loadNeighbors();
});

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
  align-items: center;
  gap: 8px;
}
.nav-pos {
  color: #909399;
  font-size: 12px;
  white-space: nowrap;
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
/* 表头与描述项一律不换行，避免窄列把标题挤成两行 */
:deep(.el-table th.el-table__cell > .cell) {
  white-space: nowrap;
}
:deep(.el-descriptions__label) {
  white-space: nowrap;
}
.tyc-sync-time {
  margin-left: auto;
  font-size: 12px;
  color: #909399;
}
.tyc-denied-list {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.7;
  color: #b88230;
  word-break: break-all;
}
.tyc-hero {
  padding: 12px 14px;
  margin-bottom: 12px;
  background: linear-gradient(90deg, #f5f9ff 0%, #fbfdff 100%);
  border: 1px solid #e4eefc;
  border-radius: 6px;
}
.tyc-hero-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.tyc-name {
  font-size: 16px;
  font-weight: 600;
  color: #1f2d3d;
  margin-right: 4px;
}
.tyc-hero-sub {
  margin-top: 6px;
  font-size: 12px;
  color: #606266;
}
.tyc-desc {
  margin-bottom: 4px;
}
.tyc-row {
  margin-top: 14px;
}
.tyc-block {
  padding: 12px 14px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  height: 100%;
  box-sizing: border-box;
}
.tyc-row .tyc-block {
  min-height: 132px;
}
/* 企业画像内的分区（风险明细 / 财务与规模 / 风险总览）之间留间距 */
.tyc-section {
  margin-top: 14px;
}
.tyc-risk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 8px;
}
.tyc-risk-item {
  padding: 8px 10px;
  background: #fafcff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
.tyc-risk-item.is-zero {
  opacity: 0.5;
}
.tyc-risk-item.is-veto {
  background: #fef0f0;
  border-color: #fbc4c4;
}
.tyc-risk-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}
.tyc-risk-label {
  font-size: 13px;
  color: #303133;
}
.tyc-risk-count {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  line-height: 1.1;
}
.tyc-risk-item.is-veto .tyc-risk-count {
  color: #f56c6c;
}
.tyc-risk-meta {
  margin-top: 4px;
  font-size: 12px;
  color: #606266;
}
.tyc-risk-note {
  margin-top: 2px;
  font-size: 12px;
  color: #a8abb2;
}
.tyc-kpis-4 {
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
}
/* 明细溯源：司法 / 信用 / 财务 三张表的展开行 */
.detail-box {
  padding: 8px 12px;
  background: #fafafa;
}
.detail-meta {
  margin-bottom: 6px;
  font-size: 12px;
  color: #606266;
}
.detail-json {
  margin: 0;
  padding: 8px 10px;
  max-height: 260px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
  color: #303133;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
}
.fiscal-group {
  margin-bottom: 8px;
}
.fiscal-title {
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #409eff;
}
.fiscal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 2px 16px;
}
.fiscal-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
  font-size: 12px;
  border-bottom: 1px dashed #ebeef5;
}
.fiscal-label {
  color: #909399;
}
.fiscal-value {
  color: #303133;
}
.fiscal-ratio {
  margin-top: 2px;
  font-size: 12px;
  color: #606266;
}
.tyc-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 10px;
  padding-left: 8px;
  border-left: 3px solid #409eff;
  line-height: 1.2;
}
.tyc-sub {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: #909399;
  border-left: none;
}
.tyc-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: #606266;
  white-space: pre-wrap;
}
.tyc-kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.tyc-kpi {
  padding: 8px 4px;
  text-align: center;
  background: #f7f9fc;
  border-radius: 4px;
}
.tyc-kpi-value {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  line-height: 1.2;
}
.tyc-kpi-label {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}
.tyc-kpi-sub {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.8;
  color: #606266;
}
.tyc-tag {
  margin: 0 6px 6px 0;
}
</style>
