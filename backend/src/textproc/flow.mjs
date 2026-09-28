/**
 * 回流文本：把 PDF 硬换行接回整句，供规则匹配与检索使用；
 * 同时维护 flow 下标 → text 下标的映射，保证高亮仍落在原文正确位置。
 *
 * @owner 后端 B
 */
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
      }
      continue;
    }
    flow += ch;
    map.push(i);
  }
  map.push(text.length);
  return { flow, map };
}
