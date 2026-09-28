import test from 'node:test';
import assert from 'node:assert/strict';
import { newId, sha1, assertDocumentRecord, assertParsedDocument, reply, isReply } from '../src/domain/contracts.mjs';
import { ValidationError } from '../src/domain/errors.mjs';
import { loadConfig, stripComment } from '../src/config/index.mjs';

test('newId 唯一且带前缀', () => {
  const ids = new Set(Array.from({ length: 500 }, () => newId('doc')));
  assert.equal(ids.size, 500);
  assert.ok([...ids][0].startsWith('doc_'));
});

test('sha1 稳定', () => {
  assert.equal(sha1(Buffer.from('合同')).length, 40);
  assert.equal(sha1(Buffer.from('合同')), sha1(Buffer.from('合同')));
});

test('契约校验会挡掉缺字段的对象', () => {
  assert.throws(() => assertDocumentRecord({ id: 'x' }), /DocumentRecord 缺少字段/);
  assert.throws(() => assertParsedDocument({ documentId: 'x' }), /ParsedDocument 缺少字段/);
  const ok = assertDocumentRecord({ id: 'a', originalName: 'a.txt', extension: 'txt', sizeBytes: 1, sha1: 's', storagePath: '/tmp/a', status: 'received', createdAt: '2026-01-01' });
  assert.equal(ok.id, 'a');
});

test('reply 标记可被 HTTP 层识别', () => {
  assert.equal(isReply(reply(201, {})), true);
  assert.equal(isReply({ status: 201 }), false);
});

test('ValidationError 带 400 与 code', () => {
  const error = new ValidationError('坏了');
  assert.equal(error.status, 400);
  assert.equal(error.toJSON().error.code, 'invalid_request');
});

test('stripComment 处理行尾注释与引号', () => {
  assert.equal(stripComment('mock          # mock | remote'), 'mock');
  assert.equal(stripComment('"a b"'), 'a b');
  assert.equal(stripComment('http://x/y#frag'), 'http://x/y#frag');
  assert.equal(stripComment('  '), '');
});

test('配置启动期校验会挡住非法值', () => {
  assert.throws(() => loadConfig({ OCR_PROVIDER: 'nope' }), /OCR_PROVIDER 只能是/);
  assert.equal(loadConfig({ MAX_UPLOAD_MB: '8' }).maxBytes, 8 * 1024 * 1024);
});
