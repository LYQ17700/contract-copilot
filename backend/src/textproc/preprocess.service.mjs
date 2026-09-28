import { cnNumber, normalize } from './preprocess.mjs';
import { splitClauses } from './clause-splitter.mjs';
import { buildFlow } from './flow.mjs';
import { assertPreprocessedDocument } from '../domain/contracts.mjs';

/**
 * 文本预处理：归一化 → 条款切分 → 回流文本与偏移映射。
 * 输出里的 start/end 一律是 text 的字符下标，前端据此高亮，Pod2 据此定位原文。
 *
 * @owner 后端 B
 */
export function preprocess(parsed) {
  const text = normalize(parsed.text);
  const clauses = splitClauses(text);
  const { flow, map } = buildFlow(text);
  return assertPreprocessedDocument({
    documentId: parsed.documentId,
    text,
    clauses,
    flow,
    map,
    stats: {
      chars: text.length,
      clauses: clauses.length,
      structured: /第\s*[0-9一二三四五六七八九十百两]{1,6}\s*条/.test(text),
      empty: text.replace(/\s/g, '').length === 0
    }
  });
}

export { cnNumber, normalize, splitClauses, buildFlow };
