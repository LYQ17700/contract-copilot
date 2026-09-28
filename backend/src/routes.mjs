import { Router } from './http/router.mjs';
import { createDocumentController } from './ingest/document.controller.mjs';
import { probeOcrProvider, availableProviders } from './textproc/ocr/provider.mjs';
import { capabilities } from './ingest/parsers/index.mjs';
import { config } from './config/index.mjs';
import { reply } from './domain/contracts.mjs';

const VERSION = '0.1.0';

/**
 * 路由表。加接口只改这里，保持“一个文件看全 API”。
 *
 * @owner 后端 A
 */
export function buildRoutes({ upload, pipeline, jobs }) {
  const controller = createDocumentController({ upload, pipeline, jobs });
  const router = new Router();

  router.get('/health', async () => ({
    ok: true,
    env: config.env,
    ocr: { provider: config.ocrProvider, available: availableProviders(), probe: await probeOcrProvider() },
    parsers: capabilities(),
    pod2: config.pod2
  }));

  router.get('/version', () => ({ name: 'contract-copilot-backend', version: VERSION, node: process.version }));
  router.get('/__routes', (ctx) => reply(200, { routes: ctx.router.table() }));

  router.post('/api/v1/documents', controller.create, { label: '接收合同（文件/粘贴文本）' });
  router.get('/api/v1/documents', controller.list, { label: '文档列表' });
  router.get('/api/v1/documents/:id', controller.show, { label: '文档详情' });
  router.post('/api/v1/documents/:id/extract', controller.extract, { label: '提取文字并切分条款' });
  router.post('/api/v1/documents/:id/analyze', controller.analyze, { label: '端到端：提取 + 风险识别' });
  router.get('/api/v1/jobs/:id', controller.job, { label: '异步任务状态' });

  return router;
}
