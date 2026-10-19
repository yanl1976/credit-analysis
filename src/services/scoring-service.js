import db from '../db.js';
import { getPartner } from './partner-service.js';
import { getJudicial, getCredit, getFinance } from './collect-service.js';
import { getTycRiskMetrics } from './tyc-service.js';
import { SCORING_RULES } from '../../config/scoring.js';
import { getSetting } from './setting-service.js';

const now = () => new Date();

function push(reasons, delta, category, reason) {
  reasons.push({ delta, category, reason });
}

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));

function parseJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 取最近一期含结构化财报（detail_json.fiscal）的记录
function latestFiscal(finance) {
  const rows = (finance || [])
    .map((f) => {
      const detail = parseJson(f.detail_json);
      return { period: String(f.report_period || ''), fiscal: detail && detail.fiscal };
    })
    .filter((x) => x.period && x.fiscal)
    .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));
  return rows[0] || null;
}

// 最近连续亏损年数（history 按年份倒序，遇到盈利即停止）
function consecutiveLossYears(history) {
  if (!Array.isArray(history) || !history.length) return 0;
  const sorted = [...history].sort((a, b) => Number(b.year) - Number(a.year));
  let n = 0;
  for (const h of sorted) {
    if (num(h.netProfit) < 0) n += 1;
    else break;
  }
  return n;
}

// 由财报科目推导偿债指标（口径：EBIT=利润总额+利息费用；净资产为负时杠杆置为 Infinity）
function computeFiscalMetrics(fiscal) {
  const bs = fiscal.bs || {};
  const is = fiscal.is || {};
  const cf = fiscal.cf || {};
  const totalAssets = num(bs.totalAssets);
  const totalLiab = num(bs.totalLiab);
  const equity = num(bs.equity);
  const interestBearing =
    num(bs.shortLoan) + num(bs.currentPortionLongDebt) + num(bs.longLoan) + num(bs.leaseLiab);
  const interestExpense = num(is.interestExpense);
  return {
    period: fiscal.period || null,
    debtRatio: totalAssets ? totalLiab / totalAssets : null,
    currentRatio: num(bs.currentLiab) ? num(bs.currentAssets) / num(bs.currentLiab) : null,
    interestCover: interestExpense ? (num(is.totalProfit) + interestExpense) / interestExpense : null,
    debtToEquity: equity > 0 ? interestBearing / equity : equity < 0 ? Infinity : null,
    netAssetsNegative: equity < 0,
    lossYears: consecutiveLossYears(fiscal.history),
    ocf: num(cf.netCashOperate),
    interestBearing,
    equity,
    totalAssets,
    totalLiab,
  };
}

const pctText = (v) => (v === null ? '-' : `${(v * 100).toFixed(2)}%`);
const xText = (v) => (v === null ? '-' : Number.isFinite(v) ? `${v.toFixed(2)}倍` : '净资产为负');

