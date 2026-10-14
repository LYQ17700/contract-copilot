import { NotImplementedError, UpstreamError } from '../../domain/errors.mjs';
import { createLogger } from '../../observability/logger.mjs';
import { prepareImages } from '../image-prep.mjs';
import {
  isTransientError,
  retry,
  runtimeInt,
  withTimeout
} from '../runtime.mjs';

/**
 * 视觉大模型 OCR（拍照/扫描件效果最好，也是 tesseract 的兜底）。
 *
 * 设计约束：
 *  - 请求前统一转 PNG，并限制单页字节数，避免 base64 请求体失控；
 *  - 网络错误/429/5xx 重试，配置或体积错误立即失败；
 *  - 只返回逐字转写文本；条款切分仍由 textproc 完成，避免 Provider 越界。
 *
 * @owner 后端 B
 */
const log = createLogger('textproc.ocr.vision');

const EXTRACT_PROMPT = [
  '逐字提取图片或扫描件中的合同文字。',
  '要求：',
  '1. 保留条款编号、标题、段落和换行；表格按行输出，列之间用一个空格分隔。',
  '2. 不要解释、不要补全、不要改写；看不清的字符用「□」标记，不要猜测。',
  '3. 多页图片按顺序输出，页与页之间保留一个空行。',
  '4. 只输出转写正文，不要使用 Markdown 代码块，不要输出 JSON。'
].join('\n');

const STRUCTURED_PROMPT = [
  '逐字提取图片或扫描件中的合同文字，并按条款整理。',
  '只输出一个 JSON 对象，不要输出 Markdown 代码块或解释文字。',
  'JSON 结构：{"transcript":"逐字正文","clauses":[{"heading":"条款编号与标题","text":"该条正文"}]}',
  '要求：',
  '1. transcript 必须保留原文顺序、条款编号、段落和换行，不要改写、不要补全。',
  '2. 表格按行输出，列之间用一个空格分隔；看不清的字符用「□」标记。',
  '3. 不确定条款边界时，clauses 可以少给，不要猜测。'
].join('\n');

function visionConfig(env = process.env) {
  const apiKey = env.VISION_LLM_KEY || env.CONTRACT_COPILOT_LLM_KEY;
  const baseUrl = (env.VISION_LLM_BASE_URL || env.CONTRACT_COPILOT_LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = env.VISION_LLM_MODEL || 'gpt-5-vision';
  return {
    apiKey,
    baseUrl,
    model,
    timeoutMs: runtimeInt('VISION_LLM_TIMEOUT_MS', 90000, { min: 1000 }),
    attempts: runtimeInt('VISION_LLM_RETRIES', 2, { min: 1 }),
    maxBytes: runtimeInt('VISION_MAX_BYTES', 8 * 1024 * 1024, { min: 64 * 1024 })
  };
}

function responseText(json) {
  if (typeof json?.output_text === 'string') return json.output_text;
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .filter(Boolean)
      .join('\n');
  }
  if (Array.isArray(json?.output)) {
    return json.output
      .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
      .map((part) => part?.text || part?.output_text || '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function shouldRetryUpstream(error) {
  return error?.retryable === true || isTransientError(error);
}

function textFrom(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 兼容三种模型输出：纯文本、Markdown JSON 代码块、直接 JSON 对象。
 * 解析失败时返回 transcript，绝不能因为模型多说一句 JSON 就丢掉整页文字。
 */
export function parseVisionOutput(raw) {
  const text = String(raw || '').trim();
  if (!text) return { transcript: '', clauses: [] };
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object') {
      const transcript = textFrom(parsed.transcript) || textFrom(parsed.text) || textFrom(parsed.content);
      const clauses = Array.isArray(parsed.clauses)
        ? parsed.clauses
          .map((clause) => ({
            heading: textFrom(clause?.heading || clause?.title || clause?.marker),
            text: textFrom(clause?.text || clause?.body || clause?.quote)
          }))
          .filter((clause) => clause.heading || clause.text)
        : [];
      if (transcript) return { transcript, clauses };
    }
  } catch {
    // 不是 JSON，按普通转写文本处理。
  }
  return { transcript: text, clauses: [] };
}

function bytesToMb(bytes) {
  return (Number(bytes || 0) / 1024 / 1024).toFixed(1) + 'MB';
}

async function requestVision({ pages, cfg, structured }) {
  const imageContent = pages.map((page) => ({
    type: 'image_url',
    image_url: {
      url: 'data:image/png;base64,' + page.toString('base64'),
      detail: 'high'
    }
  }));
  const body = {
    model: cfg.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: structured ? STRUCTURED_PROMPT : EXTRACT_PROMPT },
          ...imageContent
        ]
      }
    ]
  };
  const res = await withTimeout(
    fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify(body)
    }),
    cfg.timeoutMs,
    '视觉模型请求'
  );
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new UpstreamError(
      'vision-llm',
      '视觉模型调用失败 HTTP ' + res.status + (json?.error?.message ? '：' + json.error.message : '')
    );
    error.retryable = res.status === 429 || res.status >= 500;
    throw error;
  }
  const text = responseText(json);
  if (!text.trim()) throw new UpstreamError('vision-llm', '视觉模型返回内容为空');
  return parseVisionOutput(text);
}

export function visionLlmProvider() {
  const cfg = visionConfig();
  return {
    name: 'vision-llm',
    async ready() {
      if (!cfg.apiKey) return { ready: false, code: 'not_implemented', reason: '未配置 VISION_LLM_KEY（或 CONTRACT_COPILOT_LLM_KEY）' };
      return {
        ready: true,
        model: cfg.model,
        maxBytes: cfg.maxBytes,
        timeoutMs: cfg.timeoutMs,
        retries: cfg.attempts
      };
    },
    async recognize(buffer, options = {}) {
      if (!cfg.apiKey) throw new NotImplementedError('未配置 VISION_LLM_KEY（或 CONTRACT_COPILOT_LLM_KEY）', '后端 B');
      const prepared = await prepareImages(buffer, { filename: options.filename || '' });
      const oversized = prepared.pages.find((page) => page.length > cfg.maxBytes);
      if (oversized) {
        throw new NotImplementedError(
          '视觉模型单页图片超过 ' + bytesToMb(cfg.maxBytes) + '（当前 ' + bytesToMb(oversized.length) + '），请压缩或降低分辨率',
          '后端 B'
        );
      }

      const structured = String(process.env.VISION_LLM_STRUCTURED ?? '') === '1';
      const parsed = await retry(
        () => requestVision({ pages: prepared.pages, cfg, structured }),
        {
          attempts: cfg.attempts,
          delayMs: 500,
          shouldRetry: shouldRetryUpstream,
          label: 'vision-llm'
        }
      );
      if (!parsed.transcript.trim()) throw new UpstreamError('vision-llm', '视觉模型返回内容为空');

      const notices = [
        ...(prepared.notices || []),
        '文字由视觉模型转写，未经逐字校对，重要合同请人工复核'
      ];
      if (parsed.clauses.length) notices.push('视觉模型返回了 ' + parsed.clauses.length + ' 条条款线索，最终切分仍以后端 B 的条款切分器为准');
      log.info('recognize done', {
        pages: prepared.pages.length,
        bytes: prepared.pages.reduce((sum, page) => sum + page.length, 0),
        model: cfg.model,
        clausesHint: parsed.clauses.length
      });
      return {
        text: parsed.transcript,
        confidence: null,
        pageCount: prepared.pages.length,
        clauses: parsed.clauses,
        notices
      };
    }
  };
}
