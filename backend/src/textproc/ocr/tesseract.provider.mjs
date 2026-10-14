import fs from 'node:fs';
import path from 'node:path';
import { importBundle, hasModule } from '../../lib/runtime-deps.mjs';
import { config } from '../../config/index.mjs';
import { NotImplementedError } from '../../domain/errors.mjs';
import { createLogger } from '../../observability/logger.mjs';
import { prepareImages } from '../image-prep.mjs';
import { normalizeOcrResult } from './result.mjs';
import {
  createSerialRunner,
  errorCode,
  isTransientError,
  retry,
  runtimeInt,
  withTimeout
} from '../runtime.mjs';

/**
 * 本地 tesseract.js 中文 OCR。
 *
 * @owner 后端 B
 */
const log = createLogger('textproc.ocr.tesseract');

function findTessdata() {
  const dirs = [config.tessdataPrefix, path.join(config.root, 'var', 'tessdata')].filter(Boolean);
  return dirs.find((dir) => fs.existsSync(path.join(dir, 'chi_sim.traineddata')));
}

/** 只查本地依赖，不加载 worker、不发网络请求。 */
async function capability() {
  if (!hasModule('tesseract.js')) return { ready: false, code: 'not_implemented', reason: 'tesseract.js 未安装：npm i tesseract.js' };
  if (!findTessdata()) return { ready: false, code: 'not_implemented', reason: '缺少中文语言包 chi_sim.traineddata：设置 TESSDATA_PREFIX 或放到 backend/var/tessdata/' };
  return { ready: true };
}

function tesseractLimits(env = process.env) {
  return {
    workerTimeoutMs: runtimeInt('OCR_TESSERACT_WORKER_TIMEOUT_MS', 60000, { min: 1000 }),
    recognizeTimeoutMs: runtimeInt('OCR_TESSERACT_TIMEOUT_MS', 60000, { min: 1000 }),
    attempts: runtimeInt('OCR_TESSERACT_RETRIES', 2, { min: 1 })
  };
}

function tesseractRecognizeOptions(env = process.env) {
  const autoRotate = String(env.OCR_TESSERACT_AUTO_ROTATE ?? '1') !== '0';
  const psm = String(env.OCR_TESSERACT_PSM ?? '6').trim();
  const dpi = String(env.OCR_TESSERACT_DPI ?? '').trim();
  return {
    autoRotate,
    psm,
    dpi,
    options: {
      ...(autoRotate ? { rotateAuto: true } : {}),
      ...(psm ? { tessedit_pageseg_mode: psm } : {}),
      ...(dpi ? { user_defined_dpi: dpi } : {})
    }
  };
}

function bytes(n) {
  return Math.round(Number(n || 0) / 1024) + 'KB';
}

export function tesseractProvider() {
  let workerPromise;
  let workerDirty = false;
  const runSerial = createSerialRunner();
  const limits = tesseractLimits();
  const recognizeOptions = tesseractRecognizeOptions();

  async function discardWorker() {
    const pending = workerPromise;
    workerPromise = undefined;
    workerDirty = false;
    if (!pending) return;
    try {
      const worker = await pending;
      await worker.terminate();
    } catch {
      // worker 初始化失败或已退出，没有额外清理动作。
    }
  }

  async function acquireWorker() {
    if (workerPromise && !workerDirty) return workerPromise;
    if (workerDirty) await discardWorker();
    const pending = (async () => {
      const { createWorker } = await importBundle('tesseract.js');
      const tessdata = findTessdata();
      return createWorker(['chi_sim'], 1, {
        langPath: tessdata,
        cachePath: tessdata,
        gzip: false,
        logger: () => {}
      });
    })();
    workerPromise = withTimeout(pending, limits.workerTimeoutMs, 'Tesseract worker 启动');
    try {
      const worker = await workerPromise;
      log.info('worker ready', { warm: true });
      return worker;
    } catch (error) {
      workerPromise = undefined;
      throw error;
    }
  }

  async function recognizePage(worker, buffer, pageNumber, pageCount) {
    const result = await withTimeout(
      worker.recognize(buffer, recognizeOptions.options),
      limits.recognizeTimeoutMs,
      'Tesseract 第 ' + pageNumber + '/' + pageCount + ' 页识别'
    );
    return normalizeOcrResult(result);
  }

  return {
    name: 'tesseract',
    async ready() {
      const probe = await capability();
      return {
        ...probe,
        worker: workerPromise && !workerDirty ? 'warm' : 'cold',
        timeoutMs: limits.recognizeTimeoutMs,
        retries: limits.attempts,
        autoRotate: recognizeOptions.autoRotate
      };
    },
    async recognize(buffer) {
      const probe = await capability();
      if (!probe.ready) throw new NotImplementedError(probe.reason, '后端 B');
      return runSerial(async () => {
        const prepared = await prepareImages(buffer);
        const pages = prepared.pages;
        const pageResults = await retry(
          async () => {
            const worker = await acquireWorker();
            try {
              const results = [];
              for (const [index, page] of pages.entries()) {
                const normalized = await recognizePage(worker, page, index + 1, pages.length);
                if (!normalized.text.trim()) {
                  throw new Error('OCR 第 ' + (index + 1) + ' 页未识别到文字，请检查清晰度/分辨率，或改用 vision-llm');
                }
                results.push(normalized);
              }
              return results;
            } catch (error) {
              if (errorCode(error) === 'timeout') workerDirty = true;
              throw error;
            }
          },
          {
            attempts: limits.attempts,
            delayMs: 250,
            shouldRetry: (error) => errorCode(error) === 'timeout' || isTransientError(error),
            label: 'tesseract OCR'
          }
        ).catch(async (error) => {
          if (errorCode(error) === 'timeout') await discardWorker();
          throw error;
        });

        const text = pageResults.map((page) => page.text).filter(Boolean).join('\n\n').trim();
        if (!text) throw new Error('OCR 未识别到任何文字，请检查图片清晰度/分辨率，或改用 vision-llm');
        const confidences = pageResults.map((page) => page.confidence).filter((value) => Number.isFinite(value));
        const confidence = confidences.length
          ? Number((confidences.reduce((sum, value) => sum + value, 0) / confidences.length).toFixed(2))
          : null;
        const rotated = pageResults.find((page) => page.rotateRadians !== null && page.rotateRadians !== undefined);
        const notices = [
          ...(prepared.notices || []),
          ...(rotated ? ['已启用自动倾斜检测，识别过程由 Tesseract 纠偏'] : [])
        ];
        log.info('recognize done', {
          pages: pages.length,
          bytes: bytes(buffer.length),
          confidence,
          warm: !!workerPromise
        });
        return { text, confidence, pageCount: pages.length, rotateRadians: rotated?.rotateRadians ?? null, notices };
      });
    },
    async shutdown() {
      await discardWorker();
    }
  };
}
