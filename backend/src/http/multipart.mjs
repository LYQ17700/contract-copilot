import { ValidationError } from '../domain/errors.mjs';

/**
 * multipart/form-data 解析（只取 name/filename 两个字段，够用且可控）。
 * 换成 busboy/multer 时，保持 parseMultipart(buffer, contentType) 的返回结构即可。
 *
 * @owner 后端 A
 * @todo(后端A) 目前一次性读进内存，>10MB 的合同应改为流式落盘
 */
export function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw new ValidationError('Content-Type 缺少 multipart boundary');
  const boundary = Buffer.from('--' + (match[1] || match[2]));
  const fields = {};
  const files = [];
  let cursor = buffer.indexOf(boundary);
  while (cursor >= 0) {
    const start = cursor + boundary.length + 2;
    const next = buffer.indexOf(boundary, start);
    if (next < 0) break;
    const slice = buffer.subarray(start, Math.max(start, next - 2));
    const split = slice.indexOf('\r\n\r\n');
    if (split > 0) {
      const head = slice.subarray(0, split).toString('utf8');
      const name = /name="([^"]*)"/i.exec(head)?.[1] || '';
      const filename = /filename="([^"]*)"/i.exec(head)?.[1];
      const data = slice.subarray(split + 4);
      if (filename !== undefined && filename !== '') files.push({ name, filename, data });
      else fields[name] = data.toString('utf8');
    }
    cursor = next;
  }
  return { fields, files };
}
