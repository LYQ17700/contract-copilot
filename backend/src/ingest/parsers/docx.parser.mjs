import { requireBundle } from '../../lib/runtime-deps.mjs';

/**
 * DOCX 文字提取：解 OOXML 的 word/document.xml，按段落还原换行。
 *
 * @owner 后端 A
 */
function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

export async function parseDocx(buffer) {
  const JSZip = requireBundle('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('不是有效的 .docx（缺少 word/document.xml）');
  const xml = await entry.async('string');
  const paragraphs = xml
    .split(/<w:p[ >]/)
    .slice(1)
    .map((chunk) => [...chunk.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => decodeEntities(m[1])).join('').trim());
  const text = paragraphs.filter(Boolean).join('\n');
  return { engine: 'jszip+ooxml', pageCount: 1, text, needsOcr: false, notices: [] };
}
