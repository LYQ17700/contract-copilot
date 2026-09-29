import fs from 'node:fs';
import path from 'node:path';
import { importBundle, hasModule } from '../../lib/runtime-deps.mjs';
import { config } from '../../config/index.mjs';
import { NotImplementedError } from '../../domain/errors.mjs';

/**
 * 本地 tesseract.js 中文 OCR。
 *
 * @owner 后端 B
 * @todo(后端B-1) worker 常驻复用 + 识别超时（当前首次调用冷启动约数秒）
 * @todo(后端B-2) 多页 TIFF / 倾斜矫正 / 表格合同的段落还原
 */
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

export function tesseractProvider() {
  let workerPromise;
  return {
    name: 'tesseract',
    async ready() {
      const probe = await capability();
      return { ...probe, worker: workerPromise ? 'warm' : 'cold' };
    },
    async recognize(buffer) {
      const probe = await capability();
      if (!probe.ready) throw new NotImplementedError(probe.reason, '后端 B');
      const tessdata = findTessdata();
      workerPromise ||= (async () => {
        const { createWorker } = await importBundle('tesseract.js');
        return createWorker(['chi_sim'], 1, { langPath: tessdata, cachePath: tessdata, gzip: false });
      })();
      const worker = await workerPromise;
      const { data } = await worker.recognize(buffer);
      const text = (data.text || '').trim();
      if (!text) throw new Error('OCR 未识别到任何文字，请检查图片清晰度/分辨率，或改用 vision-llm');
      return { text, confidence: data.confidence ?? null, notices: [] };
    },
    async shutdown() {
      if (workerPromise) (await workerPromise).terminate();
    }
  };
}
