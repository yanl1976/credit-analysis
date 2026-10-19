// 评分卡配置（V1）：扣分制，baseScore=100 起扣；权重用于维度展示与后续加权扩展。
// 调整规则/阈值时请同步升级 SCORING_VERSION，便于历史评分回溯。
// v1.1：一票否决分数封顶（vetoScoreCap）+ 被告未结诉讼排除执行类案由（防重复扣分）
export const SCORING_VERSION = 'v1.1';

export const SCORING_RULES = {
  version: SCORING_VERSION,
  baseScore: 100,

  // 维度权重（V1 建议值，合计 100）
  weights: {
    judicial: 35,
    compliance: 25,
    basic: 20,
    finance: 15,
    sentiment: 5,
  },

  // 一票否决：命中即 grade=D / riskLevel=极高，且分数封顶（见 vetoScoreCap）
  veto: {
    judicialCaseTypes: ['失信', '破产', '限高'],
    regStatuses: ['吊销', '注销'],
  },

  // 否决客户的评分上限（技术方案 5.3「评分封顶」落地值）
  vetoScoreCap: 25,

  // 扣分明细
  deductions: {
    judicial: {
      executionPerCase: -8,
      executionAmountThresholds: [
        { min: 1000000, delta: -15, label: '被执行金额>100万' },
        { min: 500000, delta: -10, label: '被执行金额>50万' },
        { min: 100000, delta: -5, label: '被执行金额>10万' },
      ],
      defendantPerCase: -5,
      defendantMax: -20,
    },
    compliance: {
      seriousViolationPerCase: -15,
      abnormalOperationPerCase: -8,
      adminPenaltyPerCase: -5,
      taxViolationPerCase: -10,
    },
    basic: {
      nonActiveStatus: -10,
      missingCreditCode: -5,
    },
    finance: {
      smallScale: -8,
    },
    sentiment: {
      negativePerItem: -5,
      max: -15,
    },
  },

  // 等级映射（从高到低匹配）
  gradeThresholds: [
    { min: 85, grade: 'AAA', riskLevel: '低' },
    { min: 70, grade: 'AA', riskLevel: '低' },
    { min: 55, grade: 'A', riskLevel: '中' },
    { min: 40, grade: 'B', riskLevel: '中' },
    { min: 25, grade: 'C', riskLevel: '高' },
    { min: 0, grade: 'D', riskLevel: '极高' },
  ],
};
