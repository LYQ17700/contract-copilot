import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { config } from './src/config/index.mjs';
import { Context } from './src/http/context.mjs';
import { requestId, accessLog, cors, errorHandler } from './src/http/middleware/index.mjs';
import { buildRoutes } from './src/routes.mjs';
import { LocalStorage } from './src/ingest/storage.mjs';
import { UploadService } from './src/ingest/upload.service.mjs';
import { ExtractPipeline } from './src/textproc/pipeline.service.mjs';
import { MemoryJobStore } from './src/jobs/job.store.mjs';
import { createLogger } from './src/observability/logger.mjs';

/**
 * 组装根：依赖在这里注入，模块内部不 new 单例，方便测试替换。
 * 中间件签名 (ctx, next)，与 Koa/Express 心智一致，将来换框架只需替换本文件。
 *
 * @owner 后端 A
 */
export function createApp(overrides = {}) {
  const cfg = { ...config, ...overrides.config };
  const log = createLogger('http');
  const storage = overrides.storage || new LocalStorage(cfg.storageDir);
  const upload = overrides.upload || new UploadService({ storage });
  const jobs = overrides.jobs || new MemoryJobStore();
  const pipeline = overrides.pipeline || new ExtractPipeline({ upload, storage });
  const router = overrides.router || buildRoutes({ upload, pipeline, jobs });

  const guard = errorHandler(log);
  const chain = [guard, cors({ origins: cfg.corsOrigins }), requestId(), accessLog(log)];

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://' + (req.headers.host || cfg.host));
    const ctx = new Context({ req, res, url, requestId: '-', logger: log });
    ctx.router = router;
    const matched = router.match(req.method, url.pathname);
    ctx.params = matched ? matched.params : {};

    const terminal = async (c) => {
      if (!matched) throw router.notFound(c.path);
      return matched.route.handler(c);
    };
    const dispatch = async (i) => (i >= chain.length ? terminal(ctx) : chain[i](ctx, () => dispatch(i + 1)));

    let result;
    try {
      result = await dispatch(0);
    } catch (error) {
      // 只有 guard 之前的异常会走到这里（例如 URL 解析失败）
      result = ctx.reply((error && error.status) || 500, error && error.toJSON ? error.toJSON() : { error: { code: 'internal_error', message: '服务端异常' } });
    }
    await ctx.finalize(result);
  };
  return { handler, router, services: { storage, upload, jobs, pipeline } };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { handler, router } = createApp();
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      createLogger('http').error('fatal', { message: error.message, stack: error.stack });
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: { code: 'internal_error' } }));
    });
  });
  server.listen(config.port, config.host, () => {
    createLogger('boot').info('listening', { url: 'http://' + config.host + ':' + config.port, routes: router.routes.length, ocr: config.ocrProvider, analyzeMode: config.pod2.mode });
    process.stdout.write('  合同避坑助手 · 后端骨架 → http://' + config.host + ':' + config.port + '/health\n');
  });
}
