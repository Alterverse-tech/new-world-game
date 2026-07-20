// 沉重律（《眠海》第五章第三律）：内容不是被平台删除，而是潜流拒绝为它凝结。
// 拒绝与校验失败类响应统一携带这句 lore。
export const GRAVITY_LAW_LORE = '沉重律：过于沉重之物，浮不起来。';

export class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends HttpError {
  constructor(message, details = undefined) {
    super(422, 'validation_failed', message, details);
    this.name = 'ValidationError';
  }
}

export function asHttpError(error) {
  if (error instanceof HttpError) return error;
  if (error?.code === 'ENOENT') {
    return new HttpError(404, 'not_found', 'Resource not found');
  }
  return new HttpError(500, 'internal_error', 'Internal server error');
}
