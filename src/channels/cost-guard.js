// 渠道调用成本护栏：日调用次数 / 日金额上限 + 结果缓存。
// 按次计费的接口（天眼查/企查查）一旦被批量导入循环调用，几分钟就能烧掉几百元，必须在调用前拦截。
// 说明：计数与缓存均为进程内状态，重启归零；原始响应另由 partner_raw 持久化留档。

const usage = new Map(); // channel -> { day, calls, cost }
const cache = new Map(); // `${channel}:${key}` -> { expire, value }

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function entryOf(channel) {
  const day = todayKey();
  let e = usage.get(channel);
  if (!e || e.day !== day) {
    e = { day, calls: 0, cost: 0 };
    usage.set(channel, e);
  }
  return e;
}

export function getBudget(channel, limits = {}) {
  const e = entryOf(channel);
  return {
    day: e.day,
    calls: e.calls,
    cost: Number(e.cost.toFixed(2)),
    maxCalls: Number(limits.maxCalls ?? 200),
    maxCost: Number(limits.maxCost ?? 50),
  };
}

// 调用前预扣：超限直接拒绝，不发生真实请求
export function reserveCall(channel, unitCost = 0, limits = {}) {
  const e = entryOf(channel);
  const maxCalls = Number(limits.maxCalls ?? 200);
  const maxCost = Number(limits.maxCost ?? 50);
  if (e.calls + 1 > maxCalls) return { ok: false, reason: `已达日调用上限（${maxCalls} 次），请调整 CHANNEL_DAILY_MAX_CALLS` };
  if (e.cost + unitCost > maxCost) return { ok: false, reason: `已达日成本上限（¥${maxCost}），请调整 CHANNEL_DAILY_MAX_COST` };
  e.calls += 1;
  e.cost += Number(unitCost) || 0;
  return { ok: true };
}

export function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expire < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

export function cacheSet(key, value, ttlMs = 24 * 3600 * 1000) {
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expire < now) cache.delete(k);
    if (cache.size > 500) cache.delete(cache.keys().next().value);
  }
  cache.set(key, { expire: Date.now() + ttlMs, value });
}

// 供测试/运维重置
export function resetCostGuard() {
  usage.clear();
  cache.clear();
}
