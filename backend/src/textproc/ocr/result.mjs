/**
 * OCR 结果标准化：不同 Provider 可能返回 text、words、pages 等不同结构，
 * 这里统一成 text / confidence / pageCount，避免解析器各自猜测字段。
 *
 * @owner 后端 B
 */
export function splitOcrLines(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .filter((line, index, all) => line.trim() || (index > 0 && index < all.length - 1));
}

export function joinOcrPages(texts) {
  return texts
    .map((text) => splitOcrLines(text).join('\n').trim())
    .filter(Boolean)
    .join('\n\n');
}

export function normalizeOcrResult(result) {
  const data = result || {};
  const pages = Array.isArray(data.pages)
    ? data.pages
    : data.data && Array.isArray(data.data.pages)
      ? data.data.pages
      : null;
  const pageData = pages && pages.length ? pages : [data.data || data];
  const texts = pageData.map((page) => page?.text).filter((text) => typeof text === 'string');
  const text = joinOcrPages(texts);
  const confidences = pageData
    .map((page) => Number(page?.confidence))
    .filter((value) => Number.isFinite(value) && value > 0);
  const confidence = confidences.length
    ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(2))
    : (Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : null);
  return {
    text,
    confidence,
    pageCount: pageData.length,
    rotateRadians: pageData.map((page) => page?.rotateRadians).find((value) => typeof value === 'number') ?? data.rotateRadians ?? null,
    notices: data.notices || []
  };
}
