import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { review } from '../src/pipeline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['data/samples/租房合同-含坑.txt', 'data/samples/租房合同-规范对照.txt', 'data/samples/租房合同-含坑.pdf'];
for (const rel of files) {
  const result = await review({ buffer: fs.readFileSync(path.join(root, rel)), filename: rel });
  console.log('\n########## ' + rel);
  console.log('engine=' + result.document.engine + ' chars=' + result.document.chars + ' clauses=' + result.document.clauses.length);
  console.log('grade=' + result.grade.level + ' score=' + result.score + ' findings=' + result.stats.total + ' verified=' + result.stats.verified + ' needsReview=' + result.stats.needsReview);
  console.log('facts=' + JSON.stringify(result.facts));
  console.log('stages=' + result.stages.map((s) => s.name + ':' + s.ms + 'ms').join(' | '));
  result.findings.forEach((f) => console.log('  [' + f.severity + '] ' + f.clauseHeading + ' · ' + f.name + ' · 引用' + f.citations.length + '条 · ' + (f.status === 'verified' ? 'OK' : 'REVIEW') + ' · ' + f.evidence.slice(0, 46)));
  if (result.stats.needsReview) result.findings.filter((f) => f.status !== 'verified').forEach((f) => console.log('   ! 未通过: ' + f.name + ' | quoteOk=' + f.checks.quoteOk + ' | cites=' + f.checks.citationCount));
  console.log('notices=' + JSON.stringify(result.notices));
}
