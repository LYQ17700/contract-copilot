import { getOcrProvider } from '../../textproc/ocr/provider.mjs';

/**
 * 图片 / 无文字层 PDF 的出口。A 只负责判定“该走 OCR 了”并把字节交给 B 的 Provider，
 * 不关心用 tesseract 还是视觉大模型。
 *
 * @owner 后端 A（边界） / 后端 B（实现）
 */
export async function parseImage(buffer, { documentId } = {}) {
  const provider = getOcrProvider();
  const result = await provider.recognize(buffer, { documentId });
  return {
    engine: 'ocr:' + provider.name,
    pageCount: 1,
    text: result.text,
    needsOcr: false,
    notices: result.notices || [],
    confidence: result.confidence ?? null
  };
}
