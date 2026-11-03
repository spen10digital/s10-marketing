import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../errors/app-error';
import type { Database, DbTx } from './client';
import { withResumeRetry, type ResumeRetryOptions } from './resume-retry';

/**
 * Who a database transaction acts for. Users see what their memberships allow; system actors
 * (workers) act for exactly one organization (02 §3.2).
 */
export type DbContext = { userId: string } | { systemOrgId: string };

const uuid = z.uuid();

/**
 * Runs `fn` in one transaction whose first statement sets the RLS context with
 * `set_config(..., is_local => true)`, so it cannot leak into another request on the same
 * connection. Every query in the app goes through here (CLAUDE.md).
 */
export async function withDbContext<T>(
  db: Database,
  context: DbContext,
  fn: (tx: DbTx) => Promise<T>,
  retry?: ResumeRetryOptions,
): Promise<T> {
  const statement = contextStatement(context);
  return withResumeRetry(
    () =>
      db.transaction(async (tx) => {
        await tx.execute(statement);
        return fn(tx);
      }),
    retry,
  );
}

export function contextStatement(context: DbContext) {
  if ('userId' in context) {
    const userId = parseId(context.userId);
    return sql`select set_config('app.user_id', ${userId}, true), set_config('app.actor', 'user', true), set_config('app.org_id', '', true)`;
  }
  const orgId = parseId(context.systemOrgId);
  return sql`select set_config('app.user_id', '', true), set_config('app.actor', 'system', true), set_config('app.org_id', ${orgId}, true)`;
}

function parseId(value: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new AppError('INTERNAL', 'Invalid database context');
  return parsed.data;
}