// 评分计算：baseScore 起扣，命中一票否决直接 D/极高，reasons 输出可解释明细
export async function calculateScore(partnerId) {
  const partner = await getPartner(partnerId);
  if (!partner) throw new Error('客户不存在');

  const [judicial, credit, finance, tyc] = await Promise.all([
    getJudicial(partnerId),
    getCredit(partnerId),
    getFinance(partnerId),
    getTycRiskMetrics(partnerId),
  ]);

  const R = SCORING_RULES;
  const D = R.deductions;
  const reasons = [];
  let score = R.baseScore;
  let veto = false;

  // 1) 司法
  for (const j of judicial) {
    const caseType = j.case_type || '';
    if (R.veto.judicialCaseTypes.some((t) => caseType.includes(t))) {
      veto = true;
      push(reasons, 0, '司法', `一票否决：${caseType}（${j.case_no || '无案号'}）`);
      continue;
    }
    // 只有「本企业被执行」才扣分：作为申请执行人（原告/债权人）属于追偿行为，不是风险信号
    const isExecuted = /被执行人/.test(j.party_role || '') || /被执行人/.test(caseType);
    const isApplicant = /申请执行人/.test(j.party_role || '');
    if (caseType.includes('执行') && isExecuted && !isApplicant) {
      let delta = D.judicial.executionPerCase;
      const amount = Number(j.amount || 0);
      const tier = D.judicial.executionAmountThresholds.find((t) => amount >= t.min);
      let label = '被执行 1 条';
      if (tier) {
        delta += tier.delta;
        label = `被执行 1 条（${tier.label}，${amount} 元）`;
      }
      score += delta;
      push(reasons, delta, '司法', label);
    }
  }

  // 仅统计「诉讼」类被告未结案件：执行/失信/破产/限高已在上面按被执行与否决口径计过，避免重复扣分
  const defendantOpen = judicial.filter(
    (j) =>
      (j.party_role || '').includes('被告') &&
      (j.status || '') !== '已结' &&
      !/执行|失信|破产|限高/.test(j.case_type || ''),
  );
  if (defendantOpen.length) {
    const delta = Math.max(
      D.judicial.defendantMax,
      defendantOpen.length * D.judicial.defendantPerCase,
    );
    score += delta;
    push(reasons, delta, '司法', `作为被告的未结诉讼 ${defendantOpen.length} 起`);
  }

  // 逐条明细不足以覆盖天眼AI 的「自身·立案信息」时，用聚合计数补足（明细齐全则不重复扣）
  if (tyc && tyc.selfCases > judicial.length && D.judicial.riskOverview) {
    const tier = D.judicial.riskOverview.tiers.find((t) => tyc.selfCases >= t.min);
    if (tier) {
      score += tier.delta;
      push(
        reasons,
        tier.delta,
        '司法',
        `${tier.label}（天眼AI 风险总览聚合口径：自身立案 ${tyc.selfCases} 条 / 开庭 ${tyc.selfHearings} 条 / 裁判文书 ${tyc.selfJudgments} 条；本库仅 ${judicial.length} 条逐条明细，角色与金额未全部核实）`,
      );
    }
  }

  // 2) 合规
  const cnt = (kw) => credit.filter((c) => (c.item_type || '').includes(kw)).length;
  const serious = cnt('严重违法');
  const abnormal = cnt('经营异常');
  const penalty = cnt('行政处罚');
  const tax = cnt('税收');
  if (serious) {
    const d = serious * D.compliance.seriousViolationPerCase;
    score += d;
    push(reasons, d, '合规', `严重违法失信 ${serious} 条`);
  }
  if (abnormal) {
    const d = abnormal * D.compliance.abnormalOperationPerCase;
    score += d;
    push(reasons, d, '合规', `经营异常 ${abnormal} 条`);
  }
  if (penalty) {
    const d = penalty * D.compliance.adminPenaltyPerCase;
    score += d;
    push(reasons, d, '合规', `行政处罚 ${penalty} 条`);
  }
  if (tax) {
    const d = tax * D.compliance.taxViolationPerCase;
    score += d;
    push(reasons, d, '合规', `税收违法 ${tax} 条`);
  }

  // 3) 工商
  const regStatus = partner.reg_status || '';
  if (R.veto.regStatuses.some((s) => regStatus.includes(s))) {
    veto = true;
    push(reasons, 0, '工商', `一票否决：工商状态 ${regStatus}`);
  } else if (regStatus && !/存续|在营|开业/.test(regStatus)) {
    score += D.basic.nonActiveStatus;
    push(reasons, D.basic.nonActiveStatus, '工商', `工商状态异常：${regStatus}`);
  }
  if (!partner.credit_code) {
    score += D.basic.missingCreditCode;
    push(reasons, D.basic.missingCreditCode, '工商', '缺少统一社会信用代码');
  }

  // 4) 财务（替代数据）
  const scale = finance.map((f) => f.scale_tag || '').join(',');
  if (/(小微|个体|微型)/.test(scale)) {
    score += D.finance.smallScale;
    push(reasons, D.finance.smallScale, '财务', '规模标签：小微/个体');
  }

  // 4.1) 财务科目规则（仅对存在结构化财报 partner_finance.detail_json.fiscal 的客户生效）
  const S = D.finance.statement;
  const fiscalRow = latestFiscal(finance);
  let finVeto = false;
  let finMetrics = null;
  if (fiscalRow) {
    finMetrics = computeFiscalMetrics(fiscalRow.fiscal);
    const entries = [];
    const addEntry = (delta, reason) => entries.push({ delta, reason });

    const tier = (list, value) =>
      list.find((t) => (t.min !== undefined ? value >= t.min : value < t.max)) || null;

    if (finMetrics.debtRatio !== null) {
      const t = tier(S.debtRatio, finMetrics.debtRatio);
      if (t) addEntry(t.delta, `${t.label}（${pctText(finMetrics.debtRatio)}）`);
    }
    if (finMetrics.currentRatio !== null) {
      const t = tier(S.currentRatio, finMetrics.currentRatio);
      if (t) addEntry(t.delta, `${t.label}（${xText(finMetrics.currentRatio)}）`);
    }
    if (finMetrics.interestCover !== null) {
      const t = tier(S.interestCover, finMetrics.interestCover);
      if (t) addEntry(t.delta, `${t.label}（${xText(finMetrics.interestCover)}）`);
    }
    if (finMetrics.lossYears > 0) {
      const d = Math.max(S.lossYears.max, finMetrics.lossYears * S.lossYears.perYear);
      addEntry(d, `最近连续亏损 ${finMetrics.lossYears} 年`);
    }
    if (finMetrics.ocf < 0) addEntry(S.negativeOcf, '最近一期经营活动现金流量净额为负');
    if (finMetrics.netAssetsNegative) {
      addEntry(S.debtToEquity[0].delta, '净资产为负（资不抵债）');
    } else if (finMetrics.debtToEquity !== null) {
      const t = tier(S.debtToEquity, finMetrics.debtToEquity);
      if (t) addEntry(t.delta, `${t.label}（${xText(finMetrics.debtToEquity)}）`);
    }

    let sum = entries.reduce((a, e) => a + e.delta, 0);
    for (const e of entries) {
      score += e.delta;
      push(reasons, e.delta, '财务', e.reason);
    }
    if (sum < S.max) {
      const adjust = S.max - sum;
      score += adjust;
      push(reasons, adjust, '财务', `财报扣分合计达上限 ${S.max} 分`);
      sum = S.max;
    }

    // 财务红线：偿债能力实质恶化时封顶，避免「司法/合规无数据 → 默认满分」
    const FV = R.financeVeto;
    if (
      FV &&
      FV.enabled &&
      finMetrics.debtRatio !== null &&
      finMetrics.debtRatio >= FV.debtRatioMin &&
      finMetrics.lossYears >= FV.lossYearsMin
    ) {
      finVeto = true;
      push(
        reasons,
        0,
        '财务红线',
        `资产负债率 ${pctText(finMetrics.debtRatio)} ≥ ${pctText(FV.debtRatioMin)}，且最近连续亏损 ${finMetrics.lossYears} 年`,
      );
    }
  }

  // 5) 舆情：暂无数据源，保留权重
  if (!judicial.length && !credit.length) {
    push(
      reasons,
      0,
      '数据',
      tyc && tyc.hasData
        ? '司法/合规仅有天眼AI 风险总览聚合计数（逐条明细与实际角色需 VIP 权益），评分完整性受限'
        : '司法/信用合规渠道无数据（未配置渠道 Key），该两维度本次未扣分，评分完整性受限',
    );
  }

  score = Math.max(0, Math.min(100, score));

  // 封顶：一票否决优先，其次财务红线（避免出现「95 分 / D 级」的矛盾展示）
  let cap = null;
  let capCategory = '否决';
  if (veto) {
    cap = R.vetoScoreCap;
    capCategory = '否决';
  }
  if (finVeto) {
    const fc = R.financeVeto.scoreCap;
    cap = cap === null ? fc : Math.min(cap, fc);
    if (!veto) capCategory = '财务红线';
  }
  if (cap !== null && score > cap) {
    const capDelta = cap - score;
    score = cap;
    push(
      reasons,
      capDelta,
      capCategory,
      `${capCategory === '否决' ? '一票否决' : '财务红线'}：评分封顶 ${cap} 分`,
    );
  }

  let grade = 'D';
  let riskLevel = '极高';
  for (const t of R.gradeThresholds) {
    if (score >= t.min) {
      grade = t.grade;
      riskLevel = t.riskLevel;
      break;
    }
  }
  if (veto) {
    grade = 'D';
    riskLevel = '极高';
  } else if (finVeto) {
    grade = R.financeVeto.grade;
    riskLevel = R.financeVeto.riskLevel;
  }

  return {
    partnerId: Number(partnerId),
    score,
    grade,
    riskLevel,
    veto,
    financeVeto: finVeto,
    financeMetrics: finMetrics,
    tycMetrics: tyc || null,
    reasons,
    calcVersion: R.version,
  };
}

