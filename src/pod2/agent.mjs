import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cnNumber } from '../pod1/preprocess.mjs';
import { kbEntry, retrieve } from './kb.mjs';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

export const SEVERITY_SCORE = { high: 3.5, mid: 2, low: 1 };

export function loadRules() {
  return JSON.parse(fs.readFileSync(path.join(DATA, 'risk_rules.json'), 'utf8'));
}

function pick(flow, patterns, cast = (s) => cnNumber(s)) {
  for (const re of patterns) {
    const match = flow.match(re);
    if (!match) continue;
    const value = cast(match[1]);
    if (value === null || value === undefined || Number.isNaN(value)) continue;
    return { value, raw: match[0].trim(), index: match.index, length: match[0].length };
  }
  return null;
}

const money = (s) => Number(String(s).replace(/[,.]/g, (c) => (c === ',' && String(s).length > 6 ? '' : c)));

export function extractFacts(flow) {
  const monthlyRent = pick(flow, [/月租金[^0-9]{0,10}([0-9][0-9,.]*)\s*元/, /租金每月[^0-9]{0,8}([0-9][0-9,.]*)\s*元/, /每月[仅]?([0-9]{3,6})\s*元/], money);
  const depositAmount = pick(flow, [/押金(?:(?!月租金|租金)[^0-9]){0,12}([0-9][0-9,.]*)\s*元/, /保证金[^0-9]{0,12}([0-9][0-9,.]*)\s*元/], money);
  const prepay = pick(flow, [/押\s*([0-9一二三四五六七八九十两]+)\s*付\s*([0-9一二三四五六七八九十两半]+)/]);
  let depositMonths = prepay ? cnNumber(prepay.raw.match(/押\s*([0-9一二三四五六七八九十两]+)/)[1]) : null;
  let prepaidMonths = prepay ? (/[半]$/.test(prepay.raw) ? 6 : cnNumber(prepay.raw.match(/付\s*([0-9一二三四五六七八九十两半]+)/)[1])) : null;
  const prepaidLong = pick(flow, [/一次性支付\s*(全年|一年|半年|[0-9一二三四五六七八九十]+)\s*个月?租金/]);
  if (prepaidMonths === null && prepaidLong) {
    const word = prepaidLong.raw.replace(/一次性支付|个月租金|\s/g, '');
    prepaidMonths = word === '全年' || word === '一年' ? 12 : word === '半年' ? 6 : cnNumber(word);
  }
  const prepaidFact = prepaidMonths !== null ? { value: prepaidMonths, raw: (prepay || prepaidLong || {}).raw, index: (prepay || prepaidLong || {}).index, length: (prepay || prepaidLong || {}).length } : null;
  const depositMonthsFact = depositMonths !== null ? { value: depositMonths, raw: prepay ? prepay.raw : depositAmount.raw, index: prepay ? prepay.index : depositAmount.index, length: prepay ? prepay.length : depositAmount.length } : null;
  const leaseYears = pick(flow, [/租赁期(?:限)?[共计]*\s*([0-9]+|[一二三四五六七八九十两]+)\s*年/, /租期[共计]*\s*([0-9]+|[一二三四五六七八九十两]+)\s*年/]);
  const penaltyDaily = (() => {
    const pct = pick(flow, [/每逾期一日[^0-9%]{0,20}百分之\s*([0-9.]+)/, /每逾期一日[^0-9%]{0,24}?([0-9.]+)\s*%/], (v) => Number(v) / 100);
    if (pct) return pct;
    return pick(flow, [/每逾期一日[^0-9%]{0,24}万分之\s*([0-9一二三四五六七八九十]+)/], (v) => (cnNumber(v) || 0) / 10000);
  })();
  const landlordDaily = pick(flow, [/甲方[^。；]{0,16}(?:每日|按日|每逾期一日)[^0-9]{0,12}([0-9.]+)\s*元/], money);
  const elecPrice = pick(flow, [/电费[^0-9]{0,14}([0-9.]+)\s*元\s*[./]\s*(?:度|千瓦时|kWh)/, /电[^0-9]{0,8}([0-9.]+)\s*元\s*[./]\s*度/], money);
  const depositValue = depositMonths !== null && monthlyRent ? monthlyRent.value * depositMonths : depositAmount ? depositAmount.value : null;
  return {
    monthlyRent: monthlyRent ? monthlyRent.value : null,
    deposit: depositValue,
    depositMonths,
    prepaidMonths,
    leaseYears: leaseYears ? leaseYears.value : null,
    penaltyDailyRate: penaltyDaily ? penaltyDaily.value : null,
    penaltyDailyAmount: penaltyDaily && monthlyRent ? Number((penaltyDaily.value * monthlyRent.value).toFixed(2)) : null,
    landlordDailyAmount: landlordDaily ? landlordDaily.value : null,
    elecPrice: elecPrice ? elecPrice.value : null,
    elecMarkupRatio: elecPrice ? Number((elecPrice.value / 0.65).toFixed(2)) : null,
    _raw: { monthlyRent, depositAmount, prepay, prepaidFact, depositMonthsFact, leaseYears, penaltyDaily, landlordDaily, elecPrice }
  };
}

