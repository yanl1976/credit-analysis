import { BaseConnector } from './base-connector.js';
import { QccMcpClient, QCC_DOMAINS, QCC_DOMAIN_DIMENSION } from './qcc-mcp-client.js';
import { reasonOfException } from './error-codes.js';

// 企查查 Connector：包装企查查官方 MCP（按业务域拆分 endpoint，共用 Token）。
// 配置驱动：未配置 Token 或开关关闭时由 registry 自动跳过（isConfigured）。
// 工具名/字段映射需在有效 Token 联调 tools/list 后精修；此处用启发式兜底，保证不阻塞采集流程。
//
// 多域采集（经营风险/司法）：默认关闭（channel.qcc.riskDomains=false），开启后 fetchDetail
// 会额外调用 legal-case / risk / regulation 三个域，抽取 judicial/credit 维度，并把每个域的
// 原始响应放进 result.rawByDomain（随主 saveRaw 落库），便于日后离线校准而无需重复查询。

const DOMAIN_DIMENSION = QCC_DOMAIN_DIMENSION;

export class QccConnector extends BaseConnector {
  constructor(cfg = {}) {
    const base = cfg.base || 'https://agent.qcc.com/mcp';
    const apiKey = cfg.apiKey || '';
    const enabled = cfg.enabled !== false && Boolean(apiKey);
    super({
      ...cfg,
      key: 'qcc',
      name: '企查查',
      enabled,
      apiKey,
      base,
      requiresAuth: true,
      capabilities: QCC_DOMAINS.map((d) => DOMAIN_DIMENSION[d] || d),
    });
    this.base = base;
    this.token = apiKey;
    this.riskDomains = Boolean(cfg.riskDomains);
    this._clients = new Map();
  }

  _client(domain) {
    let c = this._clients.get(domain);
    if (!c) {
      c = new QccMcpClient({ base: this.base, token: this.token, domain });
      this._clients.set(domain, c);
    }
    return c;
  }

  async _ensure(domain) {
    const c = this._client(domain);
    if (!c.sessionId) await c.connect();
    return c;
  }

  async listTools(domain) {
    const c = await this._ensure(domain);
    return c.listTools();
  }

  async callTool(domain, name, args = {}) {
    const c = await this._ensure(domain);
    return c.callTool(name, args);
  }

