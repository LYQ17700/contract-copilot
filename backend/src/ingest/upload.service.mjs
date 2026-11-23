import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from '../config/index.mjs';
import { newId, sha1, assertDocumentRecord } from '../domain/contracts.mjs';
import { PayloadTooLargeError, UnsupportedMediaTypeError, ValidationError, NotFoundError } from '../domain/errors.mjs';
import { createLogger } from '../observability/logger.mjs';

/**
 * 文档接收：校验 → 指纹 → 落盘 → 建档。只负责“收到并保管好文件”，
 * 不碰解析逻辑（解析在 ingest/parsers，由 registry 分发）。
 *
 * @owner 后端 A
 */
const log = createLogger('ingest.upload');

export class UploadService {
  constructor({ storage } = {}) {
    if (!storage) throw new Error('UploadService 需要 storage');
    this.storage = storage;
    this.cache = new Map();
  }

  extensionOf(filename) {
    const ext = path.extname(String(filename || '')).replace(/^\./, '').toLowerCase();
    return ext || '';
  }

  async receiveFile({ filename, data }) {
    if (!filename) throw new ValidationError('缺少文件名');
    if (!data || !data.length) throw new ValidationError('文件内容为空');
    const extension = this.extensionOf(filename);
    if (!config.allowedExtensions.includes(extension)) throw new UnsupportedMediaTypeError(extension, config.allowedExtensions);
    if (data.length > config.maxBytes) throw new PayloadTooLargeError(config.maxBytes);
    const digest = sha1(data);
    const existing = await this.findBySha1(digest);
    if (existing) {
      log.info('deduped by sha1', { documentId: existing.id, originalName: filename });
      return { record: existing, deduped: true };
    }
    const record = assertDocumentRecord({
      id: newId('doc'),
      originalName: path.basename(String(filename)).slice(0, 180),
      extension,
      mime: null,
      sizeBytes: data.length,
      sha1: digest,
      storagePath: '',
      source: 'upload',
      status: 'received',
      createdAt: new Date().toISOString()
    });
    const stored = await this.storage.put({ id: record.id, extension, buffer: data });
    record.storagePath = stored.path;
    await this.storage.putMeta({ id: record.id, meta: record });
    this.cache.set(record.id, record);
    log.info('stored', { documentId: record.id, bytes: record.sizeBytes, extension });
    return { record, deduped: false };
  }

  async receiveText({ text, filename }) {
    if (!text || !String(text).trim()) throw new ValidationError('粘贴的文本为空');
    if (Buffer.byteLength(text) > config.maxBytes) throw new PayloadTooLargeError(config.maxBytes);
    return this.receiveFile({ filename: filename || 'pasted.txt', data: Buffer.from(String(text), 'utf8') });
  }

  async get(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const record = await this.storage.readMeta({ id });
    if (!record) throw new NotFoundError('文档不存在：' + id);
    this.cache.set(id, record);
    return record;
  }

  /**
   * 流式接收：multipart 解析器边读边把正文写进临时文件，本方法再把临时文件
   * 落位到存储目录，同时完成 sha1 去重。字节数在写入时累计，无需整体进内存。
   * @param {{filename:string, tmpPath:string, sizeBytes:number, sha1:string}} input
   */
  async receiveStreamed({ filename, tmpPath, sizeBytes, sha1 }) {
    if (!filename) throw new ValidationError('缺少文件名');
    if (!tmpPath) throw new ValidationError('缺少临时文件路径');
    if (!sizeBytes) throw new ValidationError('文件内容为空');
    const extension = this.extensionOf(filename);
    if (!config.allowedExtensions.includes(extension)) {
      await fs.promises.unlink(tmpPath).catch(() => {});
      throw new UnsupportedMediaTypeError(extension, config.allowedExtensions);
    }
    if (sizeBytes > config.maxBytes) {
      await fs.promises.unlink(tmpPath).catch(() => {});
      throw new PayloadTooLargeError(config.maxBytes);
    }
    const existing = await this.findBySha1(sha1);
    if (existing) {
      await fs.promises.unlink(tmpPath).catch(() => {});
      log.info('deduped by sha1', { documentId: existing.id, originalName: filename });
      return { record: existing, deduped: true };
    }
    const record = assertDocumentRecord({
      id: newId('doc'),
      originalName: path.basename(String(filename)).slice(0, 180),
      extension,
      mime: null,
      sizeBytes,
      sha1,
      storagePath: '',
      source: 'upload',
      status: 'received',
      createdAt: new Date().toISOString()
    });
    const stored = await this.storage.adopt({ id: record.id, extension, tmpPath });
    record.storagePath = stored.path;
    await this.storage.putMeta({ id: record.id, meta: record });
    this.cache.set(record.id, record);
    log.info('stored(stream)', { documentId: record.id, bytes: record.sizeBytes, extension });
    return { record, deduped: false };
  }

  /** 给 multipart 解析器用的临时写流工厂：正文逐块落盘，正文结束时返回 sha1 与字节数。 */
  createTempSink(tmpDir) {
    fs.mkdirSync(tmpDir, { recursive: true });
    return async ({ filename }) => {
      const tmpPath = path.join(tmpDir, '.tmp-' + crypto.randomBytes(8).toString('hex') + (this.extensionOf(filename) ? '.' + this.extensionOf(filename) : ''));
      const hash = crypto.createHash('sha1');
      let sizeBytes = 0;
      const handle = await fs.promises.open(tmpPath, 'w');
      return {
        tmpPath,
        async write(chunk) {
          if (!chunk || !chunk.length) return;
          sizeBytes += chunk.length;
          if (sizeBytes > config.maxBytes) {
            await handle.close().catch(() => {});
            throw new PayloadTooLargeError(config.maxBytes);
          }
          hash.update(chunk);
          await handle.write(chunk);
        },
        async end() {
          await handle.close();
          return { tmpPath, sizeBytes, sha1: hash.digest('hex') };
        },
        async abort() {
          await handle.close().catch(() => {});
          await fs.promises.unlink(tmpPath).catch(() => {});
        }
      };
    };
  }

  async findBySha1(digest) {
    for (const id of await this.storage.listIds()) {
      const record = await this.storage.readMeta({ id });
      if (record?.sha1 === digest) {
        this.cache.set(id, record);
        return record;
      }
    }
    return null;
  }

  async list({ limit = 50 } = {}) {
    const ids = await this.storage.listIds();
    const records = [];
    for (const id of ids.slice(-limit).reverse()) records.push(await this.storage.readMeta({ id }));
    return records.filter(Boolean);
  }

  async markStatus(record, status, extra = {}) {
    const next = { ...record, status, ...extra };
    assertDocumentRecord(next);
    this.cache.set(record.id, next);
    await this.storage.putMeta({ id: record.id, meta: next });
    return next;
  }
}
