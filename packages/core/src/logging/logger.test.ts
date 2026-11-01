import { describe, expect, it } from 'vitest';
import { createLogger, redact } from './logger';

describe('redact', () => {
  it('redacts sensitive keys at any depth, case-insensitively', () => {
    expect(
      redact({
        user: 'u1',
        Authorization: 'Bearer abc',
        meta: { access_token: 'EAAB', nested: [{ secret: 's', ok: 1 }] },
        oauth: { code: 'xyz' },
      }),
    ).toEqual({
      user: 'u1',
      Authorization: '[REDACTED]',
      meta: { access_token: '[REDACTED]', nested: [{ secret: '[REDACTED]', ok: 1 }] },
      oauth: { code: '[REDACTED]' },
    });
  });

  it('drops error messages that may contain upstream payloads', () => {
    const out = redact({ err: new Error('token EAAB123 invalid') }) as { err: Record<string, unknown> };
    expect(JSON.stringify(out)).not.toContain('EAAB123');
    expect(out.err.name).toBe('Error');
  });
});

describe('createLogger', () => {
  it('writes JSON lines with bindings and respects level', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', write: (l) => lines.push(l) }).child({ requestId: 'r1' });
    log.debug('hidden');
    log.info('hello', { token: 't' });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ level: 'info', msg: 'hello', requestId: 'r1', token: '[REDACTED]' });
  });
});
