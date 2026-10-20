const GRADE_TYPES = {
  AAA: 'success',
  AA: 'success',
  A: 'primary',
  B: 'warning',
  C: 'danger',
  D: 'danger',
};

export function gradeTagType(grade) {
  return GRADE_TYPES[grade] || 'info';
}

export function riskTagType(riskLevel) {
  if (riskLevel === '低') return 'success';
  if (riskLevel === '中') return 'warning';
  if (riskLevel === '高') return 'danger';
  if (riskLevel === '极高') return 'danger';
  return 'info';
}

export const SOURCE_LABELS = {
  manual: '手工录入',
  demo: '演示数据',
  channel: '渠道采集',
  ai: 'AI 推断',
  tyc_mcp: '天眼AI',
};

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || '手工录入';
}

export function sourceTagType(source) {
  if (source === 'demo') return 'warning';
  if (source === 'channel') return 'success';
  if (source === 'tyc_mcp') return 'success';
  if (source === 'ai') return 'danger';
  return 'info';
}

export function deltaClass(delta) {
  if (delta > 0) return 'delta-plus';
  if (delta < 0) return 'delta-minus';
  return 'delta-zero';
}

// 准入状态（风险名单）：正常 / 关注 / 重点监控 / 黑名单
export const ADMISSION_LABELS = {
  NORMAL: '正常',
  WATCH: '关注',
  KEY: '重点监控',
  BLACKLIST: '黑名单',
};

export const admissionOptions = ['NORMAL', 'WATCH', 'KEY', 'BLACKLIST'].map((value) => ({
  value,
  label: ADMISSION_LABELS[value],
}));

export function admissionLabel(status) {
  return ADMISSION_LABELS[status] || '正常';
}

export function admissionTagType(status) {
  if (status === 'BLACKLIST') return 'danger';
  if (status === 'KEY') return 'warning';
  if (status === 'WATCH') return 'primary';
  return 'info';
}

// 复审状态：未排期 / 逾期 / 临期 / 已排期
export const REVIEW_LABELS = {
  unscheduled: '未排期',
  overdue: '已逾期',
  dueSoon: '临期',
  scheduled: '已排期',
};

export function reviewLabel(status) {
  return REVIEW_LABELS[status] || '-';
}

export function reviewTagType(status) {
  if (status === 'overdue') return 'danger';
  if (status === 'dueSoon') return 'warning';
  if (status === 'scheduled') return 'success';
  return 'info';
}
