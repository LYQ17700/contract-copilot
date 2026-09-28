const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/**
 * 文本归一化与中文数字。合同文本里全角空格、CRLF、PDF 硬换行是最常见的脏数据来源。
 *
 * @owner 后端 B
 */
export function normalize(raw) {
  let text = String(raw || '');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ').replace(/\u00a0/g, ' ');
  text = text.replace(/\n([ \t]*)\n([ \t]*)\n+/g, '\n\n');
  return text.split('\n').map((line) => line.replace(/\s+$/g, '')).join('\n').replace(/\s+$/, '');
}

/** “押三付十二”“租赁期共二十五年”这类写法必须能变成数字，否则量化校验全部失效。 */
export function cnNumber(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (/^[0-9]+(\.[0-9]+)?$/.test(text)) return Number(text);
  if (!/^[零一二三四五六七八九十百两]+$/.test(text)) return null;
  let total = 0;
  let current = 0;
  for (const ch of text) {
    if (CN_DIGIT[ch] !== undefined) {
      current = CN_DIGIT[ch];
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
