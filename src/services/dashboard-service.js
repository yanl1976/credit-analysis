import db from '../db.js';
import { listRiskEvents } from './risk-service.js';

function scopeSql(orgIds, alias = 'p') {
  if (Array.isArray(orgIds)) {
    if (!orgIds.length) return { sql: 'WHERE 1 = 0', params: [] };
    return {
      sql: `WHERE ${alias}.owner_org_id IN (${orgIds.map(() => '?').join(',')})`,
      params: orgIds.map(Number),
    };
  }
  return { sql: '', params: [] };
}

// 概览看板：客户/评分分布/维度数据量/近期预警/高风险客户
export async function getOverview({ orgIds = null } = {}) {
  const s = scopeSql(orgIds);

  const partnerRow = await db.get(`SELECT COUNT(*) AS c FROM partner p ${s.sql}`, s.params);
  const ratedRow = await db.get(
    `SELECT COUNT(*) AS c FROM partner_rating r JOIN partner p ON p.id = r.partner_id ${s.sql}`,
    s.params,
  );
  const scoreRow = await db.get(
    `SELECT AVG(r.score) AS avgScore, SUM(r.veto) AS vetoCount
       FROM partner_rating r JOIN partner p ON p.id = r.partner_id ${s.sql}`,
    s.params,
  );

  const gradeRows = await db.all(
    `SELECT r.grade AS grade, COUNT(*) AS c
       FROM partner_rating r JOIN partner p ON p.id = r.partner_id ${s.sql}
      GROUP BY r.grade`,
    s.params,
  );
  const riskRows = await db.all(
    `SELECT r.risk_level AS riskLevel, COUNT(*) AS c
       FROM partner_rating r JOIN partner p ON p.id = r.partner_id ${s.sql}
      GROUP BY r.risk_level`,
    s.params,
  );

  const dimRows = await db.all(
    `SELECT
       (SELECT COUNT(*) FROM partner_judicial j JOIN partner p ON p.id = j.partner_id ${s.sql}) AS judicial,
       (SELECT COUNT(*) FROM partner_credit c JOIN partner p ON p.id = c.partner_id ${s.sql}) AS credit,
       (SELECT COUNT(*) FROM partner_finance f JOIN partner p ON p.id = f.partner_id ${s.sql}) AS finance`,
    [...s.params, ...s.params, ...s.params],
  );

  const recent = await listRiskEvents({ orgIds, page: 1, pageSize: 8 });

  const topRisk = await db.all(
    `SELECT p.id AS partnerId, p.name, p.credit_code AS creditCode,
            r.score, r.grade, r.risk_level AS riskLevel, r.veto
       FROM partner_rating r JOIN partner p ON p.id = r.partner_id ${s.sql}
      ORDER BY r.veto DESC, r.score ASC
      LIMIT 5`,
    s.params,
  );

  const gradeOrder = ['AAA', 'AA', 'A', 'B', 'C', 'D'];
  const gradeMap = new Map(gradeRows.map((r) => [r.grade, Number(r.c || 0)]));
  const partnerCount = Number(partnerRow?.c || 0);
  const ratedCount = Number(ratedRow?.c || 0);

  return {
    partnerCount,
    ratedCount,
    unratedCount: Math.max(0, partnerCount - ratedCount),
    avgScore: scoreRow?.avgScore === null || scoreRow?.avgScore === undefined ? null : Number(Number(scoreRow.avgScore).toFixed(1)),
    vetoCount: Number(scoreRow?.vetoCount || 0),
    gradeDistribution: gradeOrder
      .filter((g) => gradeMap.has(g))
      .map((g) => ({ grade: g, count: gradeMap.get(g) })),
    riskDistribution: riskRows.map((r) => ({ riskLevel: r.riskLevel, count: Number(r.c || 0) })),
    dimensionTotals: {
      judicial: Number(dimRows?.[0]?.judicial || 0),
      credit: Number(dimRows?.[0]?.credit || 0),
      finance: Number(dimRows?.[0]?.finance || 0),
    },
    recentRiskEvents: recent.items,
    topRiskPartners: topRisk.map((r) => ({ ...r, veto: !!Number(r.veto), score: Number(r.score) })),
  };
}
