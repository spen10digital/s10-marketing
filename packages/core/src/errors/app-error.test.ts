import { describe, expect, it } from 'vitest';
import { AppError, ok, toErrorResult } from './app-error';

describe('AppError', () => {
  it('maps codes to HTTP status', () => {
    expect(new AppError('NOT_FOUND', 'Missing').httpStatus).toBe(404);
    expect(new AppError('FORBIDDEN', 'No').httpStatus).toBe(403);
  });

  it('wraps results', () => {
    expect(ok(1)).toEqual({ ok: true, data: 1 });
    expect(toErrorResult(new AppError('CONFLICT', 'Stale version'))).toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'Stale version' },
    });
  });

  it('never leaks unknown error details', () => {
    const result = toErrorResult(new Error('db password=hunter2 rejected'));
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong.' } });
  });
});
