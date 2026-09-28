import { requireBundle } from '../src/deps.mjs';
const chromium = requireBundle('playwright').chromium;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:5178/', { waitUntil: 'networkidle' });
await page.click('button.chip[data-sample="租房合同-含坑.pdf"]');
await page.waitForSelector('.finding', { timeout: 20000 });
await page.waitForTimeout(600);
const counts = await page.evaluate(() => ({
  findings: document.querySelectorAll('.finding').length,
  marks: document.querySelectorAll('mark').length,
  clauses: document.querySelectorAll('.clause').length,
  stages: document.querySelectorAll('.pipeline li').length,
  grade: document.querySelector('.grade')?.textContent,
  health: document.querySelector('#health')?.innerText.replace(/\n/g, ' / ')
}));
console.log(JSON.stringify(counts, null, 1));
await page.screenshot({ path: 'outputs/ui-full.png', fullPage: false });
await page.click('.tab[data-tab="report"]');
await page.waitForTimeout(300);
await page.screenshot({ path: 'outputs/ui-report.png' });
await page.click('.tab[data-tab="kb"]');
await page.waitForTimeout(600);
await page.screenshot({ path: 'outputs/ui-kb.png' });
await page.click('button.chip[data-sample="租房合同-规范对照.txt"]');
await page.waitForTimeout(1500);
const clean = await page.evaluate(() => ({ findings: document.querySelectorAll('.finding').length, grade: document.querySelector('.grade')?.textContent, summary: document.querySelector('.summary-text h2')?.textContent, marks: document.querySelectorAll('mark').length }));
console.log('clean sample:', JSON.stringify(clean));
await page.screenshot({ path: 'outputs/ui-clean.png' });
await page.click('button.chip[data-sample="租房合同-含坑.pdf"]');
await page.waitForSelector('.finding', { timeout: 20000 });
await page.click('.tab[data-tab="findings"]');
await page.waitForTimeout(200);
await page.click('.finding.high');
await page.waitForTimeout(700);
await page.screenshot({ path: 'outputs/ui-focus.png' });
console.log('errors:', JSON.stringify(errors));
await browser.close();
