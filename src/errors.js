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
