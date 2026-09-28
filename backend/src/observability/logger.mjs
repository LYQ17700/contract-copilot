import { config } from '../config/index.mjs';

/**
 * 极简结构化日志：一行一条 JSON，字段稳定，方便后面接 ELK / 云日志。
 * 用法：const log = createLogger('ingest.upload'); log.info('received', { documentId });
 *
 * @owner 共用
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function emit(level, scope, message, meta) {
  if ((LEVELS[level] ?? 20) < threshold) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, scope, message, ...meta });
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}

export function createLogger(scope, bindings = {}) {
  const child = (level) => (message, meta = {}) => emit(level, scope, message, { ...bindings, ...meta });
  return {
    scope,
    debug: child('debug'),
    info: child('info'),
    warn: child('warn'),
    error: child('error'),
    child: (extra) => createLogger(scope, { ...bindings, ...extra })
  };
}

export const logger = createLogger('app');
