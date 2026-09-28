import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { LocalStorage } from '../src/ingest/storage.mjs';

const fixture = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'fixtures', 'sample.txt'), 'utf8');

async function withServer(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-backend-'));
  const { handler, services } = createApp({ config: { storageDir: dir }, storage: new LocalStorage(dir) });
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
