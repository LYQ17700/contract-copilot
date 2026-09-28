import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

function candidates() {
  const list = [];
  if (process.env.CONTRACT_COPILOT_NODE_MODULES) list.push(process.env.CONTRACT_COPILOT_NODE_MODULES);
  const runtimes = path.join(os.homedir(), '.cache', 'codex-runtimes');
  try {
    for (const dir of fs.readdirSync(runtimes)) {
      list.push(path.join(runtimes, dir, 'dependencies', 'node', 'node_modules'));
    }
  } catch {}
  list.push(path.join(process.cwd(), 'node_modules'));
  return list;
}

let root;
export function modulesRoot() {
  if (root) return root;
  for (const dir of candidates()) {
    if (fs.existsSync(path.join(dir, 'pdfjs-dist'))) {
      root = dir;
      return root;
    }
  }
  throw new Error('未找到打包的 Node 依赖目录（需要 pdfjs-dist）。可用 CONTRACT_COPILOT_NODE_MODULES 指定。');
}

export function bundleFile(...parts) {
  return path.join(modulesRoot(), ...parts);
}

export async function importBundle(...parts) {
  return import(pathToFileURL(bundleFile(...parts)).href);
}

export function requireBundle(name) {
  const req = createRequire(path.join(modulesRoot(), 'resolver.cjs'));
  return req(name);
}

export function dependencyReport() {
  const has = (p) => fs.existsSync(path.join(modulesRoot(), p));
  return {
    modulesRoot: modulesRoot(),
    pdfjs: has('pdfjs-dist'),
    cmaps: has('pdfjs-dist/cmaps'),
    jszip: has('jszip'),
    tesseract: has('tesseract.js')
  };
}