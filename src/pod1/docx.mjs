import { requireBundle } from '../deps.mjs';

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

export async function extractDocx(buffer) {
  const JSZip = requireBundle('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('不是有效的 .docx（缺少 word/document.xml）');
  const xml = await entry.async('string');
  const paragraphs = xml
    .split(/<w:p[ >]/)
    .slice(1)
    .map((chunk) => {
      const runs = [...chunk.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => decodeEntities(m[1]));
      return runs.join('').trim();
    });
  const text = paragraphs.filter((p) => p.length > 0).join('\n');
  return { engine: 'jszip+ooxml', pageCount: 1, text, pages: [{ page: 1, text }] };
}