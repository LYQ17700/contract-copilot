import crypto from 'node:crypto';

/**
 * 后端内部与跨 Pod 的数据契约。A、B 两人只依赖这里定义的结构通信，
 * 改字段先改这个文件并跑 tests/contracts.test.mjs。
 *
 * @owner 共用（改动需在群里同步）
 */

export const DOCUMENT_STATUS = ['received', 'parsed', 'failed'];
export const JOB_STATE = ['queued', 'running', 'succeeded', 'failed'];

export function newId(prefix = '') {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const rand = crypto.randomBytes(3).toString('hex');
  return (prefix ? prefix + '_' : '') + stamp + '-' + rand;
}

export const sha1 = (buffer) => crypto.createHash('sha1').update(buffer).digest('hex');

function require_(obj, fields, label) {
  const missing = fields.filter((f) => obj?.[f] === undefined || obj?.[f] === null);
  if (missing.length) throw new TypeError(label + ' 缺少字段：' + missing.join(', '));
  return obj;
}

/**
 * @typedef {Object} DocumentRecord
 * @property {string} id
 * @property {string} originalName 前端传来的文件名（仅用于展示，不参与路径拼接）
 * @property {string} extension 小写扩展名，不含点
 * @property {string|null} mime
 * @property {number} sizeBytes
 * @property {string} sha1 内容指纹，用于秒传与去重
 * @property {string} storagePath 绝对路径
 * @property {'upload'|'paste'} source
 * @property {string} status DOCUMENT_STATUS 之一
 * @property {string} createdAt ISO 时间
 */
export function assertDocumentRecord(r) {
  return require_(r, ['id', 'originalName', 'extension', 'sizeBytes', 'sha1', 'storagePath', 'status', 'createdAt'], 'DocumentRecord');
}

/**
 * @typedef {Object} ParsedDocument 由 ingest/parsers 产出（后端 A 的产出物）
 * @property {string} documentId
 * @property {string} engine 例如 pdfjs-dist / jszip+ooxml / plain-text / ocr:tesseract
 * @property {string} text 已提取的原始文字（未做条款切分）
 * @property {number} pageCount
 * @property {string[]} notices
 * @property {number} ms
 */
export function assertParsedDocument(p) {
  return require_(p, ['documentId', 'engine', 'text'], 'ParsedDocument');
}

/**
 * @typedef {Object} Clause 条款切片，start/end 是 text 中的字符偏移（用于前端高亮）
 * @property {string} id
 * @property {string} heading
 * @property {string} body
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef {Object} PreprocessedDocument 由 textproc 产出（后端 B 的产出物）
 * @property {string} documentId
 * @property {string} text 归一化后的正文
 * @property {Clause[]} clauses
 * @property {string} flow 回流文本（去掉 PDF 硬换行，供规则/检索匹配）
 * @property {number[]} map flow 下标 → text 下标
 * @property {{chars:number, clauses:number, structured:boolean}} stats
 */
export function assertPreprocessedDocument(p) {
  return require_(p, ['documentId', 'text', 'clauses', 'flow', 'map'], 'PreprocessedDocument');
}

/**
 * @typedef {Object} JobStep 流水线阶段打点，前端左侧「处理流水线」直接渲染
 * @property {string} name
 * @property {string} owner
 * @property {string} state pending|running|done|failed
 * @property {number} ms
 * @property {string} [error]
 */

/**
 * @typedef {Object} JobRecord
 * @property {string} id
 * @property {string} documentId
 * @property {string} state JOB_STATE 之一
 * @property {JobStep[]} steps
 * @property {Object} [result]
 * @property {Object} [error]
 */
export function assertJobRecord(j) {
  return require_(j, ['id', 'documentId', 'state', 'steps'], 'JobRecord');
}

export const REPLY = Symbol('reply');

/** 控制器返回原始响应（文件、重定向、非 JSON 状态码）时使用。 */
export function reply(status, body, headers = {}) {
  return { [REPLY]: true, status, body, headers };
}

export const isReply = (value) => !!value && value[REPLY] === true;
