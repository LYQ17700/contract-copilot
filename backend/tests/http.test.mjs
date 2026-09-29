import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { LocalStorage } from '../src/ingest/storage.mjs';
import { config } from '../src/config/index.mjs';
import { probeOcrProvider, resetOcrProvider } from '../src/textproc/ocr/provider.mjs';

const fixture = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'fixtures', 'sample.txt'), 'utf8');

async function withServer(run, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-backend-'));
  const { handler, services } = createApp({ config: { storageDir: dir }, storage: new LocalStorage(dir), ...overrides });
  const server = http.createServer((req, res) => handler(req, res).catch((e) => { res.writeHead(500).end(String(e)); }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    await run(base, services);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('粘贴文本 → 提取条款 → 端到端分析', async () => {
  await withServer(async (base) => {
    const created = await fetch(base + '/api/v1/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: fixture }) });
    assert.equal(created.status, 201);
    const { document, deduped } = await created.json();
    assert.equal(deduped, false);
    assert.equal(document.extension, 'txt');

    const again = await fetch(base + '/api/v1/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: fixture }) });
    assert.equal((await again.json()).deduped, true, '相同内容应命中 sha1 去重');

    const extracted = await fetch(base + '/api/v1/documents/' + document.id + '/extract', { method: 'POST' });
    assert.equal(extracted.status, 200);
    const out = await extracted.json();
    assert.ok(out.preprocessed.clauses.length >= 3);
    assert.ok(out.preprocessed.stats.structured);
    assert.equal(out.preprocessed.flow, undefined, 'flow/map 不应下发给前端');
    assert.deepEqual(out.steps.map((s) => s.state), ['done', 'done', 'done', 'done']);

    const analyzed = await fetch(base + '/api/v1/documents/' + document.id + '/analyze', { method: 'POST' });
    const result = await analyzed.json();
    assert.equal(result.analysis.mock, true);
    assert.ok(result.analysis.findings.length > 0);
  });
});

test('multipart 上传与类型/大小校验', async () => {
  await withServer(async (base) => {
    const form = new FormData();
    form.append('file', new Blob([fixture], { type: 'text/plain' }), 'sample.txt');
    const uploaded = await fetch(base + '/api/v1/documents', { method: 'POST', body: form });
    assert.equal(uploaded.status, 201);

    const bad = new FormData();
    bad.append('file', new Blob(['x']), 'virus.exe');
    const rejected = await fetch(base + '/api/v1/documents', { method: 'POST', body: bad });
    assert.equal(rejected.status, 415);

    const empty = await fetch(base + '/api/v1/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '  ' }) });
    assert.equal(empty.status, 400);

    const missing = await fetch(base + '/api/v1/documents/doc_00000000000000-abc');
    assert.equal(missing.status, 404);

    const unknown = await fetch(base + '/api/v1/nope');
    assert.equal(unknown.status, 404);

    const show = await fetch(base + '/api/v1/documents/not-a-real-doc');
    assert.equal(show.status, 404, '带参数的路由必须能匹配');
    assert.match((await show.json()).error.code, /not_found/);
  });
});

test('health 与路由表可读', async () => {
  await withServer(async (base) => {
    const health = await (await fetch(base + '/health')).json();
    assert.equal(health.ok, true);
    assert.ok(health.ocr.available.includes('stub'));
    const routes = await (await fetch(base + '/__routes')).json();
    assert.ok(routes.routes.some((r) => r.path === '/api/v1/documents/:id/extract'));
  });
});

test('/health 探测不会发起任何外部调用', async () => {
  const realFetch = globalThis.fetch;
  const original = config.ocrProvider;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('探测不应发起外部调用');
  };
  config.ocrProvider = 'vision-llm';
  resetOcrProvider();
  try {
    const probe = await probeOcrProvider();
    assert.equal(probe.name, 'vision-llm');
    assert.equal(typeof probe.ready, 'boolean');
    assert.equal(calls, 0, '/health 只应做本地能力探测');
    assert.equal(probe.chars, undefined, '探测结果不应再包含 recognize 产物');
  } finally {
    globalThis.fetch = realFetch;
    config.ocrProvider = original;
    resetOcrProvider();
  }
});

test('?async=1 立即返回 202 且只解析一次', async () => {
  let runs = 0;
  const fakePipeline = {
    async run(documentId, { onStep } = {}) {
      runs += 1;
      const steps = [{ name: '提取文字', owner: 'A', state: 'running', ms: 0 }];
      onStep?.(steps.map((s) => ({ ...s })));
      await new Promise((resolve) => setTimeout(resolve, 150));
      steps[0] = { ...steps[0], state: 'done', ms: 150 };
      onStep?.(steps.map((s) => ({ ...s })));
      return {
        document: { id: documentId },
        parsed: { documentId, engine: 'fake', text: 'x' },
        preprocessed: { documentId, text: 'x', clauses: [], flow: 'x', map: [], stats: { chars: 1, clauses: 0, structured: false } },
        steps
      };
    }
  };
  await withServer(async (base) => {
    const created = await (await fetch(base + '/api/v1/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: fixture }) })).json();
    const id = created.document.id;

    const started = Date.now();
    const accepted = await fetch(base + '/api/v1/documents/' + id + '/extract?async=1', { method: 'POST' });
    assert.equal(accepted.status, 202);
    assert.ok(Date.now() - started < 120, '202 不应等待解析完成');
    const { job } = await accepted.json();
    assert.ok(['queued', 'running'].includes(job.state));

    const listed = await (await fetch(base + '/api/v1/jobs')).json();
    assert.ok(listed.jobs.some((row) => row.id === job.id), 'GET /api/v1/jobs 应列出任务');

    let record;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      record = (await (await fetch(base + '/api/v1/jobs/' + job.id)).json()).job;
      if (record.state === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(record.state, 'succeeded');
    assert.ok(record.steps.length >= 1, 'advance 应把步骤进度写回任务');
    assert.equal(record.result.preprocessed.flow, undefined, '任务结果同样不下发 flow/map');
    assert.equal(runs, 1, '异步分支不得重复解析');

    const missing = await fetch(base + '/api/v1/documents/no-such-doc/extract?async=1', { method: 'POST' });
    assert.equal(missing.status, 404, '异步分支也要先校验文档存在');
  }, { pipeline: fakePipeline });
});
