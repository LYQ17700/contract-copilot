import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { requireBundle } from '../src/lib/runtime-deps.mjs';
import { imageFormatOf, prepareImages } from '../src/textproc/image-prep.mjs';

async function sharp() {
  return requireBundle('sharp');
}

test('PNG 直接复用原始字节', async () => {
  const sharpLib = await sharp();
  const png = await sharpLib({
    create: { width: 32, height: 16, channels: 3, background: { r: 255, g: 255, b: 255 } }
  }).png().toBuffer();
  const prepared = await prepareImages(png);
  assert.equal(prepared.format, 'png');
  assert.equal(prepared.pageCount, 1);
  assert.deepEqual(prepared.pages[0], png);
});

test('多页 TIFF 拆成多张 PNG', async () => {
  const tiff = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'fixtures', 'multi-page.tiff'));

  const prepared = await prepareImages(tiff, { filename: 'contract.tiff' });
  assert.equal(imageFormatOf(tiff, 'contract.tiff'), 'tiff');
  assert.equal(prepared.pageCount, 2);
  assert.equal(prepared.pages.length, 2);
  assert.equal(prepared.pages.every((page) => page.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))), true);
  assert.notDeepEqual(prepared.pages[0], prepared.pages[1]);
  assert.match(prepared.notices.join(' '), /2 页 TIFF/);
});

test('不支持的图片格式会明确失败', async () => {
  await assert.rejects(
    prepareImages(Buffer.from('this is not an image'), { filename: 'fake.txt' }),
    (error) => error.code === 'not_implemented'
  );
});
