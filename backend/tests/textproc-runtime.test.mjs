import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOcrResult, splitOcrLines } from '../src/textproc/ocr/result.mjs';
import { parseVisionOutput } from '../src/textproc/ocr/visionllm.provider.mjs';
import {
  createSerialRunner,
  parsePositiveInt,
  retry,
  TimeoutError,
  withTimeout
} from '../src/textproc/runtime.mjs';

test('parsePositiveInt 只接受有效正整数', () => {
  assert.equal(parsePositiveInt('250', 100), 250);
  assert.equal(parsePositiveInt('12.9', 100), 12);
  assert.equal(parsePositiveInt('abc', 100), 100);
  assert.equal(parsePositiveInt('0', 100, { min: 1 }), 100);
});

test('withTimeout 超时后抛出可识别错误', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 20, '测试任务'),
    (error) => error instanceof TimeoutError && error.code === 'timeout'
  );
});

test('retry 只重试瞬时错误', async () => {
  let attempts = 0;
  const value = await retry(async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('temporary');
      error.code = 'timeout';
      throw error;
    }
    return 'ok';
  }, { attempts: 3, delayMs: 1 });
  assert.equal(value, 'ok');
  assert.equal(attempts, 3);

  await assert.rejects(
    retry(async () => {
      const error = new Error('missing tessdata');
      error.code = 'not_implemented';
      throw error;
    }, { attempts: 3, delayMs: 1, shouldRetry: (error) => error.code !== 'not_implemented' }),
    /missing tessdata/
  );
});

test('createSerialRunner 严格按调用顺序执行', async () => {
  const run = createSerialRunner();
  const order = [];
  const first = run(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push(1);
  });
  const second = run(async () => {
    order.push(2);
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, [1, 2]);
});

test('OCR 结果标准化会合并且分页文本', () => {
  const out = normalizeOcrResult({
    data: {
      pages: [
        { text: '第一页\n内容  ', confidence: 80, rotateRadians: 0.02 },
        { text: '第二页\n内容', confidence: 90 }
      ]
    }
  });
  assert.equal(out.pageCount, 2);
  assert.equal(out.text, '第一页\n内容\n\n第二页\n内容');
  assert.equal(out.confidence, 85);
  assert.equal(out.rotateRadians, 0.02);
  assert.deepEqual(splitOcrLines('a   b\n\n c'), ['a b', '', ' c']);
});

test('视觉模型输出兼容纯文本、JSON 与代码块', () => {
  assert.deepEqual(parseVisionOutput('第一条 租金'), { transcript: '第一条 租金', clauses: [] });
  const parsed = parseVisionOutput('```json\n{"transcript":"第一条 租金","clauses":[{"heading":"第一条","text":"租金"}]}\n```');
  assert.equal(parsed.transcript, '第一条 租金');
  assert.equal(parsed.clauses[0].heading, '第一条');
});
