import crypto from 'node:crypto';

/**
 * 中间件签名：async (ctx, next) => ...，与 Koa/Express 心智一致。
 *
 * @owner 后端 A
 */

export function requestId() {
  return async function requestIdMiddleware(ctx, next) {
    ctx.requestId = ctx.header('x-request-id') || crypto.randomBytes(8).toString('hex');
    ctx.log = ctx.log.child({ requestId: ctx.requestId });
    ctx.set('x-request-id', ctx.requestId);
    return next();
  };
}

export function accessLog(logger) {
  return async function accessLogMiddleware(ctx, next) {
    const started = Date.now();
    let level = 'info';
    try {
      return await next();
    } catch (error) {
      level = (error.status || 500) >= 500 ? 'error' : 'warn';
      throw error;
    } finally {
      logger[level](ctx.method + ' ' + ctx.path, {
        requestId: ctx.requestId,
        status: ctx.status,
        ms: Date.now() - started,
        reqBytes: ctx.state.rawBody?.length || 0
      });
    }
  };
}

export function cors({ origins = ['*'] } = {}) {
  return async function corsMiddleware(ctx, next) {
    const origin = ctx.header('origin');
    if (origin && (origins.includes('*') || origins.includes(origin))) {
      ctx.set('access-control-allow-origin', origin);
      ctx.set('vary', 'origin');
      ctx.set('access-control-allow-headers', 'content-type,x-request-id');
      ctx.set('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
      ctx.set('access-control-max-age', '600');
    }
    if (ctx.method === 'OPTIONS') return ctx.reply(204, null);
    return next();
  };
}

export function errorHandler(logger) {
  return async function errorMiddleware(ctx, next) {
    try {
      const result = await next();
      ctx.state.replyValue = result;
      return result;
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      const payload = status >= 500
        ? { error: { code: 'internal_error', message: '服务端异常，请携带 requestId 排查', requestId: ctx.requestId } }
        : error.toJSON
          ? error.toJSON()
          : { error: { code: error.code || 'error', message: error.message } };
      if (status >= 500) logger.error('unhandled', { requestId: ctx.requestId, path: ctx.path, message: error.message, stack: error.stack });
      else logger.warn('request rejected', { requestId: ctx.requestId, path: ctx.path, code: payload.error.code, message: error.message });
      return ctx.reply(status, payload);
    }
  };
}
