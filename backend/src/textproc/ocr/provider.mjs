/**
 * OCR Provider 接口（后端 B 的核心边界）。
 *
 * 约定：
 *  - 工厂函数必须是同步的，返回 { name, recognize(buffer, ctx) -> Promise<{text, notices?, confidence?}> }
 *  - 能力缺失（缺语言包/缺 Key）时在 recognize() 里抛 NotImplementedError，
 *    这样 /health 仍能启动并如实报告，不会整个服务起不来；
 *  - 失败要抛异常，不要返回空字符串假装成功。
 *
 * @owner 后端 B
 */
import { config } from '../../config/index.mjs';
import { createLogger } from '../../observability/logger.mjs';
import { stubProvider } from './stub.provider.mjs';
import { tesseractProvider } from './tesseract.provider.mjs';
import { visionLlmProvider } from './visionllm.provider.mjs';

const log = createLogger('textproc.ocr');
const registry = new Map([
  ['stub', stubProvider],
  ['tesseract', tesseractProvider],
  ['vision-llm', visionLlmProvider]
]);
let active;

export function availableProviders() {
  return [...registry.keys()];
}

export function getOcrProvider() {
  if (active) return active;
  const factory = registry.get(config.ocrProvider);
  if (!factory) throw new Error('未知 OCR_PROVIDER：' + config.ocrProvider + '，可选 ' + availableProviders().join(' | '));
  active = factory(config);
  log.info('ocr provider ready', { provider: active.name });
  return active;
}

export function resetOcrProvider() {
  active = undefined;
}

/** 给 /health 用：不抛异常，只报告能力是否就绪。 */
export async function probeOcrProvider() {
  try {
    const provider = getOcrProvider();
    const probe = await provider.recognize(Buffer.from('probe'), { documentId: 'probe' });
    return { name: provider.name, ready: true, chars: (probe.text || '').length, notices: probe.notices || [] };
  } catch (error) {
    return { name: config.ocrProvider, ready: false, reason: error.message, code: error.code || 'error' };
  }
}