  _pickSearchTool(tools, keyword) {
    const score = (t) => {
      const n = String(t.name || '').toLowerCase();
      const d = String(t.description || '').toLowerCase();
      let s = 0;
      if (/search|searchcompany|companysearch|企业搜索|查企业/.test(`${n} ${d}`)) s += 5;
      if (/工商|企业名称|公司名称/.test(d)) s += 3;
      if (/company|企业|公司/.test(n)) s += 2;
      return s;
    };
    return (
      tools
        .map((t) => ({ t, s: score(t) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)[0]?.t || null
    );
  }

  _pickDetailTool(tools) {
    const score = (t) => {
      const n = String(t.name || '').toLowerCase();
      const d = String(t.description || '').toLowerCase();
      let s = 0;
      if (/detail|info|baseinfo|basic|基本信息|工商信息|企业详情/.test(`${n} ${d}`)) s += 5;
      if (/company|企业|公司/.test(n)) s += 2;
      return s;
    };
    return (
      tools
        .map((t) => ({ t, s: score(t) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)[0]?.t || null
    );
  }

  // 按工具 inputSchema 的实际参数名，挑第一个匹配的候选入参；无匹配则用首个参数兜底
  _argsFor(tool, candidates) {
    const props = tool?.inputSchema?.properties || {};
    const keys = Object.keys(props);
    for (const [k, v] of Object.entries(candidates)) {
      if (keys.includes(k)) return { [k]: v };
    }
    const firstKey = keys[0];
    if (firstKey) return { [firstKey]: Object.values(candidates)[0] };
    return candidates;
  }

  _extractText(res) {
    if (!res) return '';
    if (typeof res === 'string') return res;
    if (Array.isArray(res)) return res.map((c) => (c?.text ? c.text : '')).join('\n');
    if (res.structuredContent) {
      return typeof res.structuredContent === 'string'
        ? res.structuredContent
        : JSON.stringify(res.structuredContent);
    }
    if (res.content) return this._extractText(res.content);
    return JSON.stringify(res);
  }

  // 宽松抽取工商基础字段（企查查字段名待联调后精修）
  _mapBasic(obj = {}) {
    const get = (...keys) => {
      for (const k of keys) {
        const v = obj[k];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };
    return {
      name: get('名称', '企业名称', '公司名称', 'name', 'companyName'),
      creditCode: get('统一社会信用代码', '信用代码', 'creditCode', 'unifiedSocialCreditCode'),
      legalPerson: get('法定代表人', '法人', 'legalPerson', 'legalRepresentative', 'operName'),
      regStatus: get('登记状态', '经营状态', 'status', 'regStatus'),
      regCapital: get('注册资本', '注册资金', 'regCapital', 'registCapi'),
      foundDate: get('成立日期', '成立时间', 'foundDate', 'estiblishTime'),
      province: get('省份', '省', 'province'),
      industry: get('行业', '行业门类', 'industry', 'industryName'),
    };
  }

  _num(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(String(v).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  // 从工具返回文本里抽取条目数组：优先业务中文键（裁判文书/行政处罚/经营异常…），再兜底通用键
  _extractItems(text, keys = []) {
    try {
      const obj = JSON.parse(text);
      const findArr = (o) => {
        if (Array.isArray(o)) return o;
        if (o && typeof o === 'object') {
          for (const k of keys) if (Array.isArray(o[k])) return o[k];
          for (const k of ['list', 'items', 'data', 'results', 'records', 'rows']) {
            if (Array.isArray(o[k])) return o[k];
            if (o[k] && Array.isArray(o[k].list)) return o[k].list;
            if (o[k] && Array.isArray(o[k].items)) return o[k].items;
          }
        }
        return null;
      };
      return findArr(obj) || findArr(obj?.data) || findArr(obj?.result) || [];
    } catch {
      return [];
    }
  }

  _courtFrom(it) {
    const s = String(it?.['裁判结果'] || '');
    const m = s.match(/([\u4e00-\u9fa5]{2,30}人民法院)/);
    if (!m) return undefined;
    const cleaned = m[1].replace(
      /^(?:终结|维持|驳回|撤销|改判|判决|裁定|执行|中止|恢复|移送|指定|追加|变更|解除|确认|支持|不予受理|不予|依法|经|由|本院|向|在|至|对|将|已|现|该)+/,
      '',
    );
    return cleaned || undefined;
  }

  _mapJudicialItems(items = [], selfName) {
    const get = (o, ...ks) => {
      for (const k of ks) {
        const v = o?.[k];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };
    const pickParty = (parties, ...keys) => {
      for (const k of keys) {
        const v = parties?.[k];
        if (Array.isArray(v) && v.length) return v;
        if (typeof v === 'string' && v) return [v];
      }
      return [];
    };
    return items
      .map((it) => {
        const parties = it?.['当事人'] || it?.['当事人信息'] || {};
        const plaintiff = pickParty(parties, '原告', '申请执行人', '上诉人', '申请人', '起诉人');
        const defendant = pickParty(parties, '被告', '被执行人', '被上诉人', '被申请人', '被起诉人');
        return {
          caseType: get(it, '案由', '案件类型', '案件性质', 'caseType', 'type'),
          partyRole: this._roleOf(selfName, parties) || get(it, '身份', '当事人角色', 'partyRole', 'role'),
          plaintiff: plaintiff.length ? plaintiff.join('、') : null,
          defendant: defendant.length ? defendant.join('、') : null,
          docTitle: get(it, '文书标题', '标题', 'docTitle'),
          judgeResult: get(it, '裁判结果', '判决结果', 'judgeResult'),
          caseNo: get(it, '案号', '案件编号', 'caseNo', 'docId', '文书ID'),
          court: get(it, '法院', '审理法院', 'court') || this._courtFrom(it),
          amount: this._num(get(it, '案件金额', '涉案金额', '标的额', 'amount', 'money')),
          status: get(it, '状态', '审理状态', 'status'),
          date: get(it, '裁判日期', '发布日期', '立案日期', '日期', 'date', '时间'),
          detail: it,
        };
      })
      .filter((x) => x.caseNo || x.court || x.detail);
  }

  // 判断本企业在案件中的角色（原告/被告/申请执行人/被执行人…）
  _roleOf(selfName, parties = {}) {
    const name = String(selfName || '').trim();
    if (!name) return undefined;
    const hit = (arr) =>
      Array.isArray(arr) && arr.some((x) => String(x).includes(name) || name.includes(String(x)));
    const order = [
      ['原告', '原告'],
      ['被告', '被告'],
      ['申请执行人', '申请执行人'],
      ['被执行人', '被执行人'],
      ['上诉人', '上诉人'],
      ['被上诉人', '被上诉人'],
      ['申请人', '申请人'],
      ['被申请人', '被申请人'],
      ['起诉人', '起诉人'],
      ['被起诉人', '被起诉人'],
    ];
    for (const [key, label] of order) if (hit(parties[key])) return label;
    return undefined;
  }

  _mapCreditItems(items = [], itemType) {
    const get = (o, ...ks) => {
      for (const k of ks) {
        const v = o?.[k];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };
    return items
      .map((it) => ({
        itemType: itemType || get(it, '类型', 'itemType') || '经营风险',
        authority: get(it, '处罚机关', '决定机关', '列入机关', 'authority', '机关'),
        reason: get(it, '违法事实', '违法行为', '列入原因', '事由', 'reason', 'description'),
        penalty: get(it, '处罚内容', '处罚结果', '处罚金额', 'penalty'),
        date: get(it, '处罚日期', '列入日期', '移出日期', '日期', 'date'),
        detail: it,
      }))
      .filter((x) => x.reason || x.authority || x.detail);
  }

  // 额外采集经营风险 / 司法明细（默认关闭）。工具名基于企查查 risk 域真实清单，
  // 用 searchKey（企业名称或信用代码）传参；单工具失败不影响其余，原始响应一并返回以便校准。
  async _collectRiskDomains(name, creditCode) {
    const out = { judicial: [], credit: [], rawByDomain: {} };
    const searchKey = creditCode || name;
    const specs = [
      { tool: 'get_administrative_penalty', kind: 'credit', itemType: '行政处罚', keys: ['行政处罚', '处罚记录'] },
      { tool: 'get_business_exception', kind: 'credit', itemType: '经营异常', keys: ['经营异常', '异常记录'] },
      { tool: 'get_judicial_documents', kind: 'judicial', keys: ['裁判文书', '文书'] },
    ];
    for (const spec of specs) {
      try {
        const res = await this.callTool('risk', spec.tool, { searchKey });
        const text = this._extractText(res);
        out.rawByDomain[spec.tool] = text;
        const items = this._extractItems(text, spec.keys);
        if (spec.kind === 'judicial') out.judicial.push(...this._mapJudicialItems(items, name));
        else out.credit.push(...this._mapCreditItems(items, spec.itemType));
      } catch {
        // 单个工具失败（未开通/超时）不影响其余与工商基础采集
      }
    }
    return out;
  }

  // 企查查工商登记 → 与天眼查 pickRegistration 对齐的统一结构
  _mapRegistration(d = {}) {
    const g = (...ks) => {
      for (const k of ks) {
        const v = d?.[k];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return null;
    };
    const industry = d?.['国标行业'] || {};
    const district = d?.['地区信息'] || {};
    const term = String(g('营业期限') || '');
    const [fromTime, toTime] = term.split('至');
    const industrySmall = industry['小类'] || industry['中类'] || null;
    return {
      name: g('企业名称'),
      creditCode: g('统一社会信用代码'),
      regStatus: g('登记状态'),
      legalPersonName: g('法定代表人'),
      companyOrgType: g('企业类型'),
      regCapital: g('注册资本'),
      actualCapital: g('实缴资本'),
      estiblishTime: g('成立日期'),
      fromTime: fromTime || null,
      toTime: toTime || null,
      approvedTime: g('核准日期'),
      regInstitute: g('登记机关'),
      regLocation: g('注册地址'),
      industry: industry['门类'] || null,
      industrySmall,
      // 兼容天眼查 pickRegistration 对 industrySmall 的读取口径
      industryAll: { categorySmall: industrySmall },
      city: district['城市'] || null,
      district: district['区域'] || null,
      socialStaffNum: this._num(g('参保人数')),
      staffNumRange: g('人员规模'),
      tags: [],
      historyNames: [],
      businessScope: g('经营范围'),
      percentileScore: null,
    };
  }

  // 采集企业画像（工商登记 + 企业简介）：默认开启，供画像页与天眼查共用
  async _collectProfile(searchKey) {
    const out = { registration: null, profile: null, raw: {} };
    if (!searchKey) return out;
    try {
      const res = await this.callTool('company', 'get_company_registration_info', { searchKey });
      const text = this._extractText(res);
      out.raw.registration = text;
      const obj = JSON.parse(text);
      out.registration = this._mapRegistration(obj?.data ?? obj?.result ?? obj);
    } catch {
      // 未开通/超时：画像缺失不影响工商基础与风险维度采集
    }
    try {
      const res = await this.callTool('company', 'get_company_profile', { searchKey });
      const text = this._extractText(res);
      out.raw.profile = text;
      const obj = JSON.parse(text);
      const d = obj?.data ?? obj?.result ?? obj;
      out.profile = {
        profile: d?.['简介'] || null,
        industry: d?.['企查查行业'] || null,
        scale: d?.['企业规模'] || null,
        mainProducts: d?.['主营产品'] || [],
        industryChain: d?.['产业链概览'] || null,
      };
    } catch {
      // 同上
    }
    return out;
  }

  _adapt(res, mode) {
    const text = this._extractText(res);
    let normalized = { basic: {} };
    try {
      const obj = JSON.parse(text);
      const data = obj?.data ?? obj?.result ?? obj;
      normalized.basic = this._mapBasic(data);
    } catch {
      normalized = { raw: text };
    }
    return { ok: true, mode: `qcc-${mode}`, normalized, meta: { match: { matched: true } } };
  }

  async search(keyword, partner = {}) {
    if (!this.isConfigured()) {
      return { ok: false, reasonCode: 'NOT_CONFIGURED', reason: '未配置企查查 MCP Token' };
    }
    try {
      const tools = await this.listTools('company');
      const tool = this._pickSearchTool(tools, keyword) || tools[0];
      if (!tool) return { ok: false, reasonCode: 'ENTITLEMENT', reason: '企查查 MCP 未返回可用工具' };
      const args = this._argsFor(tool, {
        keyword,
        '企业名称': keyword,
        '名称': keyword,
        q: keyword,
        companyName: keyword,
      });
      const res = await this.callTool('company', tool.name, args);
      return this._adapt(res, 'search');
    } catch (e) {
      return { ok: false, reasonCode: reasonOfException(e), reason: e.message };
    }
  }

  async fetchDetail(creditCode, partner = {}) {
    if (!this.isConfigured()) {
      return { ok: false, reasonCode: 'NOT_CONFIGURED', reason: '未配置企查查 MCP Token' };
    }
    try {
      const tools = await this.listTools('company');
      const tool = this._pickDetailTool(tools) || tools[0];
      if (!tool) return { ok: false, reasonCode: 'ENTITLEMENT', reason: '企查查 MCP 未返回可用工具' };
      const args = this._argsFor(tool, {
        creditCode,
        '统一社会信用代码': creditCode,
        '信用代码': creditCode,
        keyword: partner?.name,
        '企业名称': partner?.name,
      });
      const res = await this.callTool('company', tool.name, args);
      const adapted = this._adapt(res, 'detail');
      // 企业画像（工商登记 + 简介）：与天眼查共用同一结构与存储约定
      const prof = await this._collectProfile(creditCode || partner?.name);
      adapted.profileDoc = { registration: prof.registration, profile: prof.profile };
      adapted.rawProfile = prof.raw;
      if (this.riskDomains) {
        const name = adapted.normalized?.basic?.name || partner?.name;
        const risk = await this._collectRiskDomains(name, creditCode);
        adapted.normalized.judicial = risk.judicial;
        adapted.normalized.credit = risk.credit;
        adapted.rawByDomain = risk.rawByDomain;
      }
      return adapted;
    } catch (e) {
      return { ok: false, reasonCode: reasonOfException(e), reason: e.message };
    }
  }
}
