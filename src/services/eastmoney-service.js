import db from '../db.js';

// 东方财富公开数据通道（免 Key）
// 用途：上市公司 / 上市子公司的真实财报数据，替代"靠大模型回忆"的做法。
// 说明：接口均为东方财富网站前端使用的公开接口，非官方文档化 API，改版时可能失效；
//       失败一律抛错，绝不返回推测值。
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const DATACENTER = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const DATACENTER_V2 = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';

// 6 位代码 → 交易所后缀
export function toSecuCode(code) {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) throw new Error(`股票代码必须是 6 位数字：${code}`);
  if (/^(60|68|90)/.test(c)) return `${c}.SH`;
  if (/^(00|20|30)/.test(c)) return `${c}.SZ`;
  if (/^(8|4|92)/.test(c)) return `${c}.BJ`;
  return `${c}.SH`;
}

async function getJson(url, timeoutMs = 20000) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`东方财富接口 HTTP ${resp.status}`);
  const text = await resp.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`东方财富返回非 JSON：${text.slice(0, 120)}`);
  }
  if (payload.success === false) throw new Error(`东方财富接口报错：${payload.message || '未知'}`);
  return payload.result || {};
}

// 公司概况（含"是否为上市公司、上市代码"这类可核验信息）
export async function fetchCompanyProfile(stockCode) {
  const secu = toSecuCode(stockCode);
  const url =
    `${DATACENTER_V2}?reportName=RPT_F10_BASIC_ORGINFO` +
    `&columns=SECUCODE,SECURITY_NAME_ABBR,ORG_PROFILE&filter=${encodeURIComponent(`(SECUCODE="${secu}")`)}`;
  const r = await getJson(url);
  const row = (r.data || [])[0];
  if (!row) throw new Error(`东方财富未查到 ${stockCode} 的公司概况`);
  return { secuCode: secu, name: row.SECURITY_NAME_ABBR, profile: row.ORG_PROFILE || '' };
}

// 业绩报表（营收/净利/同比/EPS），按报告期倒序
export async function fetchFinancePeriods(stockCode, size = 8) {
  const code = String(stockCode).trim();
  const url =
    `${DATACENTER}?reportName=RPT_LICO_FN_CPD` +
    `&columns=SECURITY_CODE,SECURITY_NAME_ABBR,REPORTDATE,TOTAL_OPERATE_INCOME,YSTZ,PARENT_NETPROFIT,SJLTZ,BASIC_EPS` +
    `&filter=${encodeURIComponent(`(SECURITY_CODE="${code}")`)}` +
    `&pageNumber=1&pageSize=${size}&sortTypes=-1&sortColumns=REPORTDATE`;
  const r = await getJson(url);
  const rows = r.data || [];
  if (!rows.length) throw new Error(`东方财富未查到 ${code} 的财报数据`);
  return rows.map((x) => ({
    stockCode: x.SECURITY_CODE,
    name: x.SECURITY_NAME_ABBR,
    reportPeriod: String(x.REPORTDATE || '').slice(0, 10),
    revenue: Number(x.TOTAL_OPERATE_INCOME),
    revenueYoy: x.YSTZ === null || x.YSTZ === undefined ? null : Number(x.YSTZ),
    netProfit: Number(x.PARENT_NETPROFIT),
    netProfitYoy: x.SJLTZ === null || x.SJLTZ === undefined ? null : Number(x.SJLTZ),
    eps: x.BASIC_EPS === null || x.BASIC_EPS === undefined ? null : Number(x.BASIC_EPS),
  }));
}

const yi = (n) => (n === null || Number.isNaN(n) ? null : `${(n / 1e8).toFixed(2)} 亿元`);
const pct = (n) => (n === null || Number.isNaN(n) ? null : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);

// 把某只股票的最近财报写入指定客户（按 客户+股票代码+报告期 去重）
export async function syncPartnerFinanceFromEastmoney(partnerId, stockCode, options = {}) {
  const periods = await fetchFinancePeriods(stockCode, options.size || 8);
  const latest = periods[0];
  const annual = periods.find((p) => p.reportPeriod.endsWith('12-31')) || null;
  const listedStatus = options.listedStatus || '母公司上市';

  const rows = [];
  for (const p of [latest, annual].filter(Boolean)) {
    const exists = await db.get(
      `SELECT id FROM partner_finance
        WHERE partner_id = ? AND stock_code = ? AND report_period = ? LIMIT 1`,
      [Number(partnerId), p.stockCode, p.reportPeriod],
    );
    if (exists) {
      rows.push({ reportPeriod: p.reportPeriod, skipped: true });
      continue;
    }
    await db.run(
      `INSERT INTO partner_finance
        (partner_id, src, stock_code, report_period, listed_status, rev_yoy, profit, detail_json, fetched_at, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(partnerId),
        // 口径必须写在来源里：合并报表含全部子公司，不等于该子公司单体数据
        listedStatus === '母公司上市' ? '东方财富·母公司合并口径' : '东方财富',
        p.stockCode,
        p.reportPeriod,
        listedStatus,
        pct(p.revenueYoy),
        yi(p.netProfit),
        JSON.stringify({
          name: p.name,
          revenue: p.revenue,
          revenueYoy: p.revenueYoy,
          netProfit: p.netProfit,
          netProfitYoy: p.netProfitYoy,
          eps: p.eps,
          // 合并口径：数据为上市公司合并报表，包含其全部子公司，不能等同于单个子公司
          consolidated: listedStatus === '母公司上市',
          note:
            listedStatus === '母公司上市'
              ? '上市公司合并报表口径（含全部子公司）；该子公司单体财务数据见年报「主要控股参股公司分析」章节'
              : null,
          source: 'eastmoney:RPT_LICO_FN_CPD',
          sourceUrl: `https://data.eastmoney.com/bbsj/yjbb/${p.stockCode}.html`,
        }),
        new Date(),
        'channel',
      ],
    );
    rows.push({
      reportPeriod: p.reportPeriod,
      revenueYuan: p.revenue,
      revenueYoy: p.revenueYoy,
      netProfitYuan: p.netProfit,
      netProfitYoy: p.netProfitYoy,
      skipped: false,
    });
  }

  return { stockCode: latest.stockCode, name: latest.name, listedStatus, items: rows };
}
