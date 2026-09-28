import fs from 'node:fs';
const form = new FormData();
form.append('file', new Blob([fs.readFileSync('data/samples/租房合同-含坑.pdf')]), '租房合同-含坑.pdf');
const j = await (await fetch('http://127.0.0.1:5178/api/analyze', { method: 'POST', body: form })).json();
fs.writeFileSync('outputs/示例报告-含坑合同.md', j.report, 'utf8');
console.log('report bytes', j.report.length, 'findings', j.findings.length, 'citations', j.findings.reduce((n, f) => n + f.citations.length, 0));
