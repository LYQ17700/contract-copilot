const CN_NUM = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 两: 2, 十: 10, 百: 100 };

export function cnNumber(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (/^[0-9]+(\.[0-9]+)?$/.test(text)) return Number(text);
  if (!/^[零一二三四五六七八九十百两]+$/.test(text)) return null;
  const digit = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0;
  let current = 0;
  for (const ch of text) {
    if (digit[ch] !== undefined) {
      current = digit[ch];
    } else if (ch === '十') {
      total += (current || 1) * 10;
      current = 0;
    } else if (ch === '百') {
      total += (current || 1) * 100;
      current = 0;
    }
  }
  return total + current;
}

export function normalize(raw) {
  let text = String(raw || '');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ').replace(/\u00a0/g, ' ');
  text = text.replace(/\n([ \t]*)\n([ \t]*)\n+/g, '\n\n');
  text = text.replace(/[^\S\n]+$/g, '');
  text = text.split('\n').map((line) => line.replace(/\s+$/g, '')).join('\n');
  return text;
}

const HEADING = /^\s*(第\s*[0-9零一二三四五六七八九十百两]{1,6}\s*[条章款项节篇]|\d{1,2}[\.、]|\([0-9一二三四五六七八九十]{1,3}\)|[0-9一二三四五六七八九十]{1,3}[、\.])\s*([^\n]{0,40})$/;

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
      headings.push({ index, offset: offsets[index], marker: match[1].replace(/\s+/g, ''), title: (match[2] || '').trim() });
    }
  });
  const clauses = [];
  if (headings.length === 0) {
    let start = 0;
    text.split(/\n{2,}/).forEach((block, i) => {
      const body = block.trim();
      if (body) {
        const from = text.indexOf(body, start);
        clauses.push({ id: 'P' + (i + 1), heading: '段落 ' + (i + 1), title: '', body, start: from, end: from + body.length });
        start = from + body.length;
      }
    });
    return clauses;
  }
  const preamble = text.slice(0, headings[0].offset).trim();
  if (preamble) {
    clauses.push({ id: 'PRE', heading: '合同首部', title: '', body: preamble, start: text.indexOf(preamble), end: text.indexOf(preamble) + preamble.length });
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

export function findInText(text, snippet) {
  if (!snippet) return -1;
  const direct = text.indexOf(snippet);
  if (direct >= 0) return direct;
  const compact = text.replace(/\s+/g, '');
  const target = String(snippet).replace(/\s+/g, '');
  const hit = compact.indexOf(target);
  if (hit < 0) return -1;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!/\s/.test(text[i])) {
      if (seen === hit) return i;
      seen += 1;
    }
  }
  return -1;
}