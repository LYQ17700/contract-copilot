import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config } from '../config/index.mjs';

/**
 * 定位可用的第三方解析库。当前不写死依赖：优先用本机已存在的运行时目录，
 * 正式工程化时（npm i pdfjs-dist jszip）会自动落到 backend/node_modules。
 *
 * @owner 共用
 */
function candidates() {
  const list = [];
  if (config.nodeModules) list.push(config.nodeModules);
  list.push(path.join(config.root, 'node_modules'));
  const runtimes = path.join(os.homedir(), '.cache', 'codex-runtimes');
  try {
    for (const dir of fs.readdirSync(runtimes)) list.push(path.join(runtimes, dir, 'dependencies', 'node', 'node_modules'));
  } catch {}
  list.push(path.join(process.cwd(), 'node_modules'));
  return list.filter(Boolean);
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
  throw new Error('未找到 pdfjs-dist。请执行 npm install pdfjs-dist jszip，或设置 CONTRACT_COPILOT_NODE_MODULES 指向包含它们的 node_modules。');
}

export function bundleFile(...parts) {
  return path.join(modulesRoot(), ...parts);
}

export async function importBundle(...parts) {
  const { pathToFileURL } = await import('node:url');
  return import(pathToFileURL(bundleFile(...parts)).href);
}

export function requireBundle(name) {
  const req = createRequire(path.join(modulesRoot(), 'resolver.cjs'));
  return req(name);
}

export function hasModule(name) {
  try {
    return fs.existsSync(path.join(modulesRoot(), name));
  } catch {
    return false;
  }
}
