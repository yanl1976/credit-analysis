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
};

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || '手工录入';
}

export function sourceTagType(source) {
  if (source === 'demo') return 'warning';
  if (source === 'channel') return 'success';
  if (source === 'ai') return 'danger';
  return 'info';
}

export function deltaClass(delta) {
  if (delta > 0) return 'delta-plus';
  if (delta < 0) return 'delta-minus';
  return 'delta-zero';
}