function clauseAt(clauses, textOffset) {
  return clauses.find((c) => textOffset >= c.start && textOffset < c.end) || clauses[0];
}

function span(flow, map, clauses, fact) {
  if (!fact || fact.index === undefined) return null;
  const start = map[fact.index];
  const end = map[Math.min(fact.index + fact.length, map.length - 1)];
  return { clause: clauseAt(clauses, start), start, end, evidence: clip(fact.raw) };
}

function clip(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > 200 ? clean.slice(0, 200) + '…' : clean;
}

export function evidenceFor(clause, snippet) {
  return clip(snippet || clause?.body);
}

export function locate(text, flow, map, clause, snippet) {
  const needle = clip(snippet);
  const at = needle ? flow.indexOf(needle) : -1;
  if (at >= 0) return { start: map[at], end: map[Math.min(at + needle.length, map.length - 1)] };
  const direct = needle ? text.indexOf(needle) : -1;
  if (direct >= 0) return { start: direct, end: direct + needle.length };
  return { start: clause?.start ?? 0, end: clause?.end ?? 0 };
}

function evaluateCheck(kind, params, facts) {
  switch (kind) {
    case 'deposit_months':
      return facts.depositMonths !== null && facts.depositMonths > params.maxMonths ? { fact: facts._raw.depositMonthsFact, display: { deposit_months: facts.depositMonths, deposit_amount: facts.deposit } } : null;
    case 'prepaid_rent_months':
      return facts.prepaidMonths !== null && facts.prepaidMonths > params.maxMonths ? { fact: facts._raw.prepaidFact, display: { prepaid_months: facts.prepaidMonths, prepaid_amount: facts.monthlyRent ? facts.monthlyRent * facts.prepaidMonths : null } } : null;
    case 'lease_years':
      return facts.leaseYears !== null && facts.leaseYears > params.maxYears ? { fact: facts._raw.leaseYears, display: { lease_years: facts.leaseYears } } : null;
    case 'penalty_daily_rate':
      return facts.penaltyDailyRate !== null && facts.penaltyDailyRate > params.maxRate ? { fact: facts._raw.penaltyDaily, display: { penalty_daily_pct: (facts.penaltyDailyRate * 100).toFixed(1), penalty_annual_pct: Math.round(facts.penaltyDailyRate * 365 * 100) + '%' } } : null;
    case 'electricity_markup':
      return facts.elecPrice !== null && facts.elecMarkupRatio > params.maxRatio ? { fact: facts._raw.elecPrice, display: { elec_price: facts.elecPrice, elec_markup_pct: Math.round((facts.elecMarkupRatio - 1) * 100) + '%' } } : null;
    case 'penalty_asymmetry': {
      if (!facts.landlordDailyAmount || !facts.penaltyDailyAmount) return null;
      const ratio = facts.penaltyDailyAmount / facts.landlordDailyAmount;
      return ratio >= 4 ? { fact: facts._raw.landlordDaily, display: { ratio: Math.round(ratio) } } : null;
    }
    default:
      return null;
  }
}

function missingClauses(rule, text, clauses) {
  return rule.required
    .filter((item) => !new RegExp(item.hint, 'i').test(text))
    .map((item) => ({ clause: clauses[clauses.length - 1], item }));
}

function fill(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => (values[key] === undefined || values[key] === null ? '（未识别）' : String(values[key])));
}

const RETRIEVE_MIN_SCORE = 20;

