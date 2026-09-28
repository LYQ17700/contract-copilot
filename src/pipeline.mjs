import { parseDocument } from './pod1/parse.mjs';
import { buildFlow, analyze, loadRules, locate, evidenceFor, SEVERITY_SCORE } from './pod2/agent.mjs';
import { verify, maskPii, audit, saveArtifact } from './pod2/trust.mjs';
import { buildReport } from './pod2/report.mjs';
import { enrich, llmConfig } from './pod2/llm.mjs';
import { kbMeta } from './pod2/kb.mjs';

function newRunId() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 7);
}

export async function review({ buffer, filename, rawText }) {
  const stages = [];
  const runId = newRunId();
  const mark = async (name, owner, fn) => {
    const t0 = Date.now();
    const value = await fn();
    stages.push({ name, owner, ms: Date.now() - t0 });
    return value;
  };

  const doc = await mark('接收文件 / 提取文字', 'Pod1 · 后端工程师A+B', () => parseDocument({ buffer, filename, rawText }));
  const { flow, map } = await mark('文本预处理 / 条款切分', 'Pod1 · 后端工程师B', async () => buildFlow(doc.text));
  const ruleResult = await mark('关键条款抽取 + 风险识别', 'Pod2 · 提示词&Agent开发', async () => analyze({ text: doc.text, flow, map, clauses: doc.clauses }));

  let findings = ruleResult.findings;
  const llm = await mark('大模型补充审查（可选）', 'Pod2 · 提示词&Agent开发', () => enrich({ clauses: doc.clauses, facts: ruleResult.facts, kbIds: findings.flatMap((f) => f.citations.map((c) => c.entry.id)) }));
  if (llm.added.length) {
    const clausesById = new Map(doc.clauses.map((c) => [c.id, c]));
    const extra = [];
    for (const item of llm.added) {
      const clause = clausesById.get(item.clauseId) || doc.clauses[0];
      const at = flow.indexOf(evidenceFor(clause, item.evidence, doc.text));
      if (at < 0) {
        extra.push({ ...item, clauseId: clause?.id, clauseHeading: clause?.heading, start: clause?.start ?? 0, end: clause?.end ?? 0, evidence: item.evidence });
        continue;
      }
      const span = locate(doc.text, flow, map, clause, item.evidence);
      const overlap = findings.some((f) => Math.min(f.end, span.end) - Math.max(f.start, span.start) > 12);
      if (overlap) continue;
      extra.push({ ...item, clauseId: clause?.id, clauseHeading: clause?.heading, ...span, evidence: evidenceFor(clause, item.evidence, doc.text) });
    }
    findings = [...findings, ...extra];
  }
  findings.sort((a, b) => a.start - b.start);

  const trust = await mark('可信校验（原文+法条双引用）', 'Pod2 · 可信校验&隐私专员', async () => verify({ findings, text: doc.text, facts: ruleResult.facts }));
  const score = Number(trust.findings.reduce((sum, f) => sum + (SEVERITY_SCORE[f.severity] || 1), 0).toFixed(1));
  const looksLikeLease = /租赁|出租|承租|押金|租金|房屋/.test(doc.text);
  const grade = looksLikeLease
    ? ruleResult.grade
    : { level: '?', label: '未识别为住房租赁合同（缺少租赁/租金/押金等要素）', color: '#6b7789' };
  const structured = /第\s*[0-9一二三四五六七八九十百两]{1,6}\s*条/.test(doc.text) || doc.clauses.length >= 4;
  const notices = [...doc.notices, llm.notice];
  if (!structured || doc.text.replace(/\s/g, '').length < 400) {
    notices.push('未识别到租赁合同的条款结构（缺少「第×条」等编号或正文过短），已跳过「必备条款完整性」检查，避免对非合同文本产生误报。');
  }
  notices.push('结果基于规则库 + 法条检索，规则命中仅代表「值得核对」，不构成法律结论。');
  notices.filter(Boolean);
  const assembled = await mark('生成避坑报告', 'Pod2 · 报告生成工程师', async () =>
    buildReport({
      document: doc,
      findings: trust.findings,
      stats: { ...trust.stats, score: looksLikeLease ? score : 0, ruleCount: loadRules().rules.length, model: llm.model },
      facts: ruleResult.facts,
      grade,
      notices
    })
  );

  const payload = {
    runId,
    document: { filename: doc.filename, engine: doc.engine, charset: doc.charset, pageCount: doc.pageCount, chars: doc.text.length, clauses: doc.clauses, text: maskPii(doc.text) },
    findings: trust.findings.map((f) => ({ ...f, evidence: maskPii(f.evidence), plain: maskPii(f.plain) })),
    facts: ruleResult.facts,
    grade,
    score: looksLikeLease ? score : 0,
    stats: { ...trust.stats, score: looksLikeLease ? score : 0 },
    notices,
    stages,
    knowledge: kbMeta(),
    report: assembled.markdown
  };
  saveArtifact(runId + '.report.md', assembled.markdown);
  saveArtifact(runId + '.result.json', JSON.stringify(payload, null, 2));
  audit({
    runId,
    filename: doc.filename,
    engine: doc.engine,
    chars: doc.text.length,
    clauses: doc.clauses.length,
    findings: payload.stats.total,
    verified: payload.stats.verified,
    needsReview: payload.stats.needsReview,
    pendingExpertReview: payload.stats.pendingExpertReview,
    model: llm.model || 'offline-rules',
    piiMasked: true,
    ms: stages.reduce((a, s) => a + s.ms, 0)
  });
  return payload;
}