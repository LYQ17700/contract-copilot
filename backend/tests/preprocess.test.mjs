import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, cnNumber } from '../src/textproc/preprocess.mjs';
import { isClauseHeading, splitClauses } from '../src/textproc/clause-splitter.mjs';
import { buildFlow } from '../src/textproc/flow.mjs';

test('normalize 处理 CRLF、全角空格与尾部空白', () => {
  assert.equal(normalize('甲方：\u3000某公司\r\n乙方：X   '), '甲方： 某公司\n乙方：X');
});

test('cnNumber 覆盖合同常见写法', () => {
  assert.equal(cnNumber('一'), 1);
  assert.equal(cnNumber('三'), 3);
  assert.equal(cnNumber('十二'), 12);
  assert.equal(cnNumber('二十'), 20);
  assert.equal(cnNumber('二十五'), 25);
  assert.equal(cnNumber('两'), 2);
  assert.equal(cnNumber('2000'), 2000);
  assert.equal(cnNumber('甲'), null);
});

test('splitClauses 产出的偏移能还原原文', () => {
  const text = normalize('标题行\n\n第一条 房屋情况\n甲方将房屋出租。\n\n第二条 租金\n月租金1000元。');
  const clauses = splitClauses(text);
  assert.deepEqual(clauses.map((c) => c.heading), ['合同首部', '第一条 房屋情况', '第二条 租金']);
  for (const clause of clauses) {
    assert.equal(text.slice(clause.start, clause.end), clause.body, '偏移错位: ' + clause.heading);
  }
});

test('无编号文本退化为段落切分', () => {
  const clauses = splitClauses(normalize('第一段内容\n\n第二段内容'));
  assert.equal(clauses.length, 2);
});

test('支持一、附件一、Article 3 与 1. 等编号体系', () => {
  const text = normalize([
    '一、租金与押金',
    '月租金2000元。',
    '（一）押金为一个月租金',
    '（二）租金按月支付',
    '附件一 房屋设施清单',
    '床、桌、洗衣机。',
    'Article 3 Payment',
    'The tenant pays monthly.',
    '4. Miscellaneous',
    'Other terms.'
  ].join('\n'));
  const clauses = splitClauses(text);
  assert.deepEqual(clauses.map((c) => c.heading), [
    '一、租金与押金',
    '附件一 房屋设施清单',
    'Article 3 Payment',
    '4. Miscellaneous'
  ]);
  assert.equal(clauses[0].items.length, 2);
  assert.equal(clauses[0].items[0].marker, '（一）押金为一个月租金');
  assert.equal(clauses[2].items.length, 0);
});

test('不是标题的正文行不会被误切', () => {
  assert.equal(isClauseHeading('一、'), true);
  assert.equal(isClauseHeading('一、租金与押金'), true);
  assert.equal(isClauseHeading('  4. Miscellaneous'), true);
  assert.equal(isClauseHeading('（一）押金为一个月租金'), false);
  assert.equal(isClauseHeading('甲方：某公司'), false);
  assert.equal(isClauseHeading('本条自2026年1月1日起生效。'), false);
});

test('所有条款与款项偏移都能还原原文', () => {
  const text = normalize([
    '房屋租赁合同',
    '第一条 租金',
    '月租金2000元。',
    '（一）押金为一个月租金',
    '第二条 违约责任',
    '提前退租的，押金不退。'
  ].join('\n'));
  const clauses = splitClauses(text);
  for (const clause of clauses) {
    assert.equal(text.slice(clause.start, clause.end), clause.body, '条款偏移错位: ' + clause.heading);
    for (const item of clause.items || []) {
      assert.equal(text.slice(item.start, item.end), item.text, '款项偏移错位: ' + item.id);
    }
  }
});

test('buildFlow 抹平 PDF 硬换行且可映射回原文', () => {
  const text = '第一条 期限\n租赁期共25年，自2026年10月1日起\n至2051年9月30日止。';
  const { flow, map } = buildFlow(text);
  assert.match(flow, /租赁期共25年，自2026年10月1日起至2051年9月30日止。/);
  const at = flow.indexOf('至2051年');
  assert.ok(at > 0);
  assert.equal(text[map[at]], '至');
});
