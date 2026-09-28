import fs from 'node:fs';
import path from 'node:path';

/**
 * 冒烟测试：对已启动的服务跑一遍真实链路。
 * 用法：npm start 后另开终端执行 node tools/smoke.mjs [文件路径]
 *
 * @owner 共用
 */
const base = process.env.SMOKE_BASE || 'http://127.0.0.1:5180';
const target = process.argv[2] || path.join('..', 'data', 'samples', '租房合同-含坑.pdf');
const name = path.basename(target);

const health = await (await fetch(base + '/health')).json();
console.log('health  ', health.ok, '| ocr', health.ocr.provider, 'ready=' + health.ocr.probe.ready, '| analyze', health.pod2.mode);

const form = new FormData();
form.append('file', new Blob([fs.readFileSync(target)]), name);
const created = await (await fetch(base + '/api/v1/documents', { method: 'POST', body: form })).json();
if (!created.document) throw new Error(JSON.stringify(created));
const id = created.document.id;
console.log('upload  ', id, created.document.extension, created.document.sizeBytes + 'B', 'deduped=' + created.deduped);

const extracted = await (await fetch(base + '/api/v1/documents/' + id + '/extract', { method: 'POST' })).json();
console.log('extract ', extracted.parsed.engine, 'chars=' + extracted.preprocessed.text.length, 'clauses=' + extracted.preprocessed.clauses.length, 'structured=' + extracted.preprocessed.stats.structured);
console.log('        ', extracted.steps.map((s) => s.owner + ':' + s.name + '=' + s.ms + 'ms').join(' | '));

const analyzed = await (await fetch(base + '/api/v1/documents/' + id + '/analyze', { method: 'POST' })).json();
console.log('analyze ', analyzed.analysis.grade.level, 'findings=' + analyzed.analysis.findings.length, analyzed.analysis.mock ? '(mock)' : '(remote)');
console.log('        ', analyzed.preprocessed.clauses.slice(0, 4).map((c) => c.heading).join(' / '));
