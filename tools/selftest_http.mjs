import fs from 'node:fs';
const base = 'http://127.0.0.1:5178';
const health = await (await fetch(base + '/api/health')).json();
console.log('health:', JSON.stringify(health.llm), health.kb.size, 'deps.pdfjs=' + health.deps.pdfjs);
for (const name of ['租房合同-含坑.pdf', '租房合同-规范对照.txt', '租房合同-规范对照.docx']) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync('data/samples/' + name)]), name);
  const res = await fetch(base + '/api/analyze', { method: 'POST', body: form });
  const j = await res.json();
  console.log(name, '→', res.status, j.grade?.level, 'score=' + j.score, 'findings=' + (j.findings?.length ?? 0), 'verified=' + j.stats?.verified, 'engine=' + j.document?.engine, 'report=' + (j.report?.length ?? 0) + 'B');
}
const paste = await fetch(base + '/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: fs.readFileSync('data/samples/租房合同-含坑.txt', 'utf8') }) });
const pj = await paste.json();
console.log('paste →', paste.status, pj.grade?.level, 'findings=' + (pj.findings?.length ?? 0));
const err = await fetch(base + '/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '这是一份合作协议，没有租房条款。' }) });
const ej = await err.json();
console.log('empty →', err.status, ej.grade?.level, 'findings=' + (ej.findings?.length ?? 0), 'error=' + (ej.error || '-'));
const page = await fetch(base + '/');
console.log('index.html →', page.status, (await page.text()).length, 'bytes');
const js = await fetch(base + '/app.js');
console.log('app.js →', js.status, (await js.text()).length, 'bytes');
