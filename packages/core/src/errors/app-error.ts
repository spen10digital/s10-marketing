export const APP_ERROR_CODES = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CONFIG_INVALID: 500,
  INTERNAL: 500,
  UPSTREAM_UNAVAILABLE: 503,
} as const;

export type AppErrorCode = keyof typeof APP_ERROR_CODES;

/**
 * Typed application error. `message` is safe to show to users; upstream payloads
 * must never be placed in it (05 §2 "Errors").
 */
export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
  }

  get httpStatus(): number {
    return APP_ERROR_CODES[this.code];
  }
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: AppErrorCode; message: string } };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

/** Converts any thrown value to the public error shape without leaking internals. */
export function toErrorResult(err: unknown): Result<never> {
  if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message } };
  return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong.' } };
}
