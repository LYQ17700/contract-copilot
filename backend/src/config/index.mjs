import fs from 'node:fs';
import path from 'node:path';

/**
 * 配置集中入口。所有模块只从这里取值，不在业务代码里读 process.env。
 * 缺失关键项时在启动阶段就失败，避免跑到一半才炸。
 *
 * @owner 共用（后端 A 维护）
 */
const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** .env 里的值支持行尾注释与引号包裹：KEY=abc  # 注释 / KEY="a b"。 */
export function stripComment(raw) {
  const value = String(raw || '').trim();
  if (value.startsWith('"')) return value.replace(/^"(.*)"$/, '$1');
  return value.replace(/\s+#.*$/, '').trim();
}

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = stripComment(line.slice(eq + 1));
  }
  return out;
}

const int = (value, fallback) => (Number.isInteger(Number(value)) && String(value).trim() !== '' ? Number(value) : fallback);
const list = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
const abs = (value, fallback) => path.resolve(ROOT, value || fallback);

export function loadConfig(overrides = {}) {
  const file = { ...parseEnvFile(path.join(ROOT, '.env')), ...parseEnvFile(path.join(ROOT, '.env.example')) };
  const env = { ...file, ...process.env, ...overrides };
  const cfg = {
    root: ROOT,
    env: env.NODE_ENV || 'development',
    port: int(env.PORT, 5180),
    host: env.HOST || '127.0.0.1',
    logLevel: env.LOG_LEVEL || 'info',
    storageDir: abs(env.STORAGE_DIR, './var/uploads'),
    varDir: abs('./var'),
    maxBytes: int(env.MAX_UPLOAD_MB, 12) * 1024 * 1024,
    allowedExtensions: list(env.ALLOWED_EXTENSIONS || 'pdf,docx,txt,md,png,jpg,jpeg'),
    ocrProvider: env.OCR_PROVIDER || 'stub',
    tessdataPrefix: env.TESSDATA_PREFIX || '',
    nodeModules: env.CONTRACT_COPILOT_NODE_MODULES || '',
    pod2: {
      baseUrl: (env.POD2_BASE_URL || 'http://127.0.0.1:5178').replace(/\/+$/, ''),
      mode: env.ANALYZE_MODE || 'mock'
    },
    jobTtlMs: int(env.JOB_TTL_MIN, 30) * 60 * 1000,
    jobSweepMs: int(env.JOB_SWEEP_MIN, 5) * 60 * 1000,
    corsOrigins: list(env.CORS_ORIGINS || '*'),
    staticDir: env.STATIC_DIR ? abs(env.STATIC_DIR, '.') : ''
  };
  if (cfg.maxBytes <= 0) throw new Error('配置错误：MAX_UPLOAD_MB 必须为正整数');
  if (cfg.jobTtlMs <= 0 || cfg.jobSweepMs <= 0) throw new Error('配置错误：JOB_TTL_MIN / JOB_SWEEP_MIN 必须为正整数');
  if (!['stub', 'tesseract', 'vision-llm'].includes(cfg.ocrProvider)) {
    throw new Error('配置错误：OCR_PROVIDER 只能是 stub | tesseract | vision-llm，当前为 ' + cfg.ocrProvider);
  }
  return cfg;
}

export const config = loadConfig();
