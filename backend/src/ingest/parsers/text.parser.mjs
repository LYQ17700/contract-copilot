/**
 * 纯文本解析：UTF-8 优先，出现替换字符时尝试 GBK（Windows 导出的合同常见）。
 *
 * @owner 后端 A
 */
export function decodeText(buffer) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const bad = (utf8.match(/\uFFFD/g) || []).length;
  if (bad === 0) return { text: utf8, charset: 'utf-8' };
  try {
    const gbk = new TextDecoder('gbk').decode(buffer);
    if ((gbk.match(/\uFFFD/g) || []).length < bad) return { text: gbk, charset: 'gbk' };
  } catch {}
  return { text: utf8, charset: 'utf-8(replace)' };
}

export async function parseText(buffer) {
  const decoded = decodeText(buffer);
  return { engine: 'plain-text', pageCount: 1, text: decoded.text, needsOcr: false, notices: [], charset: decoded.charset };
}
