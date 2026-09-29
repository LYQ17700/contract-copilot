import path from 'node:path';
import { bundleFile, importBundle } from '../../lib/runtime-deps.mjs';

/**
 * PDF 文字提取（已在原型 contract-copilot/src/pod1/pdf.mjs 验证，含 CJK CMap）。
 * 注意：Node 版 pdf.js 用 fs.readFile 读取 cMap/字体，因此传目录路径而非 URL。
 *
 * @owner 后端 A
 * @todo(后端A-2) 首次加载 pdfjs 约 3s：服务启动时预热，并补解析超时与失败重试
 */
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
const dirPath = (name) => bundleFile('pdfjs-dist', name).split(path.sep).join('/') + '/';

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

export async function parsePdf(buffer) {
  const { getDocument } = await importBundle('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: dirPath('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: dirPath('standard_fonts'),
    wasmUrl: dirPath('wasm'),
    isEvalSupported: false,
    disableFontFace: true
  }).promise;
  const pages = [];
  for (let num = 1; num <= doc.numPages; num += 1) {
    const page = await doc.getPage(num);
    const content = await page.getTextContent();
    const rows = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str || item.str.trim() === '') continue;
      rows.push({ y: item.transform[5], x: item.transform[4], w: item.width, str: item.str });
    }
    rows.sort((a, b) => b.y - a.y || a.x - b.x);
    pages.push({ page: num, text: joinRows(rows).join('\n') });
  }
  await doc.cleanup();
  const scanned = pages.every((p) => p.text.trim().length === 0);
  return {
    engine: 'pdfjs-dist',
    pageCount: doc.numPages,
    text: pages.map((p) => p.text).join('\n'),
    needsOcr: scanned,
    notices: scanned ? ['该 PDF 没有文字层（扫描件），需要走 OCR 分支'] : []
  };
}
