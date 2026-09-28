import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../src/pod1/parse.mjs';
import { dependencyReport } from '../src/deps.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
console.log('deps:', JSON.stringify(dependencyReport(), null, 2));
const files = fs.readdirSync(path.join(root, 'data/samples')).map((f) => 'data/samples/' + f);
for (const rel of files) {
  const buffer = fs.readFileSync(path.join(root, rel));
  const doc = await parseDocument({ buffer, filename: rel });
  console.log('\n=== ' + rel + ' ===');
  console.log('engine=' + doc.engine + ' pages=' + doc.pageCount + ' chars=' + doc.text.length + ' clauses=' + doc.clauses.length + ' ms=' + doc.ms);
  console.log('headings:', doc.clauses.map((c) => c.heading).join(' | '));
  console.log('sample:', JSON.stringify(doc.text.slice(0, 160)));
}

