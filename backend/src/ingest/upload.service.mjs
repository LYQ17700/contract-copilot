import path from 'node:path';
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
