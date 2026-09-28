import { normalize, splitClauses } from './preprocess.mjs';
import { extractPdf } from './pdf.mjs';
import { extractDocx } from './docx.mjs';
import { extractImage } from './ocr.mjs';

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'text', 'csv', 'log']);

function decodeText(buffer) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const bad = (utf8.match(/\uFFFD/g) || []).length;
  if (bad === 0) return { text: utf8, charset: 'utf-8' };
  try {
    const gbk = new TextDecoder('gbk').decode(buffer);
    const badGbk = (gbk.match(/\uFFFD/g) || []).length;
    if (badGbk < bad) return { text: gbk, charset: 'gbk' };
  } catch {}
  return { text: utf8, charset: 'utf-8(replace)' };
}

function extensionOf(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(name || '');
  return match ? match[1].toLowerCase() : '';
}

export async function parseDocument({ buffer, filename, rawText }) {
  const started = Date.now();
  if (typeof rawText === 'string' && rawText.trim()) {
    const text = normalize(rawText);
    return { source: 'pasted', filename: filename || 'pasted-text.txt', charset: 'utf-8', engine: 'direct', pageCount: 1, text, clauses: splitClauses(text), notices: [], ms: Date.now() - started };
  }
  const ext = extensionOf(filename);
  let result;
  const notices = [];
  if (ext === 'pdf') {
    result = await extractPdf(buffer);
  } else if (ext === 'docx') {
    result = await extractDocx(buffer);
  } else if (['png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff', 'webp'].includes(ext)) {
    result = await extractImage(buffer);
    if (result.engine === 'unavailable') notices.push(result.notice);
  } else if (TEXT_EXT.has(ext) || ext === '') {
    const decoded = decodeText(buffer);
    result = { engine: 'plain-text', pageCount: 1, text: decoded.text };
    result.charset = decoded.charset;
  } else {
    throw new Error('不支持的文件类型：.' + ext + '（支持 pdf / docx / txt / md / 图片）');
  }
  const text = normalize(result.text || '');
  if (!text.trim()) {
    notices.push('未能从文件中提取到文字。若这是扫描件或图片型 PDF，需要接入 OCR 或视觉大模型（见 README「接入真实模型」一节）。');
  }
  return {
    source: 'file',
    filename,
    charset: result.charset || 'utf-8',
    engine: result.engine,
    pageCount: result.pageCount || 1,
    text,
    clauses: splitClauses(text),
    notices,
    ms: Date.now() - started
  };
}