import 'server-only';
import { readSession, safeReturnTo, unseal } from '@s10/core/auth';
import { resolveUserId } from '@s10/core/domain';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from '../db';
import { getCognitoSettings } from './cognito';

export interface Session {
  userId: string;
  /** Cognito `sub` in the Suite's user pool. */
  subject: string;
  email?: string;
  name?: string;
  /** Cognito access token: the bearer token for Suite API calls. */
  accessToken: string;
}

/**
 * The signed-in user for this request, or null. The session cookie is sealed with the app's
 * secret, so it is trusted as issued (tokens were verified when it was set); `sub` is mapped to
 * a user id through `user_identities` on every request, never from cookie contents alone.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const settings = await getCognitoSettings();
  const s = readSession(await unseal(jar.get(settings.names.session)?.value, settings.secret));
  if (!s) return null; // missing or access token expired: the caller refreshes or signs in again
  const userId = await resolveUserId(await getDb(), settings.issuer, s.sub);
  return userId ? { userId, subject: s.sub, email: s.email, name: s.name, accessToken: s.accessToken } : null;
});

/** For pages: the session, or a redirect to refresh (when possible) or sign in. */
export async function requireSession(returnTo = '/dashboard'): Promise<Session> {
  const session = await getSession();
  if (session) return session;
  const settings = await getCognitoSettings();
  const hasRefresh = Boolean((await cookies()).get(settings.names.refresh)?.value);
  const target = hasRefresh ? '/api/auth/refresh' : '/api/auth/login';
  redirect(`${target}?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`);
}
