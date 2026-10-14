import path from 'node:path';
import { requireBundle, hasModule } from '../lib/runtime-deps.mjs';
import { NotImplementedError } from '../domain/errors.mjs';

/**
 * OCR 前的图像准备：把图片统一成 PNG，处理多页 TIFF，并启用自动纠偏。
 * sharp 只做格式/页面处理；真正的旋转角度由 tesseract 的 rotateAuto 计算，
 * 因为 tesseract 已在同一次识别中完成倾斜估计，额外旋转会重复且更不稳定。
 *
 * @owner 后端 B
 */
const TIFF = new Set(['tif', 'tiff']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'bmp', 'tif', 'tiff', 'webp']);

let sharpPromise;
async function loadSharp() {
  if (!hasModule('sharp')) {
    throw new NotImplementedError('sharp 未安装：npm i sharp（多页 TIFF/图像归一化需要它）', '后端 B');
  }
  sharpPromise ||= Promise.resolve(requireBundle('sharp'));
  return sharpPromise;
}

function extensionOf(filename) {
  return path.extname(String(filename || '')).replace(/^\./, '').toLowerCase();
}

function detectFormat(buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 6 && (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (b.length >= 2 && b.subarray(0, 2).toString('ascii') === 'BM') return 'bmp';
  const tiffLE = b.length >= 4 && b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00;
  const tiffBE = b.length >= 4 && b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a;
  if (tiffLE || tiffBE) return 'tiff';
  if (b.length >= 2 && b[0] === 0x50 && [0x31, 0x32, 0x33, 0x34, 0x35, 0x36].includes(b[1])) return 'pnm';
  return null;
}

export function imageFormatOf(buffer, filename = '') {
  const detected = detectFormat(buffer);
  if (detected) return detected;
  const ext = extensionOf(filename);
  return ext === 'jpeg' ? 'jpeg' : ext === 'tif' ? 'tiff' : ext || null;
}

export function isImageSupported(buffer, filename = '') {
  const format = imageFormatOf(buffer, filename);
  return !!format && (format === 'tiff' || IMAGE_EXTENSIONS.has(extensionOf(filename)) || ['png', 'jpeg', 'gif', 'webp', 'bmp', 'pnm'].includes(format));
}

function formatForMeta(meta) {
  if (meta.format === 'jpeg') return 'jpeg';
  if (meta.format === 'tiff') return 'tiff';
  return meta.format || null;
}

/**
 * @returns {Promise<{pages: Buffer[], format: string, pageCount: number, notices: string[], bytes: number}>}
 */
export async function prepareImages(buffer, { filename = '', allowSharpFallback = true } = {}) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!input.length) throw new NotImplementedError('OCR 输入为空', '后端 B');
  const format = imageFormatOf(input, filename);

  if (format === 'png' && !allowSharpFallback) {
    return { pages: [input], format: 'png', pageCount: 1, notices: [], bytes: input.length };
  }

  const sharp = await loadSharp();
  let base;
  try {
    base = await sharp(input, { failOn: 'error', pages: -1 }).metadata();
  } catch (error) {
    throw new NotImplementedError('无法读取图片（可能格式损坏或运行时不支持）：' + error.message, '后端 B');
  }

  const topLevelPages = Math.max(1, Number(base.pages) || 1);
  if (topLevelPages > 1 && !TIFF.has(formatForMeta(base) || format)) {
    throw new NotImplementedError('当前只支持多页 TIFF，其他动画/多帧格式请先转成 PDF 或 PNG', '后端 B');
  }

  const pages = [];
  for (let pageNumber = 1; pageNumber <= topLevelPages; pageNumber += 1) {
    try {
      const page = topLevelPages > 1 ? sharp(input, { failOn: 'error', page: pageNumber - 1 }) : sharp(input, { failOn: 'error' });
      pages.push(await page.png().toBuffer());
    } catch (error) {
      throw new NotImplementedError('图像预处理失败（需要 sharp）：' + error.message, '后端 B');
    }
  }

  const splitNotice = topLevelPages > 1
    ? ['已将 ' + topLevelPages + ' 页 TIFF 拆分为 ' + topLevelPages + ' 张图片逐页识别']
    : [];
  const formatNotice = format && format !== 'png' ? ['已把 ' + format + ' 图像归一化为 PNG 后交给 OCR'] : [];

  return {
    pages,
    format: formatForMeta(base) || format || 'png',
    pageCount: topLevelPages,
    notices: [...formatNotice, ...splitNotice],
    bytes: pages.reduce((sum, page) => sum + page.length, 0)
  };
}
