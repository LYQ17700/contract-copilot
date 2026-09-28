import { config } from '../config/index.mjs';
import { UpstreamError } from '../domain/errors.mjs';
import { createLogger } from '../observability/logger.mjs';

/**
 * 与 Pod2（风险识别组）的调用边界。本地联调先跑 mock，
 * 等 Pod2 的服务地址稳定后把 ANALYZE_MODE=remote 即可切换，控制器不用改。
 *
 * @owner 共用（A 提供、Pod2 实现）
 * @todo(后端A-4) 与 Pod2 对齐正式契约：/v1/analyze 的字段名、错误码、超时与幂等键
 */
const log = createLogger('analyze.pod2');

export function serializePreprocessed(preprocessed) {
  const { flow, map, ...rest } = preprocessed;
  return rest;
}

async function remote(preprocessed) {
  const url = config.pod2.baseUrl + '/api/analyze';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: preprocessed.text, filename: preprocessed.documentId })
  });
  if (!res.ok) throw new UpstreamError('pod2', 'Pod2 返回 HTTP ' + res.status);
  return res.json();
}

function mock(preprocessed) {
  const clauses = preprocessed.clauses;
  const hit = (pattern) => clauses.filter((c) => pattern.test(c.body)).map((c) => ({ clauseId: c.id, clauseHeading: c.heading, start: c.start, end: c.end }));
  const findings = [
    ...hit(/押金[^。]{0,20}(不退还|不予退还|没收)/).map((loc) => ({ ...loc, ruleId: 'MOCK-DEP-NORETURN', name: '押金不退（联调占位）', severity: 'high', evidence: '（mock）命中「押金…不退还」', citations: [] })),
    ...hit(/提前退租/).map((loc) => ({ ...loc, ruleId: 'MOCK-PENALTY', name: '提前退租违约金（联调占位）', severity: 'mid', evidence: '（mock）命中「提前退租」', citations: [] }))
  ];
  return {
    mock: true,
    runId: 'mock-' + preprocessed.documentId,
    grade: findings.length ? { level: 'C', label: '联调占位结果（非真实审查）', color: '#e67e22' } : { level: '?', label: '联调占位结果（非真实审查）', color: '#6b7789' },
    score: findings.length * 2,
    findings,
    stats: { total: findings.length, verified: 0, needsReview: findings.length, pendingExpertReview: [] },
    notices: ['ANALYZE_MODE=mock：结果由后端骨架生成，只用于前端联调。设置 ANALYZE_MODE=remote 并配置 POD2_BASE_URL 后调用真实风险识别服务。']
  };
}

export async function analyze(preprocessed) {
  if (config.pod2.mode === 'remote') {
    log.info('call pod2', { url: config.pod2.baseUrl });
    return remote(preprocessed);
  }
  return mock(preprocessed);
}
