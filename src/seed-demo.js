import db from './db.js';
import { createTables } from './migrate.js';
import {
  createPartner,
  getPartner,
  deletePartner,
} from './services/partner-service.js';
import { saveJudicial, saveCredit, saveFinance } from './services/collect-service.js';
import { ratePartner, rateBatch } from './services/scoring-service.js';

// 演示数据：8 家典型客户覆盖 AAA/AA/A/D 与一票否决，并制造等级变化预警
// 用法：npm run seed:demo（可重复执行，会先清理旧演示客户）
const DEMO_CODE_PREFIX = '91310000DEMO';

const CUSTOMERS = [
  { code: '001', name: '华东精密机械有限公司', legal: '陈建国', reg: '存续', province: '江苏省', industry: '通用设备制造业' },
  { code: '002', name: '江南电子元件股份有限公司', legal: '李慧敏', reg: '存续', province: '浙江省', industry: '电子器件制造' },
  { code: '003', name: '北方重工装备制造有限公司', legal: '王振华', reg: '存续', province: '辽宁省', industry: '专用设备制造业' },
  { code: '004', name: '西南新材料科技有限公司', legal: '赵晓峰', reg: '存续', province: '四川省', industry: '化学原料和化学制品' },
  { code: '005', name: '东海建筑工程有限公司', legal: '孙德明', reg: '吊销', province: '福建省', industry: '房屋建筑业' },
  { code: '006', name: '中部物流服务有限公司', legal: '周立', reg: '存续', province: '湖北省', industry: '道路运输业' },
  { code: '007', name: '南岭食品加工有限公司', legal: '吴春燕', reg: '存续', province: '湖南省', industry: '食品制造业' },
  { code: '008', name: '西部能源投资集团有限公司', legal: '马长风', reg: '存续', province: '陕西省', industry: '电力热力生产' },
];

async function clearDemo() {
  const rows = await db.all('SELECT id FROM partner WHERE credit_code LIKE ?', [`${DEMO_CODE_PREFIX}%`]);
  for (const r of rows) await deletePartner(Number(r.id));
  return rows.length;
}

(async () => {
  try {
    await createTables();
    const removed = await clearDemo();

    // 1) 建档 + 基线评分（此时均无风险数据，除吊销客户外都是 AAA）
    const ids = {};
    for (const c of CUSTOMERS) {
      const p = await createPartner({
        ownerOrgId: 0,
        creditCode: `${DEMO_CODE_PREFIX}${c.code}`,
        name: c.name,
        legalPerson: c.legal,
        regStatus: c.reg,
        province: c.province,
        industry: c.industry,
      });
      ids[c.code] = p.id;
    }

    const org = await db.get("SELECT id FROM org WHERE org_type = 'GROUP' ORDER BY id LIMIT 1");
    if (org) {
      await db.run('UPDATE partner SET owner_org_id = ? WHERE credit_code LIKE ?', [org.id, `${DEMO_CODE_PREFIX}%`]);
    }
    await rateBatch({ partnerIds: Object.values(ids) });

    // 2) 写入各维度采集结果（模拟各渠道返回）
    await saveCredit(ids['002'], [
      { itemType: '行政处罚', authority: '市生态环境局', reason: '废水排放超标', penalty: '罚款 8 万元', date: '2026-03-12' },
      { itemType: '行政处罚', authority: '市市场监督管理局', reason: '产品标识不规范', penalty: '罚款 3 万元', date: '2026-06-25' },
    ]);

    await saveJudicial(ids['003'], [
      { caseType: '民事裁判', partyRole: '被告', caseNo: '(2026)辽01民初1123号', court: '沈阳市中级人民法院', amount: 3200000, status: '未结', date: '2026-02-18' },
      { caseType: '民事裁判', partyRole: '被告', caseNo: '(2026)辽01民初1456号', court: '沈阳市中级人民法院', amount: 860000, status: '未结', date: '2026-04-09' },
      { caseType: '民事裁判', partyRole: '被告', caseNo: '(2026)辽01民初1789号', court: '沈阳市中级人民法院', amount: 415000, status: '未结', date: '2026-07-21' },
    ]);
    await saveCredit(ids['003'], [
      { itemType: '经营异常', authority: '市市场监督管理局', reason: '通过登记的住所无法联系', date: '2026-05-30' },
    ]);

    await saveJudicial(ids['004'], [
      { caseType: '失信被执行人', partyRole: '被告', caseNo: '(2026)川01执2245号', court: '成都市中级人民法院', amount: 5800000, status: '未结', date: '2025-11-06' },
    ]);

    await saveJudicial(ids['006'], [
      { caseType: '执行案件', partyRole: '被告', caseNo: '(2026)鄂01执887号', court: '武汉市中级人民法院', amount: 1500000, status: '未结', date: '2026-01-15' },
    ]);
    await saveCredit(ids['006'], [
      { itemType: '严重违法失信', authority: '市交通运输局', reason: '超限运输被列入严重违法失信名单', date: '2026-04-02' },
    ]);

    await saveFinance(ids['007'], [
      { src: '工商年报', scaleTag: '小微企业', employeeCnt: 46, revYoy: -0.08, profit: 1200000 },
    ]);

    await saveJudicial(ids['008'], [
      { caseType: '执行案件', partyRole: '被告', caseNo: '(2026)陕01执331号', court: '西安市中级人民法院', amount: 600000, status: '未结', date: '2026-02-27' },
      { caseType: '执行案件', partyRole: '被告', caseNo: '(2026)陕01执412号', court: '西安市中级人民法院', amount: 120000, status: '已结', date: '2026-05-14' },
    ]);
    await saveCredit(ids['008'], [
      { itemType: '税收违法', authority: '国家税务总局西安市税务局', reason: '虚开增值税专用发票', penalty: '追缴税款并处罚款', date: '2026-03-08' },
    ]);

    // 3) 重算：等级变化会写入 risk_event，供预警中心展示
    const batch = await rateBatch({ partnerIds: Object.values(ids) });

    console.log(`[seed-demo] 清理旧演示客户 ${removed} 个，重算 ${batch.total} 个，等级变化 ${batch.gradeChanged} 个`);
    const rows = await db.all(
      `SELECT p.name, r.score, r.grade, r.risk_level, r.veto
         FROM partner p LEFT JOIN partner_rating r ON r.partner_id = p.id
        WHERE p.credit_code LIKE ? ORDER BY p.id`,
      [`${DEMO_CODE_PREFIX}%`],
    );
    for (const r of rows) {
      console.log(`  ${r.name}  ${r.score} 分  ${r.grade}  风险=${r.risk_level}${Number(r.veto) ? '  [一票否决]' : ''}`);
    }
    const ev = await db.get('SELECT COUNT(*) AS c FROM risk_event');
    console.log(`[seed-demo] 预警事件合计 ${ev.c} 条`);
    process.exit(0);
  } catch (e) {
    console.error('[seed-demo] 失败:', e.message);
    process.exit(1);
  }
})();