function parseReasons(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function mapRatingRow(row) {
  if (!row) return null;
  return {
    partnerId: Number(row.partner_id),
    score: Number(row.score),
    grade: row.grade,
    riskLevel: row.risk_level,
    veto: !!Number(row.veto),
    reasons: parseReasons(row.reasons),
    calcVersion: row.calc_version,
    calculatedAt: row.calculated_at,
  };
}

// 当前评分（partner_rating 每客户仅保留最新一条）
export async function getRating(partnerId) {
  const row = await db.get('SELECT * FROM partner_rating WHERE partner_id = ?', [partnerId]);
  return mapRatingRow(row);
}

// 历史评分（每次重算追加一条，供回溯对比）
export async function getRatingHistory(partnerId, limit = 20) {
  const n = Math.min(200, Math.max(1, Number(limit) || 20));
  const rows = await db.all(
    `SELECT * FROM partner_rating_history WHERE partner_id = ? ORDER BY id DESC LIMIT ?`,
    [Number(partnerId), n],
  );
  return rows.map(mapRatingRow);
}

async function saveRating(result) {
  const calculatedAt = now();
  const reasonsJson = JSON.stringify(result.reasons || []);
  const params = [
    result.partnerId,
    result.score,
    result.grade,
    result.riskLevel,
    result.veto ? 1 : 0,
    reasonsJson,
    result.calcVersion,
    calculatedAt,
  ];
  await db.run(
    `INSERT INTO partner_rating
      (partner_id, score, grade, risk_level, veto, reasons, calc_version, calculated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       score = VALUES(score), grade = VALUES(grade), risk_level = VALUES(risk_level),
       veto = VALUES(veto), reasons = VALUES(reasons), calc_version = VALUES(calc_version),
       calculated_at = VALUES(calculated_at)`,
    params,
  );
  await db.run(
    `INSERT INTO partner_rating_history
      (partner_id, score, grade, risk_level, veto, reasons, calc_version, calculated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params,
  );
  return calculatedAt;
}

// 计算 + 落库（含历史留档），等级变化时写 risk_event 供预警中心消费
export async function ratePartner(partnerId) {
  const id = Number(partnerId);
  const previous = await getRating(id);
  const result = await calculateScore(id);
  const calculatedAt = await saveRating(result);

  const gradeChanged = !!previous && previous.grade !== result.grade;
  const recordEvent = await getSetting('warning.recordGradeChange', true);
  if (gradeChanged && recordEvent) {
    await db.run(
      `INSERT INTO risk_event (partner_id, event_type, old_grade, new_grade, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        'GRADE_CHANGE',
        previous.grade,
        result.grade,
        JSON.stringify({
          prevScore: previous.score,
          score: result.score,
          prevRiskLevel: previous.riskLevel,
          riskLevel: result.riskLevel,
          calcVersion: result.calcVersion,
        }),
        calculatedAt,
      ],
    );
  }

  return {
    ...result,
    calculatedAt,
    previous: previous || null,
    gradeChanged,
    riskEventRecorded: gradeChanged && recordEvent,
  };
}

