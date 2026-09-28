import { config } from '../../config/index.mjs';
import { UnsupportedMediaTypeError } from '../../domain/errors.mjs';
import { assertParsedDocument } from '../../domain/contracts.mjs';
import { createLogger } from '../../observability/logger.mjs';
import { parsePdf } from './pdf.parser.mjs';
import { parseDocx } from './docx.parser.mjs';
import { parseText } from './text.parser.mjs';
import { parseImage } from './image.parser.mjs';

/**
 * 解析器注册表：按扩展名分发。新增格式只改 PARSERS 一行。
 *
 * @owner 后端 A
 */
const log = createLogger('ingest.parsers');

const TEXT_LIKE = ['txt', 'md', 'markdown', 'csv', 'log'];
const IMAGE_LIKE = ['png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff', 'webp'];

export const PARSERS = {
  pdf: parsePdf,
  docx: parseDocx,
  png: parseImage,
  jpg: parseImage,
  jpeg: parseImage,
  tif: parseImage,
  tiff: parseImage,
  bmp: parseImage,
  webp: parseImage,
  txt: parseText,
  md: parseText,
  markdown: parseText,
  csv: parseText,
  log: parseText
};

export function supports(extension) {
  return Object.prototype.hasOwnProperty.call(PARSERS, extension);
}

export function capabilities() {
  return {
    extensions: config.allowedExtensions,
    textLike: TEXT_LIKE,
    imageLike: IMAGE_LIKE,
    engines: { pdf: 'pdfjs-dist', docx: 'jszip+ooxml', text: 'node:util TextDecoder' }
  };
}

/** @returns {Promise<import('../domain/contracts.mjs').ParsedDocument>} */
export async function parseDocument(record, buffer) {
  if (!supports(record.extension)) throw new UnsupportedMediaTypeError(record.extension, config.allowedExtensions);
  const started = Date.now();
  const parser = PARSERS[record.extension];
  const out = await parser(buffer, { documentId: record.id });
  // 扫描件 PDF：文字层为空时自动补一次 OCR
  let result = out;
  if (record.extension === 'pdf' && result.needsOcr) {
    log.info('pdf without text layer, fallback to ocr', { documentId: record.id });
    result = await parseImage(buffer, { documentId: record.id });
    result.notices = [...(out.notices || []), ...(result.notices || [])];
  }
  return assertParsedDocument({
    documentId: record.id,
    engine: result.engine,
    text: result.text || '',
    pageCount: result.pageCount || 1,
    charset: result.charset || null,
    confidence: result.confidence ?? null,
    notices: (result.notices || []).filter(Boolean),
    ms: Date.now() - started
  });
}
