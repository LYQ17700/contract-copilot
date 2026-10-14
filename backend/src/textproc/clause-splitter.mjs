/**
 * 条款切分：识别「第×条 / 一、/（一）/ 附件一 / Article 3 / 1.」等编号，
 * 产出带字符偏移的条款数组；条下款/项作为附加字段挂到 clause.items。
 *
 * start/end 是 text 的下标，前端高亮与 Pod2 原文引用都依赖它，改动必须带测试。
 * body 始终满足 text.slice(start, end) === body，不能用 trim 后的文本替换。
 *
 * @owner 后端 B
 */
const CN_NUM = '[零一二三四五六七八九十百两]';
const ARABIC = '[0-9]';
const ROMAN = '(?:[ivxlcdm]{1,6})';
const CLAUSE_MARKER = new RegExp(
  '^(?:'
  + '第\\s*' + ARABIC + '{1,6}\\s*[条章款项节篇]'
  + '|第\\s*' + CN_NUM + '{1,6}\\s*[条章款项节篇]'
  + '|Article\\s+' + ARABIC + '{1,3}'
  + '|Clause\\s+' + ARABIC + '{1,3}'
  + '|Section\\s+' + ARABIC + '{1,3}'
  + '|Article\\s+' + ROMAN + '{1,6}'
  + '|附件\\s*' + ARABIC + '{1,3}'
  + '|附件\\s*' + CN_NUM + '{1,6}'
  + '|附录\\s*' + ARABIC + '{1,3}'
  + '|附录\\s*' + CN_NUM + '{1,6}'
  + '|' + CN_NUM + '{1,4}\\s*、'
  + '|' + ARABIC + '{1,3}[、\\.]'
  + ')',
  'i'
);
const CN_ITEM_MARKER = new RegExp('^' + CN_NUM + '{1,4}\\s*[、\\.]');
const EN_ITEM_MARKER = new RegExp('^[（(]' + CN_NUM + '{1,3}[)）]');
const ARABIC_ITEM_MARKER = /^[（(]?[0-9]{1,3}[)）]?[、\.]/;

function markerText(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

export function joinHeading(marker, title) {
  const normalizedMarker = marker.normalize('NFKC');
  if (!title) return marker;
  if (normalizedMarker.endsWith('、')) {
    return marker + title;
  }
  return marker + ' ' + title;
}

/** 判断一行是否是条款标题行。正文行被误判会破坏高亮偏移，因此只认强编号。 */
export function isClauseHeading(line) {
  const value = String(line || '').trim();
  if (!value || value.length > 80 || /[，。；！？]$/.test(value)) return false;
  const match = CLAUSE_MARKER.exec(value);
  if (!match) return false;
  const rest = value.slice(match[0].length).trim();
  if (!rest) return true;
  if (/^(?:甲方|乙方|出租方|承租方|丙方|丁方)[:：]/.test(rest)) return false;
  if (rest.length > 48 && /[，。；！？]/.test(rest)) return false;
  return true;
}

function headingParts(line) {
  const value = String(line || '').trim();
  const match = CLAUSE_MARKER.exec(value);
  const marker = markerText(match ? match[0] : '');
  const prefix = match ? Array.from(match[0]).length : 0;
  const title = marker ? Array.from(value).slice(prefix).join('').trim() : '';
  return { marker, title };
}

function isSubItem(line) {
  const value = String(line || '').trim();
  if (!value || value.length > 120) return false;
  if (isClauseHeading(value)) return false;
  return EN_ITEM_MARKER.test(value) || CN_ITEM_MARKER.test(value) || ARABIC_ITEM_MARKER.test(value);
}

function splitItems(text, clause) {
  const lines = clause.body.split('\n');
  const offsets = [];
  let cursor = clause.start;
  lines.forEach((line) => {
    offsets.push(cursor);
    cursor += line.length + 1;
  });
  const heads = [];
  lines.forEach((line, index) => {
    if (isSubItem(line) && line.trim().length < 200) heads.push({ index, offset: offsets[index], marker: line.trim() });
  });
  if (!heads.length) return [];

  const items = [];
  heads.forEach((head, index) => {
    const next = heads[index + 1];
    const end = next ? next.offset : clause.end;
    const body = text.slice(head.offset, end).trimEnd();
    if (!body) return;
    items.push({
      id: clause.id + '.' + (index + 1),
      marker: head.marker,
      text: body,
      start: head.offset,
      end: head.offset + body.length
    });
  });
  return items;
}

function paragraphSplit(text) {
  const blocks = text.split(/\n{2,}/);
  const clauses = [];
  let cursor = 0;
  blocks.forEach((block) => {
    const body = block.trim();
    if (!body) return;
    const from = text.indexOf(body, cursor);
    if (from < 0) return;
    const clause = {
      id: 'P' + (clauses.length + 1),
      heading: '段落 ' + (clauses.length + 1),
      title: '',
      body,
      start: from,
      end: from + body.length
    };
    clause.items = splitItems(text, clause);
    clauses.push(clause);
    cursor = from + body.length;
  });
  return clauses;
}

export function splitClauses(text) {
  const source = String(text || '');
  if (!source.trim()) return [];
  const lines = source.split('\n');
  const offsets = [];
  let cursor = 0;
  lines.forEach((line) => {
    offsets.push(cursor);
    cursor += line.length + 1;
  });

  const headings = [];
  lines.forEach((line, index) => {
    if (isClauseHeading(line)) {
      const parts = headingParts(line);
      headings.push({ offset: offsets[index], ...parts });
    }
  });

  if (!headings.length) return paragraphSplit(source);

  const clauses = [];
  const preamble = source.slice(0, headings[0].offset).trim();
  if (preamble) {
    const from = source.indexOf(preamble);
    clauses.push({
      id: 'PRE',
      heading: '合同首部',
      title: '',
      body: source.slice(from, from + preamble.length),
      start: from,
      end: from + preamble.length,
      items: []
    });
  }

  headings.forEach((head, index) => {
    const next = headings[index + 1] ? headings[index + 1].offset : source.length;
    const body = source.slice(head.offset, next).replace(/\s+$/g, '');
    const clause = {
      id: 'C' + (index + 1),
      heading: joinHeading(head.marker, head.title),
      title: head.title,
      body,
      start: head.offset,
      end: head.offset + body.length
    };
    clause.items = splitItems(source, clause);
    clauses.push(clause);
  });

  return clauses;
}
