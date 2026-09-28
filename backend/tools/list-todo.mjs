import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 汇总所有 @todo(后端A-x) / @todo(后端B-x) 槽位，用于站会与迭代看板。
 * 用法：npm run todo
 *
 * @owner 共用
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = process.argv[2];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'var' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const rows = [];
for (const file of walk(ROOT)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const match = /@todo\((后端[AB](?:-共用)?[-\d]*)\)\s*(.*)/.exec(line);
    if (match) rows.push({ owner: match[1], todo: match[2], where: path.relative(ROOT, file) + ':' + (i + 1) });
  });
}
const filtered = OWNER ? rows.filter((r) => r.owner.includes(OWNER)) : rows;
const width = Math.max(...filtered.map((r) => r.owner.length), 6);
for (const row of filtered) {
  console.log(row.owner.padEnd(width) + '  ' + row.todo);
  console.log(' '.repeat(width) + '  → ' + row.where);
}
console.log('\n合计 ' + filtered.length + ' 个待填槽位' + (OWNER ? '（' + OWNER + '）' : '') + '。');
