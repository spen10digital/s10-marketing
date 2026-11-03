import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { contextStatement } from './context';
import { toPositional } from './executors';
import { checksum } from './migrate';
import { isDatabaseResuming, withResumeRetry } from './resume-retry';
import { pgErrorCode } from './rows';
import { splitSqlStatements } from './sql-split';

describe('splitSqlStatements', () => {
  it('splits on top-level semicolons only', () => {
    const sql = `
      -- a comment; with a semicolon
      create table t (a text default 'x;y', "b;c" int);
      /* block; comment */
      create function f() returns int language sql as $$ select 1; $$;
      do $body$ begin perform 1; end $body$;
      select 'it''s; fine'
    `;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(4);
    expect(out[0]).toContain(`'x;y'`);
    expect(out[1]).toContain('$$ select 1; $$');
    expect(out[2]).toContain('$body$ begin perform 1; end $body$');
    expect(out[3]).toContain(`'it''s; fine'`);
  });

  it('drops comment-only fragments and rejects unterminated quotes', () => {
    expect(splitSqlStatements('-- nothing here;\n;')).toEqual([]);
    expect(() => splitSqlStatements("select 'oops")).toThrow(/Unterminated/);
    expect(() => splitSqlStatements('select $$ oops')).toThrow(/Unterminated/);
  });

  it('splits migration 0001 into executable statements', async () => {
    const sql = await readFile(
      join(import.meta.dirname, '../../../../db/migrations/0001_core_tenancy.sql'),
      'utf8',
    );
    const statements = splitSqlStatements(sql);
    expect(statements.length).toBeGreaterThan(50);
    for (const s of statements) expect(s.trim().endsWith(';')).toBe(false);
  });
});

describe('checksum', () => {
  it('ignores CRLF vs LF', () => {
    expect(checksum('a\r\nb')).toBe(checksum('a\nb'));
    expect(checksum('a')).not.toBe(checksum('b'));
  });
});

describe('toPositional', () => {
  it('maps named params and leaves casts alone', () => {
    const { text, values } = toPositional('select :a::uuid, :b, :a, :missing', { a: '1', b: '2' });
    expect(text).toBe('select $1::uuid, $2, $1, :missing');
    expect(values).toEqual(['1', '2']);
  });
});

describe('contextStatement', () => {
  const dialect = new PgDialect();

  it('sets user context transaction-locally and clears the system org', () => {
    const q = dialect.sqlToQuery(contextStatement({ userId: '7f1c1f0e-2b4c-4b8e-9a51-3c1d2e4f5a6b' }));
    expect(q.sql).toContain(`set_config('app.user_id', $1, true)`);
    expect(q.sql).toContain(`set_config('app.actor', 'user', true)`);
    expect(q.sql).toContain(`set_config('app.org_id', '', true)`);
    expect(q.params).toEqual(['7f1c1f0e-2b4c-4b8e-9a51-3c1d2e4f5a6b']);
  });

  it('sets system context for exactly one org', () => {
    const q = dialect.sqlToQuery(contextStatement({ systemOrgId: '7f1c1f0e-2b4c-4b8e-9a51-3c1d2e4f5a6b' }));
    expect(q.sql).toContain(`set_config('app.actor', 'system', true)`);
    expect(q.sql).toContain(`set_config('app.user_id', '', true)`);
  });

  it('rejects anything that is not a uuid', () => {
    expect(() => contextStatement({ userId: "x', true); drop table users; --" })).toThrow();
  });
});

describe('withResumeRetry', () => {
  const resuming = Object.assign(new Error('resuming'), { name: 'DatabaseResumingException' });

  it('retries while Aurora resumes, including when wrapped', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(resuming)
      .mockRejectedValueOnce(new Error('wrapped', { cause: resuming }))
      .mockResolvedValue('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withResumeRetry(fn, { sleep })).resolves.toBe('ok');
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after the time budget and never retries other errors', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(withResumeRetry(() => Promise.reject(resuming), { sleep, maxWaitMs: 3_000 })).rejects.toBe(
      resuming,
    );
    const other = new Error('boom');
    const fn = vi.fn().mockRejectedValue(other);
    await expect(withResumeRetry(fn, { sleep })).rejects.toBe(other);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isDatabaseResuming(other)).toBe(false);
  });
});

describe('pgErrorCode', () => {
  it('reads node-postgres codes and Data API messages', () => {
    expect(pgErrorCode(new Error('x', { cause: { code: '23505' } }))).toBe('23505');
    expect(pgErrorCode(new Error('ERROR: duplicate key; SQLState: 23505'))).toBe('23505');
    expect(pgErrorCode(new Error('nope'))).toBeUndefined();
  });
});
