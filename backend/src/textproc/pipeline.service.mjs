import fs from 'node:fs/promises';
import { parseDocument } from '../ingest/parsers/index.mjs';
import { preprocess } from './preprocess.service.mjs';
import { createLogger } from '../observability/logger.mjs';

/**
 * 端到端文本流水线：documentId → 取文件 → 解析（含 OCR 兜底）→ 预处理。
 * A 的产出是 ParsedDocument，B 的产出是 PreprocessedDocument，这里把两者串起来并打点。
 *
 * @owner 后端 B
 */
const log = createLogger('textproc.pipeline');

export class ExtractPipeline {
  constructor({ upload, storage }) {
    this.upload = upload;
    this.storage = storage;
  }

  async run(documentId) {
    const steps = [];
    const step = async (name, owner, fn) => {
      const started = Date.now();
      const entry = { name, owner, state: 'running', ms: 0 };
      steps.push(entry);
      try {
        const value = await fn();
        entry.state = 'done';
        entry.ms = Date.now() - started;
        return value;
      } catch (error) {
        entry.state = 'failed';
        entry.ms = Date.now() - started;
        entry.error = error.message;
        throw error;
      }
    };

    const record = await step('定位文档', 'A', () => this.upload.get(documentId));
    const buffer = await step('读取文件', 'A', () => (record.source === 'upload' || record.source === 'paste' ? this.storage.get({ id: record.id, extension: record.extension }) : Promise.reject(new Error('无法定位原始文件'))));
    const parsed = await step('提取文字', 'A', () => parseDocument(record, buffer));
    const preprocessed = await step('文本预处理', 'B', () => preprocess(parsed));
    await this.upload.markStatus(record, 'parsed', { engine: parsed.engine, stats: preprocessed.stats });
    log.info('extract done', { documentId, engine: parsed.engine, clauses: preprocessed.clauses.length });
    return { document: record, parsed, preprocessed, steps };
  }

  async readRaw(documentId) {
    const record = await this.upload.get(documentId);
    return fs.readFile(record.storagePath);
  }
}
