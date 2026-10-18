import path from 'node:path';
import { bundleFile, importBundle } from '../../lib/runtime-deps.mjs';
import { config } from '../../config/index.mjs';
import { createLogger } from '../../observability/logger.mjs';

/**
 * PDF 文字提取（已在原型 contract-copilot/src/pod1/pdf.mjs 验证，含 CJK CMap）。
 * 注意：Node 版 pdf.js 用 fs.readFile 读取 cMap/字体，因此传目录路径而非 URL。
 *
 * @owner 后端 A
 * 特性：首次 pdfjs 加载约 3s → 启动时预热；解析增加超时与失败重试。
 */
const log = createLogger('ingest.parsers.pdf');
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
const dirPath = (name) => bundleFile('pdfjs-dist', name).split(path.sep).join('/') + '/';

/** 缓存 pdfjs 模块加载，避免每次解析都触发 3s 首载。 */
let pdfjsPromise = null;
export function warmupPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = importBundle('pdfjs-dist/legacy/build/pdf.mjs')
        .then((mod) => {
          log.info('pdfjs warmed up');
          return mod;
        })
        .catch((error) => {
          pdfjsPromise = null; // 允许下次重试
          log.error('pdfjs warmup failed', { message: error.message });
          throw error;
        });
  }
  return pdfjsPromise;
}

/** 带超时的 Promise，超时后触发 onTimeout 释放资源并 reject。 */
function withTimeout(promise, ms, onTimeout) {
  let timer = null;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error('PDF 解析超时（超过 ' + Math.round(ms / 1000) + 's）'));
    }, ms);
    promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

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

async function extractWithPdf(buffer, { timeoutMs, signal } = {}) {
  const { getDocument } = await warmupPdfjs();
  const task = getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: dirPath('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: dirPath('standard_fonts'),
    wasmUrl: dirPath('wasm'),
    isEvalSupported: false,
    disableFontFace: true,
    signal
  });
  const loading = timeoutMs ? withTimeout(task.promise, timeoutMs, () => task.destroy?.()) : task.promise;
  const doc = await loading;
  try {
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
    const scanned = pages.every((p) => p.text.trim().length === 0);
    return {
      engine: 'pdfjs-dist',
      pageCount: doc.numPages,
      text: pages.map((p) => p.text).join('\n'),
      needsOcr: scanned,
      notices: scanned ? ['该 PDF 没有文字层（扫描件），需要走 OCR 分支'] : []
    };
  } finally {
    await doc.cleanup().catch(() => {});
  }
}

/**
 * 解析 PDF，带超时与失败重试。重试会重新发起加载，因此把「临时性失败」和
 * 「确定性输入错误」区分开：输入错误（非 PDF）不重试直接报错。
 */
export async function parsePdf(buffer, { attempts = config.parseRetries + 1, timeoutMs = config.parseTimeoutMs } = {}) {
  const timeout = Number(timeoutMs) > 0 ? timeoutMs : 0;
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    // 每次尝试都新建 AbortController，让重试真正释放上一轮的资源
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    try {
      const result = await extractWithPdf(buffer, { timeoutMs: timeout, signal: ac?.signal });
      if (i > 0) log.info('pdf retry succeeded', { attempt: i + 1 });
      return result;
    } catch (error) {
      lastError = error;
      const transient = /超时|interrupted|UnknownErrorException|aborted/i.test(error?.message || '');
      if (!transient && i === 0) throw error; // 确定性错误（非 PDF）不重试
      log.warn('pdf parse attempt failed', { attempt: i + 1, message: error.message });
      await new Promise((r) => setTimeout(r, 100)); // 短暂退避
    } finally {
      ac?.abort();
    }
  }
  throw lastError || new Error('PDF 解析失败');
}