/**
 * 条款切分：识别「第×条 / 1. / （一）」等编号，产出带字符偏移的条款数组。
 * start/end 是 text 的下标，前端高亮与 Pod2 原文引用都依赖它，改动必须带测试。
 *
 * @owner 后端 B
 * @todo(后端B-4) 支持「一、」「附件一」「Article 3」等更多编号体系与多级条款（条下款/项）
 */
const HEADING = /^\s*(第\s*[0-9一二三四五六七八九十百两]{1,6}\s*[条章款项节篇]|\d{1,2}[\.、]|\([0-9一二三四五六七八九十]{1,3}\)|[0-9一二三四五六七八九十]{1,3}[、\.])\s*([^\n]{0,40})$/;

export function splitClauses(text) {
  const lines = text.split('\n');
  const offsets = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }
  const headings = [];
  lines.forEach((line, index) => {
    const match = line.match(HEADING);
    if (match && line.length <= 60) {
      headings.push({ offset: offsets[index], marker: match[1].replace(/\s+/g, ''), title: (match[2] || '').trim() });
    }
  });

  if (headings.length === 0) {
    const clauses = [];
    let start = 0;
    text.split(/\n{2,}/).forEach((block, i) => {
      const body = block.trim();
      if (!body) return;
      const from = text.indexOf(body, start);
      clauses.push({ id: 'P' + (i + 1), heading: '段落 ' + (i + 1), title: '', body, start: from, end: from + body.length });
      start = from + body.length;
    });
    return clauses;
  }

  const clauses = [];
  const preamble = text.slice(0, headings[0].offset).trim();
  if (preamble) {
    const from = text.indexOf(preamble);
    clauses.push({ id: 'PRE', heading: '合同首部', title: '', body: preamble, start: from, end: from + preamble.length });
  }
  headings.forEach((head, i) => {
    const next = headings[i + 1] ? headings[i + 1].offset : text.length;
    const body = text.slice(head.offset, next).replace(/\s+$/g, '');
    clauses.push({
      id: 'C' + (i + 1),
      heading: head.marker + (head.title ? ' ' + head.title : ''),
      title: head.title,
      body,
      start: head.offset,
      end: head.offset + body.length
    });
  });
  return clauses;
}
