import { eq, sql } from 'drizzle-orm';
import type { Database, DbTx } from '../../db/client';
import { withResumeRetry } from '../../db/resume-retry';
import { rowsOf } from '../../db/rows';
import { users } from '../../db/schema';

export interface VerifiedIdentity {
  /** Token issuer, e.g. https://cognito-idp.us-east-2.amazonaws.com/<poolId>. */
  issuer: string;
  /** Cognito `sub`. */
  subject: string;
  email: string;
  displayName?: string;
}

/**
 * Creates (or links) the user row for a verified identity. Runs at sign-in callback after the
 * ID token and its `email_verified` claim were checked. Uses the SECURITY DEFINER function
 * app.register_user(), so it needs no RLS context.
 */
export async function registerUser(db: Database, identity: VerifiedIdentity): Promise<string> {
  const result = await withResumeRetry(() =>
    db.execute(
      sql`select app.register_user(${identity.issuer}, ${identity.subject}, ${identity.email}, ${identity.displayName ?? ''}) as id`,
    ),
  );
  const id = rowsOf<{ id: string | null }>(result)[0]?.id;
  if (!id) throw new Error('register_user returned no id');
  return id;
}

/** Maps a verified access token's issuer + subject to a user id; null when not registered. */
export async function resolveUserId(db: Database, issuer: string, subject: string): Promise<string | null> {
  const result = await withResumeRetry(() =>
    db.execute(sql`select app.resolve_user(${issuer}, ${subject}) as id`),
  );
  return rowsOf<{ id: string | null }>(result)[0]?.id ?? null;
}

export async function getCurrentUserProfile(tx: DbTx, userId: string) {
  const [row] = await tx
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}
