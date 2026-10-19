import { getPartner } from './partner-service.js';
import { getJudicial, getCredit, getFinance } from './collect-service.js';
import { SCORING_RULES } from '../../config/scoring.js';

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
