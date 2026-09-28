import { importBundle, bundleFile } from '../deps.mjs';

// Node 版 pdf.js 用 fs.readFile 读取这些资源，所以传目录路径（正斜杠 + 结尾斜杠），不是 URL。
const dirUrl = (name) => bundleFile('pdfjs-dist', name).split(String.fromCharCode(92)).join('/') + '/';

const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;

function joinRows(rows) {
  const lines = [];
  let current = null;
  for (const row of rows) {
    if (!current || Math.abs(current.y - row.y) > 3.5) {
      if (current) lines.push(current.text);
      current = { y: row.y, text: row.str, right: row.x + row.w };
      continue;
    }
    const gap = row.x - current.right;
    const needSpace = gap > 2.5 && !(CJK.test(current.text.slice(-1)) && CJK.test(row.str.charAt(0)));
    current.text += (needSpace ? ' ' : '') + row.str;
    current.right = row.x + row.w;
  }
  if (current) lines.push(current.text);
  return lines;
}

export async function extractPdf(buffer) {
  const { getDocument } = await importBundle('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: dirUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: dirUrl('standard_fonts'),
    wasmUrl: dirUrl('wasm'),
    isEvalSupported: false,
    disableFontFace: true
  }).promise;

  const pages = [];
  for (let num = 1; num <= doc.numPages; num += 1) {
    const page = await doc.getPage(num);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const rows = [];
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      rows.push({ y: item.transform[5], x: item.transform[4], w: item.width, str: item.str });
    }
    rows.sort((a, b) => b.y - a.y || a.x - b.x);
    pages.push({ page: num, height: Math.round(viewport.height), text: joinRows(rows).join('\n') });
  }
  const meta = await doc.getMetadata().catch(() => null);
  await doc.cleanup();
  return {
    engine: 'pdfjs-dist',
    pageCount: doc.numPages,
    title: meta?.info?.Title || '',
    text: pages.map((p) => p.text).join('\n')
  };
}