// 批量重算：partnerIds 与 orgIds 同时给出时取交集；orgIds=null 表示不限组织（仅集团管理员）
export async function rateBatch({ partnerIds = null, orgIds = null } = {}) {
  const where = [];
  const params = [];
  const ids = Array.isArray(partnerIds)
    ? partnerIds.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)
    : [];
  if (Array.isArray(partnerIds) && ids.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, gradeChanged: 0, changes: [], failures: [], distribution: {} };
  }
  if (ids.length) {
    where.push(`id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (Array.isArray(orgIds)) {
    if (!orgIds.length) {
      return { total: 0, succeeded: 0, failed: 0, gradeChanged: 0, changes: [], failures: [], distribution: {} };
    }
    where.push(`owner_org_id IN (${orgIds.map(() => '?').join(',')})`);
    params.push(...orgIds.map(Number));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.all(`SELECT id FROM partner ${whereSql} ORDER BY id`, params);

  let succeeded = 0;
  const failures = [];
  const changes = [];
  const distribution = {};

  for (const row of rows) {
    try {
      const res = await ratePartner(Number(row.id));
      succeeded++;
      distribution[res.grade] = (distribution[res.grade] || 0) + 1;
      if (res.gradeChanged) {
        changes.push({
          partnerId: res.partnerId,
          oldGrade: res.previous?.grade ?? null,
          newGrade: res.grade,
          oldScore: res.previous?.score ?? null,
          newScore: res.score,
        });
      }
    } catch (e) {
      failures.push({ partnerId: Number(row.id), message: e.message });
    }
  }

  return {
    total: rows.length,
    succeeded,
    failed: failures.length,
    gradeChanged: changes.length,
    changes,
    failures,
    distribution,
  };
}
