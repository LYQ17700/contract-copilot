import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importBundle, modulesRoot } from '../deps.mjs';

function localTessdata() {
  const dirs = [];
  if (process.env.TESSDATA_PREFIX) dirs.push(process.env.TESSDATA_PREFIX);
  dirs.push(path.join(os.homedir(), '.tessdata'));
  dirs.push(path.join(modulesRoot(), '..', 'tessdata'));
  return dirs.find((dir) => {
    try {
      return fs.existsSync(path.join(dir, 'chi_sim.traineddata'));
    } catch {
      return false;
    }
  });
}

export async function extractImage(buffer) {
  const lang = localTessdata();
  if (!lang && !process.env.CONTRACT_COPILOT_ALLOW_OCR_DOWNLOAD) {
    return {
      engine: 'unavailable',
      pageCount: 1,
      text: '',
      pages: [],
      notice: '本地未找到 chi_sim.traineddata，且未开启联网下载。请设置 TESSDATA_PREFIX 指向含 chi_sim.traineddata 的目录，或改用「粘贴合同文本」。'
    };
  }
  const { createWorker } = await importBundle('tesseract.js');
  const options = lang ? { langPath: lang, cachePath: lang, gzip: false } : {};
  const worker = await createWorker(['chi_sim'], 1, options);
  try {
    const { data } = await worker.recognize(buffer);
    return { engine: 'tesseract.js', pageCount: 1, text: data.text || '', pages: [{ page: 1, text: data.text || '' }] };
  } finally {
    await worker.terminate();
  }
}