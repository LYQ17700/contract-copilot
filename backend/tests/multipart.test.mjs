import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parseMultipartStream, parseMultipart } from '../src/http/multipart.mjs';
import { ValidationError } from '../src/domain/errors.mjs';

function buildMultipart(boundary, parts, { ending = '--' } = {}) {
    const buf = [];
    for (const p of parts) {
        buf.push('--' + boundary + '\r\n');
        buf.push(p);
        buf.push('\r\n');
    }
    buf.push('--' + boundary + ending + '\r\n');
    return Buffer.from(buf.join(''));
}

function parts(txt) {
    return [
        'Content-Disposition: form-data; name="file"; filename="a.txt"\r\ncontent-type: text/plain\r\n\r\n' + txt,
        'Content-Disposition: form-data; name="note"\r\n\r\nhello',
        'Content-Disposition: form-data; name="file2"; filename="b.pdf"\r\n\r\nPDFDATA'
    ];
}

async function streamAndCollect(buffer, chunkSize, opts = {}) {
    const files = [];
    const fields = {};
    const rawChunks = [];
    let i = 0;
    const size = chunkSize || buffer.length;
    while (i < buffer.length) {
        rawChunks.push(buffer.subarray(i, i + size));
        i += size;
    }
    if (rawChunks.length === 0) rawChunks.push(Buffer.alloc(0));
    const req = Readable.from(rawChunks.map((c) => Buffer.from(c)));
    const openTmp = async ({ filename }) => {
        const chunks = [];
        return {
            async write(c) { chunks.push(Buffer.from(c)); },
            async end() {
                const data = Buffer.concat(chunks);
                return { tmpPath: '/tmp/' + filename, sizeBytes: data.length, sha1: 'sha1:' + data.length };
            },
            async abort() {}
        };
    };
    const out = await parseMultipartStream(req, 'multipart/form-data; boundary=XYZ123', {
        limit: opts.limit,
        openTmp
    });
    return { files: out.files, fields: out.fields };
}

function makeChunks(buffer, chunkSize) {
    const chunks = [];
    let i = 0;
    while (i < buffer.length) { chunks.push(buffer.subarray(i, i + chunkSize)); i += chunkSize; }
    return chunks;
}

test('parseMultipartStream：一次读完，能拿到文件名、正文与字段', async () => {
    const buf = buildMultipart('XYZ123', parts('这是文本内容'));
    const { files, fields } = await streamAndCollect(buf, 1024);
    assert.equal(files.length, 2);
    assert.equal(files[0].filename, 'a.txt');
    assert.equal(files[0].sizeBytes, Buffer.byteLength('这是文本内容'));
    assert.equal(files[1].filename, 'b.pdf');
    assert.equal(files[1].sizeBytes, Buffer.byteLength('PDFDATA'));
    assert.equal(fields.note, 'hello');
});

test('parseMultipartStream：即使每块只有 1 字节也能正确解析（跨块 boundary）', async () => {
    const buf = buildMultipart('XYZ123', parts('非常长的文本正文用于测试跨块边界'));
    const { files, fields } = await streamAndCollect(buf, 2);
    assert.equal(files.length, 2);
    assert.equal(files[0].filename, 'a.txt');
    assert.equal(fields.note, 'hello');
    assert.equal(files[0].sizeBytes, Buffer.byteLength('非常长的文本正文用于测试跨块边界'));
});

test('parseMultipartStream：逐个字节块最极端情况', async () => {
    const buf = buildMultipart('XYZ123', parts('逐字节'));
    const { files, fields } = await streamAndCollect(buf, 1);
    assert.equal(files.length, 2);
    assert.equal(fields.note, 'hello');
    assert.equal(files[0].sizeBytes, Buffer.byteLength('逐字节'));
});

test('parseMultipartStream：超大内容超过 limit 时报错', async () => {
    const big = '汉'.repeat(50000);
    const buf = buildMultipart('XYZ123', parts(big));
    await assert.rejects(() => streamAndCollect(buf, 512, { limit: 1000 }), ValidationError);
});

test('parseMultipart（一次性缓冲）保持与原行为一致', () => {
    const buf = buildMultipart('XYZ123', parts('一次性'));
    const { files, fields } = parseMultipart(buf, 'multipart/form-data; boundary=XYZ123');
    assert.equal(files.length, 2);
    assert.equal(files[0].filename, 'a.txt');
    assert.equal(files[0].data.toString('utf8'), '一次性');
    assert.equal(fields.note, 'hello');
});