import { config } from '../config/index.mjs';

/**
 * 后端 B 的运行时护栏：环境变量解析、超时、重试与串行任务队列。
 * 这些能力不改变业务契约，但保证缺依赖/超时/瞬时错误不会拖垮 HTTP 进程。
 *
 * @owner 后端 B
 */

export function parsePositiveInt(raw, fallback, { min = 1 } = {}) {
  const value = Number(String(raw ?? '').trim());
  if (!Number.isFinite(value) || value < min) return fallback;
  return Math.floor(value);
}

function envValue(env, name) {
  if (!env) return undefined;
  if (Object.prototype.hasOwnProperty.call(env, name)) return env[name];
  return env.config?.[name];
}

/** 先读显式 env，再读集中配置；未声明时返回 fallback，保持原行为。 */
export function runtimeInt(name, fallback, options = {}) {
  return parsePositiveInt(envValue(process.env, name) ?? envValue(config, name), fallback, options);
}

export class TimeoutError extends Error {
  constructor(label, ms) {
    super(label + '超时（' + ms + 'ms）');
    this.name = 'TimeoutError';
    this.code = 'timeout';
    this.ms = ms;
  }
}

/** 给任意 Promise 加超时；无论成功失败都会清掉定时器，避免 event loop 泄漏。 */
export function withTimeout(promise, ms, label = '操作') {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve(promise);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    timer.unref?.();
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 只重试明确可恢复的失败。NotImplementedError 与参数错误不重试，
 * 避免把“缺少语言包”放大成等待很久的 500。
 */
export async function retry(fn, { attempts = 2, delayMs = 250, shouldRetry = () => true, label = 'operation' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error, attempt)) throw error;
      await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

/**
 * 串行队列：tesseract worker 同一时刻只能处理一个 recognize，
 * 并发请求必须在队列里等待，但入参要在调用队列时捕获，不能在轮到时读外部变量。
 */
export function createSerialRunner() {
  let tail = Promise.resolve();
  return function run(task) {
    const started = tail.then(() => task());
    tail = started.catch(() => {});
    return started;
  };
}

export function isTransientError(error) {
  if (!error) return false;
  return !['not_implemented', 'invalid_request', 'unsupported_media_type', 'payload_too_large'].includes(error.code);
}

export function errorCode(error) {
  return (error && error.code) || 'error';
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || '未知错误');
}
