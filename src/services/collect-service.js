import db from '../db.js';
import { getPartner } from './partner-service.js';
import { listConnectors } from '../channels/registry.js';
import { getSetting } from './setting-service.js';

const now = () => new Date();

export async function saveRaw(partnerId, channel, bizKey, payload) {
  const r = await db.run(
    'INSERT INTO partner_raw (partner_id, channel, biz_key, payload_json, fetched_at) VALUES (?, ?, ?, ?, ?)',
    [partnerId, channel, bizKey || null, JSON.stringify(payload ?? null), now()],
  );
  return Number(r.lastInsertRowid);
}

export async function saveJudicial(partnerId, items = []) {
  let n = 0;
  for (const it of items) {
    await db.run(
      `INSERT INTO partner_judicial
        (partner_id, case_type, party_role, case_no, court, amount, status, date, detail_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        partnerId,
        it.caseType || null,
        it.partyRole || null,
        it.caseNo || null,
        it.court || null,
        it.amount ?? null,
        it.status || null,
        it.date || null,
        it.detail ? JSON.stringify(it.detail) : null,
        now(),
      ],
    );
    n++;
  }
  return n;
}

export async function saveCredit(partnerId, items = []) {
  let n = 0;
  for (const it of items) {
    await db.run(
      `INSERT INTO partner_credit
        (partner_id, item_type, authority, reason, penalty, date, detail_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        partnerId,
        it.itemType || null,
        it.authority || null,
        it.reason || null,
        it.penalty || null,
        it.date || null,
        it.detail ? JSON.stringify(it.detail) : null,
        now(),
      ],
    );
    n++;
  }
  return n;
}

export async function saveFinance(partnerId, items = []) {
  let n = 0;
  for (const it of items) {
    await db.run(
      `INSERT INTO partner_finance
        (partner_id, src, rev_yoy, profit, scale_tag, employee_cnt, bid_cnt, detail_json, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        partnerId,
        it.src || null,
        it.revYoy || null,
        it.profit || null,
        it.scaleTag || null,
        it.employeeCnt ?? null,
        it.bidCnt ?? null,
        it.detail ? JSON.stringify(it.detail) : null,
        now(),
      ],
    );
    n++;
  }
  return n;
}

// 采集：遍历所有渠道（含未配置），逐个调用并记录任务；配置齐全的渠道落 raw + 维度
export async function collectPartner(partnerId) {
  const partner = await getPartner(partnerId);
  if (!partner) throw new Error('客户不存在');

  const recordRaw = await getSetting('collect.recordRaw', true);
  const connectors = listConnectors();
  const tasks = [];
  for (const c of connectors) {
    const started = Date.now();
    let status;
    let errMsg = null;

    if (!c.isConfigured()) {
      status = 'skipped';
      errMsg = '未配置/未启用';
    } else {
      try {
        const result = partner.credit_code
          ? await c.fetchDetail(partner.credit_code)
          : await c.search(partner.name);

        if (result && result.ok) {
          status = 'ok';
          if (recordRaw) await saveRaw(partnerId, c.key, partner.credit_code || partner.name, result);
          const normalized = result.normalized || {};
          if (Array.isArray(normalized.judicial)) await saveJudicial(partnerId, normalized.judicial);
          if (Array.isArray(normalized.credit)) await saveCredit(partnerId, normalized.credit);
          if (Array.isArray(normalized.finance)) await saveFinance(partnerId, normalized.finance);
        } else {
          status = 'not_implemented';
          errMsg = result?.reason || '渠道未返回数据';
          if (recordRaw) await saveRaw(partnerId, c.key, partner.credit_code || partner.name, result || null);
        }
      } catch (e) {
        status = 'error';
        errMsg = e.message;
      }
    }

    const costMs = Date.now() - started;
    await db.run(
      'INSERT INTO fetch_task (partner_id, channel, status, cost_ms, err_msg, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [partnerId, c.key, status, costMs, errMsg, now()],
    );
    tasks.push({ channel: c.key, status, costMs, err: errMsg });
  }

  // 系统设置：采集后自动重算（失败不阻断采集结果返回）
  let scored = null;
  let scoreError = null;
  if (await getSetting('scoring.autoRecalcOnCollect', true)) {
    try {
      const { ratePartner } = await import('./scoring-service.js');
      scored = await ratePartner(partnerId);
    } catch (e) {
      scoreError = e.message;
    }
  }

  return { partnerId, tasks, scored, scoreError };
}

export async function listFetchTasks(partnerId) {
  return db.all('SELECT * FROM fetch_task WHERE partner_id = ? ORDER BY id DESC', [partnerId]);
}

// 采集任务汇总：按渠道+状态计数
export async function getCollectSummary(partnerId) {
  const rows = await db.all(
    `SELECT channel, status, COUNT(*) AS cnt
     FROM fetch_task WHERE partner_id = ?
     GROUP BY channel, status ORDER BY channel, status`,
    [partnerId],
  );
  const items = rows.map((r) => ({ channel: r.channel, status: r.status, count: Number(r.cnt) }));
  return { total: items.reduce((s, x) => s + x.count, 0), items };
}

export async function getJudicial(partnerId) {
  return db.all('SELECT * FROM partner_judicial WHERE partner_id = ? ORDER BY id DESC', [partnerId]);
}

export async function getCredit(partnerId) {
  return db.all('SELECT * FROM partner_credit WHERE partner_id = ? ORDER BY id DESC', [partnerId]);
}

export async function getFinance(partnerId) {
  return db.all('SELECT * FROM partner_finance WHERE partner_id = ? ORDER BY id DESC', [partnerId]);
}
