/**
 * 统一错误类型。HTTP 层只认 AppError 的 code/status，业务层不要自己 res.end。
 *
 * @owner 共用
 */
export class AppError extends Error {
  constructor(message, { code = 'internal_error', status = 500, details = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
    this.expose = true;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details ?? undefined } };
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { code: 'invalid_request', status: 400, details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = '资源不存在', details) {
    super(message, { code: 'not_found', status: 404, details });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(limitBytes) {
    super('文件超过大小上限 ' + Math.round(limitBytes / 1024 / 1024) + 'MB', {
      code: 'payload_too_large',
      status: 413,
      details: { limitBytes }
    });
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(extension, allowed) {
    super('不支持的文件类型：' + (extension || '(无扩展名)'), {
      code: 'unsupported_media_type',
      status: 415,
      details: { allowed }
    });
  }
}

export class NotImplementedError extends AppError {
  constructor(slot, owner) {
    super('尚未实现：' + slot + (owner ? '（负责人 ' + owner + '）' : ''), { code: 'not_implemented', status: 501 });
  }
}

export class UpstreamError extends AppError {
  constructor(service, message, status = 502) {
    super(message, { code: 'upstream_error', status, details: { service } });
  }
}
