import { REPLY, isReply } from '../domain/contracts.mjs';
import { ValidationError } from '../domain/errors.mjs';

/**
 * 把 Node 的 req/res 包成一个好用的 ctx：读 body、发 JSON、拿 query/params。
 * 中间件与控制器只接触 ctx，不碰原生 res（除最终 writeHead）。
 *
 * @owner 后端 A
 */
export class Context {
  constructor({ req, res, url, params = {}, requestId, logger }) {
    this.req = req;
    this.res = res;
    this.url = url;
    this.params = params;
    this.query = Object.fromEntries(url.searchParams.entries());
    this.requestId = requestId;
    this.log = logger.child({ requestId });
    this.state = {};
    this.status = 200;
    this.headers = { 'content-type': 'application/json; charset=utf-8' };
  }

  get path() {
    return this.url.pathname;
  }

  get method() {
    return this.req.method;
  }

  header(name) {
    return this.req.headers[name.toLowerCase()] || null;
  }

  set(name, value) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  async rawBody({ limit }) {
    if (this.state.rawBody) return this.state.rawBody;
    const chunks = [];
    let size = 0;
    for await (const chunk of this.req) {
      size += chunk.length;
      if (limit && size > limit) {
        this.req.destroy();
        throw new ValidationError('请求体过大，上限 ' + Math.round(limit / 1024 / 1024) + 'MB');
      }
      chunks.push(chunk);
    }
    this.state.rawBody = Buffer.concat(chunks);
    this.log.debug('body read', { bytes: this.state.rawBody.length });
    return this.state.rawBody;
  }

  async jsonBody({ limit } = {}) {
    const raw = await this.rawBody({ limit });
    if (!raw.length) return {};
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch (error) {
      throw new ValidationError('请求体不是合法 JSON：' + error.message);
    }
  }

  reply(status, body, headers) {
    this.status = status;
    if (headers) Object.assign(this.headers, headers);
    return { [REPLY]: true, status, body, headers: this.headers };
  }

  notModified() {
    return this.reply(304, null);
  }

  async finalize(result) {
    if (this.res.writableEnded) return;
    let status = this.status;
    let body = result;
    let headers = this.headers;
    if (isReply(result)) {
      status = result.status;
      body = result.body;
      headers = { ...headers, ...result.headers };
    } else if (result === undefined) {
      status = status === 200 ? 204 : status;
    }
    let payload = body;
    if (body === null || body === undefined) payload = Buffer.alloc(0);
    else if (Buffer.isBuffer(body)) payload = body;
    else if (typeof body === 'string') payload = Buffer.from(body, 'utf8');
    else payload = Buffer.from(JSON.stringify(body, null, 2) + '\n', 'utf8');
    headers['content-length'] = String(payload.length);
    headers['x-request-id'] = this.requestId;
    this.res.writeHead(status, headers);
    this.res.end(payload.length ? payload : undefined);
  }
}
