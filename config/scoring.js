// 评分卡配置（V1）：扣分制，baseScore=100 起扣；权重用于维度展示与后续加权扩展。
// 调整规则/阈值时请同步升级 SCORING_VERSION，便于历史评分回溯。
// v1.1：一票否决分数封顶（vetoScoreCap）+ 被告未结诉讼排除执行类案由（防重复扣分）
// v1.2：财务维度落地财报科目规则（资产负债率/流动比率/利息保障/连续亏损/经营现金流/有息负债杠杆）+ 财务红线封顶
// v1.3：接入天眼AI 风险总览（免费权益仅聚合计数），无逐条明细时按档扣分
export const SCORING_VERSION = 'v1.3';

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

  // 财务红线（技术方案 5.3.1）：偿债能力已实质恶化时，司法/合规缺数据不得"默认满分"
  // 命中条件同时成立 → 评分封顶 financeVeto.scoreCap，等级/风险按配置给定
  financeVeto: {
    enabled: true,
    debtRatioMin: 0.8, // 资产负债率 ≥ 80%
    lossYearsMin: 2, // 最近连续亏损年数 ≥ 2
    scoreCap: 39,
    grade: 'C',
    riskLevel: '高',
  },

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

      // 天眼AI 风险总览（聚合口径）：仅在无逐条司法明细时作为代理信号
      // 立案信息 = 已被法院受理的案件数，是不含角色/金额的保守代理，故按档扣分而非逐条扣
      riskOverview: {
        tiers: [
          { min: 20, delta: -12, label: '自身立案信息≥20 条' },
          { min: 10, delta: -9, label: '自身立案信息≥10 条' },
          { min: 5, delta: -6, label: '自身立案信息≥5 条' },
          { min: 1, delta: -3, label: '自身立案信息≥1 条' },
        ],
      },
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

      // 财报科目规则：仅在 partner_finance.detail_json.fiscal 存在时生效（无财报数据的客户不受影响）
      statement: {
        // 资产负债率（高→低匹配）
        debtRatio: [
          { min: 0.9, delta: -12, label: '资产负债率≥90%' },
          { min: 0.8, delta: -9, label: '资产负债率≥80%' },
          { min: 0.7, delta: -6, label: '资产负债率≥70%' },
          { min: 0.6, delta: -3, label: '资产负债率≥60%' },
        ],
        // 流动比率（低→高匹配，取第一个满足 max 的档）
        currentRatio: [
          { max: 1.0, delta: -5, label: '流动比率<1（流动资产不能覆盖流动负债）' },
          { max: 1.2, delta: -3, label: '流动比率<1.2' },
        ],
        // 利息保障倍数 =(利润总额+利息费用)/利息费用
        interestCover: [
          { max: 0, delta: -6, label: '利息保障倍数≤0（经营利润无法覆盖利息）' },
          { max: 1, delta: -4, label: '利息保障倍数<1' },
          { max: 3, delta: -2, label: '利息保障倍数<3' },
        ],
        // 最近连续亏损年数
        lossYears: { perYear: -2, max: -10 },
        // 最近一期经营活动现金流量净额为负
        negativeOcf: -4,
        // 有息负债 / 所有者权益
        debtToEquity: [
          { min: 2, delta: -5, label: '有息负债≥2倍净资产' },
          { min: 1, delta: -3, label: '有息负债≥1倍净资产' },
        ],
        // 财报类扣分合计下限（防止单一维度吞掉其他维度）
        max: -30,
      },
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
