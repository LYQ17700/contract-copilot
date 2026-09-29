import { config } from '../config/index.mjs';
import { parseMultipart } from '../http/multipart.mjs';
import { ValidationError } from '../domain/errors.mjs';
import { analyze, serializePreprocessed } from '../analyze/pod2.client.mjs';

/**
 * 文档相关接口。控制器只做“取参 + 调服务 + 组装响应”，不写业务逻辑。
 *
 * @owner 后端 A
 */
export function createDocumentController({ upload, pipeline, jobs }) {
  async function create(ctx) {
    const contentType = ctx.header('content-type') || '';
    let stored;
    if (contentType.includes('multipart/form-data')) {
      const buffer = await ctx.rawBody({ limit: config.maxBytes });
      const { files, fields } = parseMultipart(buffer, contentType);
      const file = files.find((f) => f.name === 'file') || files[0];
      if (file) stored = await upload.receiveFile({ filename: file.filename, data: file.data });
      else if (fields.text) stored = await upload.receiveText({ text: fields.text, filename: fields.filename });
      else throw new ValidationError('multipart 中既没有 file 也没有 text 字段');
    } else {
      const body = await ctx.jsonBody({ limit: config.maxBytes });
      if (body.text) stored = await upload.receiveText({ text: body.text, filename: body.filename });
      else throw new ValidationError('请上传文件（multipart file 字段）或提交 JSON { text }');
    }
    return ctx.reply(201, {
      document: stored.record,
      deduped: stored.deduped,
      next: 'POST /api/v1/documents/' + stored.record.id + '/extract'
    });
  }

  async function show(ctx) {
    return { document: await upload.get(ctx.params.id) };
  }

  async function list(ctx) {
    return { documents: await upload.list({ limit: Math.min(Number(ctx.query.limit) || 50, 200) }) };
  }

  async function extract(ctx) {
    if (ctx.query.async === '1') {
      const document = await upload.get(ctx.params.id);
      const job = jobs.create({ documentId: document.id, kind: 'extract' });
      Promise.resolve()
        .then(() => pipeline.run(document.id, { onStep: (steps) => jobs.advance(job.id, steps) }))
        .then((r) => jobs.finish(job.id, { result: { steps: r.steps, preprocessed: serializePreprocessed(r.preprocessed) } }))
        .catch((error) => jobs.finish(job.id, { error }));
      return ctx.reply(202, { job, hint: 'GET /api/v1/jobs/' + job.id });
    }
    const result = await pipeline.run(ctx.params.id);
    return {
      document: result.document,
      parsed: { ...result.parsed, text: undefined, textChars: (result.parsed.text || '').length },
      preprocessed: serializePreprocessed(result.preprocessed),
      steps: result.steps
    };
  }

  async function analyzeDocument(ctx) {
    const result = await pipeline.run(ctx.params.id);
    const analysis = await analyze(result.preprocessed);
    return {
      document: result.document,
      preprocessed: serializePreprocessed(result.preprocessed),
      analysis,
      steps: [...result.steps, { name: '风险识别', owner: 'Pod2', state: 'done', ms: 0 }]
    };
  }

  async function job(ctx) {
    const record = jobs.get(ctx.params.id);
    if (!record) return ctx.reply(404, { error: { code: 'not_found', message: '任务不存在或已过期' } });
    return { job: record };
  }

  async function listJobs(ctx) {
    return { jobs: jobs.list({ limit: Math.min(Number(ctx.query.limit) || 50, 200) }) };
  }

  return { create, show, list, extract, analyze: analyzeDocument, job, jobs: listJobs };
}
