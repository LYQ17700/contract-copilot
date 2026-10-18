import { ValidationError } from '../domain/errors.mjs';

/**
 * multipart/form-data 逐块流式解析（只取 name/filename 两个字段，够用且可控）。
 *
 * 设计要点：
 * - 不把整个请求体读进内存：文件正文以块为单位逐块写入 openTmp 提供的临时写流，
 *   边写边累计 sha1 与字节数，避免 >10MB 合同 OOM。
 * - 为处理 boundary 跨块被截断，仅保留正文尾部 carry（长度 = 边界长 - 1），其余立即写走。
 * - parseMultipart(buffer, contentType) 保留给需要一次性缓冲的场景（测试/工具）。
 *
 * @owner 后端 A
 */

const boundaryOf = (contentType) => {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw new ValidationError('Content-Type 缺少 multipart boundary');
  return Buffer.from('--' + (match[1] || match[2]));
};

function parseHeaders(headerText) {
  const name = /name="([^"]*)"/i.exec(headerText)?.[1] || '';
  const filename = /filename="([^"]*)"/i.exec(headerText)?.[1];
  return { name, filename };
}

/**
 * 流式解析 multipart。
 * @param {NodeJS.ReadableStream} req   HTTP 请求流
 * @param {string} contentType
 * @param {object} opts
 * @param {number} [opts.limit]            请求体上限（字节）
 * @param {(meta:{name:string,filename:string})=>Promise<{write:(c:Buffer)=>Promise|void, end:()=>Promise<object>}>} opts.openTmp
 * @returns {Promise<{fields:object, files:Array>}>}
 */
