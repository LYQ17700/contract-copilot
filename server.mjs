import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { review } from './src/pipeline.mjs';
import { loadKb, kbMeta } from './src/pod2/kb.mjs';
import { loadRules } from './src/pod2/agent.mjs';
import { readAudit } from './src/pod2/trust.mjs';
import { SYSTEM_PROMPT } from './src/pod2/prompts.mjs';
import { llmConfig } from './src/pod2/llm.mjs';
import { dependencyReport } from './src/deps.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const WEB = path.join(ROOT, 'web');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'outputs');
const MAX_BYTES = 12 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body, null, 2), 'utf8');
  res.writeHead(status, { 'content-length': payload.length, 'access-control-allow-origin': '*', ...headers });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error('文件超过 12MB 上限'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw new Error('缺少 multipart boundary');
  const boundary = Buffer.from('--' + (match[1] || match[2]));
  const parts = [];
  let cursor = buffer.indexOf(boundary);
  while (cursor >= 0) {
    const start = cursor + boundary.length + 2;
    const next = buffer.indexOf(boundary, start);
    if (next < 0) break;
    const slice = buffer.subarray(start, next - 2);
    const split = slice.indexOf('\r\n\r\n');
    if (split > 0) {
      const head = slice.subarray(0, split).toString('utf8');
      const name = /name="([^"]*)"/i.exec(head)?.[1] || '';
      const filename = /filename="([^"]*)"/i.exec(head)?.[1];
      parts.push({ name, filename, data: slice.subarray(split + 4) });
    }
    cursor = next;
  }
  return parts;
}

const server_ = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, deps: dependencyReport(), llm: { enabled: llmConfig().enabled, model: llmConfig().model || null }, kb: kbMeta() });
    }
    if (url.pathname === '/api/samples') {
      const dir = path.join(DATA, 'samples');
      const list = fs.readdirSync(dir).map((name) => {
        const file = path.join(dir, name);
        return { name, size: fs.statSync(file).size, kind: path.extname(name).replace('.', '') };
      });
      return send(res, 200, { samples: list });
    }
    if (url.pathname === '/api/sample') {
      const name = String(url.searchParams.get('name') || '');
      const file = path.join(DATA, 'samples', path.basename(name));
      if (!file.startsWith(path.join(DATA, 'samples')) || !fs.existsSync(file)) return send(res, 404, { error: '样例不存在' });
      return send(res, 200, fs.readFileSync(file), { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="' + encodeURIComponent(path.basename(file)) + '"' });
    }
    if (url.pathname === '/api/kb') {
      const doc = JSON.parse(fs.readFileSync(path.join(DATA, 'kb_laws.json'), 'utf8'));
      return send(res, 200, doc);
    }
    if (url.pathname === '/api/rules') {
      return send(res, 200, loadRules());
    }
    if (url.pathname === '/api/prompt') {
      return send(res, 200, { system: SYSTEM_PROMPT, note: '离线演示不依赖大模型；设置 CONTRACT_COPILOT_LLM_KEY 后，该提示词会被真实调用。' });
    }
    if (url.pathname === '/api/audit') {
      return send(res, 200, { records: readAudit(30) });
    }
    if (url.pathname === '/api/report') {
      const id = String(url.searchParams.get('id') || '').replace(/[^0-9a-zA-Z-]/g, '');
      const file = path.join(OUT, id + '.report.md');
      if (!fs.existsSync(file)) return send(res, 404, { error: '报告不存在' });
      return send(res, 200, fs.readFileSync(file), { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="contract-report-' + id + '.md"' });
    }
    if (url.pathname === '/api/analyze' && req.method === 'POST') {
      const body = await readBody(req);
      const type = req.headers['content-type'] || '';
      let filename;
      let buffer;
      let rawText;
      if (type.includes('multipart/form-data')) {
        const parts = parseMultipart(body, type);
        const file = parts.find((p) => p.name === 'file' && p.filename);
        const text = parts.find((p) => p.name === 'text');
        if (file && file.data.length) {
          filename = file.filename;
          buffer = file.data;
        } else if (text && text.data.length) {
          rawText = text.data.toString('utf8');
        } else {
          return send(res, 400, { error: '未收到文件或文本' });
        }
      } else {
        const json = JSON.parse(body.toString('utf8') || '{}');
        rawText = json.text;
        filename = json.filename;
      }
      const result = await review({ buffer, filename, rawText });
      return send(res, 200, result);
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return send(res, 404, '<!doctype html><meta charset="utf-8"><title>404</title><p>页面不存在：<code>' + rel + '</code></p>', { 'content-type': 'text/html; charset=utf-8' });
    }
    return send(res, 200, fs.readFileSync(file), { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  } catch (error) {
    return send(res, 500, { error: error.message, hint: '查看终端日志获取堆栈' });
  }
});

const port = Number(process.env.PORT || 5178);
loadKb();
server_.listen(port, '127.0.0.1', () => {
  console.log('合同避坑助手 demo 已启动 → http://127.0.0.1:' + port + '/');
  console.log('依赖：', JSON.stringify(dependencyReport()));
  console.log('大模型：', llmConfig().enabled ? llmConfig().model : '未启用（离线规则引擎）');
});
