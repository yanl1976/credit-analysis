import { h } from 'vue';
import { ElMessageBox } from 'element-plus';

// 统一反馈组件：居中弹窗 + 必须手动点击关闭（不自动消失）。
// 为什么不用 ElMessage：它是顶部横条，会自动消失，多条时堆叠成一堆，长文本看不清。
// 用法：
//   ElMessage.success('已保存')                          → 单条
//   ElMessage.error({ title:'采集失败', items:[...] })   → 多条，自动编号 1、2、3
//   ElMessage.warning({ items:[...], advice:'...' })     → 末尾追加建议
const DEFAULT_TITLE = {
  success: '操作成功',
  error: '操作失败',
  warning: '请注意',
  info: '提示',
};

const ICON_TYPE = { success: 'success', error: 'error', warning: 'warning', info: 'info' };

// 同一内容短时间内重复弹出（例如并发请求同时失败）只提示一次
let lastKey = '';
let lastAt = 0;

function normalize(input) {
  if (input === null || input === undefined) return {};
  if (typeof input === 'string' || typeof input === 'number') return { message: String(input) };
  return input || {};
}

function buildBody({ message, items, advice }) {
  const list = Array.isArray(items) ? items.filter((x) => x !== null && x !== undefined && x !== '') : [];
  const lines = list.length ? list : message ? [String(message)] : [];

  const children = lines.map((text, i) =>
    h(
      'div',
      {
        class: 'fb-line',
        style: lines.length > 1 ? 'display:flex;gap:6px;text-align:left;line-height:1.7;' : 'line-height:1.7;',
      },
      lines.length > 1
        ? [h('span', { style: 'flex:0 0 auto;font-weight:600;' }, `${i + 1}.`), h('span', String(text))]
        : String(text),
    ),
  );

  if (advice) {
    children.push(
      h(
        'div',
        {
          style:
            'margin-top:10px;padding-top:8px;border-top:1px solid #ebeef5;color:#606266;font-size:13px;text-align:left;',
        },
        `建议：${advice}`,
      ),
    );
  }

  return h('div', { style: 'max-width:520px;' }, children);
}

function show(type, input) {
  const opts = normalize(input);
  const title = opts.title || DEFAULT_TITLE[type] || '提示';
  const key = `${type}|${title}|${JSON.stringify(opts.items || opts.message || '')}`;
  const now = Date.now();
  if (key === lastKey && now - lastAt < 1500) return Promise.resolve();
  lastKey = key;
  lastAt = now;

  return ElMessageBox.alert(buildBody(opts), title, {
    type: ICON_TYPE[type] || 'info',
    center: true,
    confirmButtonText: opts.confirmText || '知道了',
    closeOnClickModal: false,
    closeOnPressEscape: false,
    showClose: false,
    customClass: 'fb-dialog',
  }).catch(() => {});
}

// 与 Element Plus ElMessage 同名同形的门面，替换 import 即可全站生效
export const ElMessage = {
  success: (input) => show('success', input),
  error: (input) => show('error', input),
  warning: (input) => show('warning', input),
  info: (input) => show('info', input),
};

export default ElMessage;