export async function parseMultipartStream(req, contentType, { limit = 0, openTmp } = {}) {
  if (typeof openTmp !== 'function') throw new ValidationError('缺少 openTmp（上传接收回调）');
  const boundary = boundaryOf(contentType);
  const HEAD = Buffer.concat([boundary, Buffer.from('\r\n')]);
  const CRLF = Buffer.from('\r\n\r\n');
  const BODY_END = Buffer.concat([Buffer.from('\r\n'), boundary]); // \r\n--boundary
  const totalLimit = limit > 0 ? limit : Infinity;

  const fields = {};
  const files = [];
  let total = 0;
  const bump = (n) => { total += n; if (total > totalLimit) throw new ValidationError('请求体过大，上限 ' + Math.round(totalLimit / 1024 / 1024) + 'MB'); };

  const iter = req[Symbol.asyncIterator]();
  const readChunk = async () => {
    const { value, done } = await iter.next();
    if (done) return null;
    bump(value.length);
    return Buffer.from(value);
  };

  const ERROR_NEWLINE_EOF = () => new ValidationError('multipart 未正常结束（header 不完整）');

  /**
   * 读取一个 part 的 header，返回 { headerText, bodyCarry }。
   * @param {Buffer} carry  上一个 part 消费后剩余（可能是下一 part 头部起点），可能为空
   */
  async function readHeader(carry) {
    let buf = carry;
    for (;;) {
      const idx = buf.indexOf(CRLF);
      if (idx >= 0) {
        const headerText = buf.subarray(0, idx).toString('utf8');
        // 拦截异常：若 header 里带 \r\n 由上一个 part 粘连导致，取真实首个 CRLF 前内容即可（上面已按首个 indexOf 处理）
        return { headerText, bodyCarry: buf.subarray(idx + CRLF.length) };
      }
      if (buf.length > 8192) throw new ValidationError('multipart 头部字段过长');
      const chunk = await readChunk();
      if (chunk === null) throw ERROR_NEWLINE_EOF();
      buf = Buffer.concat([buf, chunk]);
    }
  }

  // —— 跨过首个 HEAD ——（累积缓冲直到找到 HEAD；找不到时丢弃能安全丢弃的开头）
  let initial = Buffer.alloc(0);
  for (;;) {
    const idx = initial.indexOf(HEAD);
    if (idx >= 0) { initial = initial.subarray(idx + HEAD.length); break; }
    if (initial.length > HEAD.length * 2) {
      // 前缀不是 multipart：保留尾部可能为 HEAD 前缀
      initial = initial.subarray(initial.length - HEAD.length);
    }
    const chunk = await readChunk();
    if (chunk === null) throw new ValidationError('multipart 开头格式不正确');
    initial = Buffer.concat([initial, chunk]);
  }

  let header = await readHeader(initial);
  let terminated = false;

  while (!terminated) {
    const { name, filename } = parseHeaders(header.headerText);
    const isFile = filename !== undefined && filename !== '';
    let tmp = null;
    if (isFile) tmp = await openTmp({ name, filename });
    let carry = header.bodyCarry;

    // 消费正文直到 \r\n--boundary（或 \r\n--boundary-- 结束）。
    // 关键：只有确认出 partIdx 后续至少 2 字节（判断是否 "--" 终止）才消费边界，
    // 边界恰好落在 carry 末尾时保留等待，避免把终止标记当下一 header 误读。
    for (;;) {
      const partIdx = carry.indexOf(BODY_END);
      if (partIdx >= 0) {
        const afterLimit = partIdx + BODY_END.length + 2; // 需要再往后的 2 字节
        if (carry.length < afterLimit) {
          // 边界在尾部，还不足以判断是否终止：已确定正文写走，边界段保留等待更多数据
          if (partIdx > 0) {
            let body = carry.subarray(0, partIdx);
            if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) body = body.subarray(0, body.length - 2);
            if (body.length > 0) {
              if (isFile) await tmp.write(body);
              else fields[name] = (fields[name] || '') + body.toString('utf8');
            }
            carry = carry.subarray(partIdx); // 保留 \r\n--boundary...
          }
          const chunk = await readChunk();
          if (chunk === null && carry.length >= BODY_END.length) break; // 恰好到末尾，交给外层判断
          if (chunk === null) throw new ValidationError('multipart 未正常结束（正文不完整）');
          carry = Buffer.concat([carry, chunk]);
          continue;
        }
        // 已确认边界后续内容足够
        let body = carry.subarray(0, partIdx);
        if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) body = body.subarray(0, body.length - 2);
        if (body.length > 0) {
          if (isFile) await tmp.write(body);
          else fields[name] = (fields[name] || '') + body.toString('utf8');
        }
        const after = carry[partIdx + BODY_END.length];
        if (after === 45) { terminated = true; break; }
        // 非终止：\r\n--boundary\r\n --> 吃头部 \r\n，剩下作为下一 part header 起始
        let restTail = carry.subarray(partIdx + BODY_END.length);
        if (restTail.length >= 2 && restTail[0] === 13 && restTail[1] === 10) restTail = restTail.subarray(2);
        header = await readHeader(restTail);
        break;
      } else {
        // 未找到结束：写走除尾部（可能为 BODY_END 前缀）外的正文
        const keep = BODY_END.length - 1;
        if (carry.length > keep) {
          const flushable = carry.subarray(0, carry.length - keep);
          if (flushable.length > 0) {
            if (isFile) await tmp.write(flushable);
            else fields[name] = (fields[name] || '') + flushable.toString('utf8');
          }
          carry = carry.subarray(carry.length - keep);
        }
        const chunk = await readChunk();
        if (chunk === null) throw new ValidationError('multipart 未正常结束（正文不完整）');
        carry = Buffer.concat([carry, chunk]);
      }
    }

    if (isFile) {
      const info = await tmp.end();
      files.push({ name, filename, ...info });
      tmp = null;
    }
  }

  return { fields, files };
}

/**
 * 一次性缓冲解析（保留给测试 / 一次性小请求）。
 * 返回结构：{ fields: {name:string}, files: [{ name, filename, data:Buffer }] }
 */
export function parseMultipart(buffer, contentType) {
  const boundary = boundaryOf(contentType);
  const HEAD = Buffer.concat([boundary, Buffer.from('\r\n')]);
  const CRLF = Buffer.from('\r\n\r\n');
  const PART_END = Buffer.concat([Buffer.from('\r\n'), boundary]);
  const fields = {};
  const files = [];
  let cursor = buffer.indexOf(HEAD);
  if (cursor < 0) return { fields, files };
  cursor += HEAD.length;
  while (cursor < buffer.length) {
    const crlfIdx = buffer.indexOf(CRLF, cursor);
    if (crlfIdx < 0) break;
    const { name, filename } = parseHeaders(buffer.subarray(cursor, crlfIdx).toString('utf8'));
    const bodyStart = crlfIdx + CRLF.length;
    const endIdx = buffer.indexOf(PART_END, bodyStart);
    if (endIdx < 0) break;
    let body = buffer.subarray(bodyStart, endIdx);
    if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) body = body.subarray(0, body.length - 2);
    if (filename !== undefined && filename !== '') files.push({ name, filename, data: body });
    else fields[name] = body.toString('utf8');
    const after = buffer[endIdx + PART_END.length];
    if (after === 45) break;
    cursor = endIdx + PART_END.length + 2;
  }
  return { fields, files };
}