function cite(rule, clause) {
  const declared = (rule.kb || []).map((id) => ({ via: 'rule', entry: kbEntry(id) })).filter((c) => c.entry);
  const declaredIds = new Set(declared.map((d) => d.entry.id));
  const topics = new Set(declared.flatMap((d) => d.entry.tags || []));
  // 检索补充只在「主题标签一致 + 相关度达标」时并入，避免把法条清单变成噪声列表。
  const retrieved = retrieve(String(clause?.body || '').slice(0, 400), 5)
    .filter((hit) => !declaredIds.has(hit.entry.id))
    .filter((hit) => hit.score >= RETRIEVE_MIN_SCORE)
    .filter((hit) => declared.length === 0 || (hit.entry.tags || []).some((tag) => topics.has(tag)))
    .slice(0, 2)
    .map((hit) => ({ via: 'bm25', score: hit.score, entry: hit.entry }));
  return [...declared, ...retrieved];
}

export function analyze({ text, flow, map, clauses }) {
  const doc = loadRules();
  const facts = extractFacts(flow);
  const findings = [];

  const structured = /第\s*[0-9一二三四五六七八九十百两]{1,6}\s*条/.test(text) || clauses.length >= 4;
  const shortDoc = text.replace(/\s/g, '').length < 400;
  for (const rule of doc.rules) {
    if (rule.check?.type === 'missing_required_clause') {
      if (!structured || shortDoc) continue;
      for (const miss of missingClauses(rule, text, clauses)) {
        findings.push(make(rule, miss.clause, { start: miss.clause.start, end: miss.clause.end, evidence: '（全文未见与「' + miss.item.label + '」对应的约定）' }, text, flow, map, { note: '缺失项：' + miss.item.label }));
      }
      continue;
    }
    if (rule.check) {
      const result = evaluateCheck(rule.check.type, rule.check, facts);
      if (result) {
        const located = span(flow, map, clauses, result.fact);
        if (located) findings.push(make(rule, located.clause, located, text, flow, map, result.display));
      }
      continue;
    }
    const perClause = new Map();
    for (const source of rule.patterns || []) {
      const re = new RegExp(source, 'gi');
      let match;
      let guard = 0;
      while ((match = re.exec(flow)) && guard++ < 60) {
        const start = map[match.index];
        const end = map[Math.min(match.index + match[0].length, map.length - 1)];
        const clause = clauseAt(clauses, start);
        const key = clause.id;
        const prev = perClause.get(key);
        if (!prev || match[0].length > prev.raw.length) perClause.set(key, { clause, start, end, raw: match[0] });
      }
    }
    for (const item of perClause.values()) {
      findings.push(make(rule, item.clause, { start: item.start, end: item.end, evidence: clip(item.raw) }, text, flow, map));
    }
  }

  findings.sort((a, b) => a.start - b.start || b.severity.localeCompare(a.severity));
  const score = Number(findings.reduce((sum, f) => sum + (SEVERITY_SCORE[f.severity] || 1), 0).toFixed(1));
  return { findings, facts, score, grade: grade(score, findings) };
}

function make(rule, clause, located, text, flow, map, display = {}) {
  return {
    id: rule.id + '@' + located.start,
    ruleId: rule.id,
    name: rule.name,
    category: rule.category,
    severity: rule.severity,
    clauseId: clause.id,
    clauseHeading: clause.heading,
    start: located.start,
    end: located.end,
    evidence: located.evidence,
    plain: fill(rule.plain, display),
    why: rule.why,
    fix: rule.fix,
    citations: cite(rule, clause),
    source: 'rules'
  };
}

function grade(score, findings) {
  const high = findings.filter((f) => f.severity === 'high').length;
  if (high >= 4 || score >= 20) return { level: 'D', label: '高风险：不建议直接签署', color: '#c0392b' };
  if (high >= 2 || score >= 12) return { level: 'C', label: '中高风险：需重点改条款后再签', color: '#e67e22' };
  if (score >= 5) return { level: 'B', label: '中风险：有若干需要澄清的条款', color: '#b8860b' };
  return { level: 'A', label: '低风险：整体较为规范', color: '#27ae60' };
}

export function buildFlow(text) {
  const map = [];
  let flow = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\n') {
      const prev = text[i - 1] || '';
      const next = text[i + 1] || '';
      const hardBreak = prev === '\n' || next === '\n';
      const sentenceEnd = /[。；！？：;!?]$/.test(flow);
      if (hardBreak || sentenceEnd || flow.length === 0) {
        if (!flow.endsWith(' ')) {
          flow += ' ';
          map.push(i);
        }
        continue;
      }
      continue;
    }
    flow += ch;
    map.push(i);
  }
  map.push(text.length);
  return { flow, map };
}
