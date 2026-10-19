import db from '../db.js';
import { getPartner } from './partner-service.js';
import { getJudicial, getCredit, getFinance } from './collect-service.js';
import { SCORING_RULES } from '../../config/scoring.js';

const now = () => new Date();

function push(reasons, delta, category, reason) {
  reasons.push({ delta, category, reason });
}

// 评分计算：baseScore 起扣，命中一票否决直接 D/极高，reasons 输出可解释明细
export async function calculateScore(partnerId) {
  const partner = await getPartner(partnerId);
  if (!partner) throw new Error('客户不存在');

  const [judicial, credit, finance] = await Promise.all([
    getJudicial(partnerId),
    getCredit(partnerId),
    getFinance(partnerId),
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
    if (caseType.includes('执行')) {
      let delta = D.judicial.executionPerCase;
      const amount = Number(j.amount || 0);
      const tier = D.judicial.executionAmountThresholds.find((t) => amount >= t.min);
      if (tier) {
        delta += tier.delta;
        push(reasons, tier.delta, '司法', `${tier.label}（${amount}元）`);
      }
      score += delta;
      push(reasons, delta, '司法', '被执行 1 条');
    }
  }

  const defendantOpen = judicial.filter(
    (j) => (j.party_role || '').includes('被告') && (j.status || '') !== '已结',
  );
  if (defendantOpen.length) {
    const delta = Math.max(
      D.judicial.defendantMax,
      defendantOpen.length * D.judicial.defendantPerCase,
    );
    score += delta;
    push(reasons, delta, '司法', `作为被告的未结诉讼 ${defendantOpen.length} 起`);
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

  // 5) 舆情：暂无数据源，保留权重

  score = Math.max(0, Math.min(100, score));

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
  }

  return {
    partnerId: Number(partnerId),
    score,
    grade,
    riskLevel,
    veto,
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
  if (gradeChanged) {
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
  };
}
