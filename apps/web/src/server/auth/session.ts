import 'server-only';
import { safeReturnTo } from '@s10/core/auth';
import { resolveUserId } from '@s10/core/domain';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from '../db';
import { getVerifiers } from './cognito';
import { COOKIES } from './cookies';

export interface Session {
  userId: string;
  /** Cognito `sub`. */
  subject: string;
}

/**
 * The signed-in user for this request, or null. Every call verifies the access token (signature,
 * issuer, client, expiry) and maps `sub` to a user id; it never trusts cookie contents alone.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIES.accessToken)?.value;
  if (!token) return null;
  const { settings, verifiers } = await getVerifiers();
  let subject: string;
  try {
    subject = (await verifiers.access.verify(token)).sub;
  } catch {
    return null; // expired or invalid: the caller refreshes or signs in again
  }
  const userId = await resolveUserId(await getDb(), settings.issuer, subject);
  return userId ? { userId, subject } : null;
});

/** For pages: the session, or a redirect to refresh (when possible) or sign in. */
export async function requireSession(returnTo = '/dashboard'): Promise<Session> {
  const session = await getSession();
  if (session) return session;
  const hasRefresh = Boolean((await cookies()).get(COOKIES.refreshToken)?.value);
  const target = hasRefresh ? '/api/auth/refresh' : '/api/auth/login';
  redirect(`${target}?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`);
}
