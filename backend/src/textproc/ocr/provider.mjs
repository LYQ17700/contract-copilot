/**
 * OCR Provider 接口（后端 B 的核心边界）。
 *
 * 约定：
 *  - 工厂函数必须是同步的，返回 { name, ready(), recognize(buffer, ctx) -> Promise<{text, notices?, confidence?}> }
 *  - ready() 只做本地能力探测（查依赖/语言包/Key），不得发起任何外部调用；/health 只走 ready()；
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

/** 给 /health 用：只探测能力是否就绪，不真调 OCR/视觉模型，不抛异常。 */
export async function probeOcrProvider() {
  const name = config.ocrProvider;
  if (!registry.has(name)) return { name, ready: false, reason: '未知 OCR_PROVIDER：' + name, code: 'invalid_config' };
  try {
    const provider = getOcrProvider();
    const probe = (await provider.ready?.()) ?? { ready: true };
    return { name: provider.name, ...probe };
  } catch (error) {
    return { name, ready: false, reason: error.message, code: error.code || 'error' };
  }
}

/** 进程退出时释放常驻资源（例如 tesseract worker）。 */
export async function shutdownOcrProvider() {
  if (!active) return;
  try {
    await active.shutdown?.();
  } finally {
    active = undefined;
  }
}
