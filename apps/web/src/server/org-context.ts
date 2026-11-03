import 'server-only';
import { withDbContext } from '@s10/core/db';
import { getCurrentUserProfile, listMyOrganizations, type OrgActor, type OrgSummary } from '@s10/core/domain';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { requireSession, type Session } from './auth/session';
import { COOKIES } from './auth/cookies';
import { getDb } from './db';

export interface OrgContext {
  session: Session;
  email: string | null;
  orgs: OrgSummary[];
  current: OrgSummary | null;
}

/**
 * The user's organizations and the selected one. The selection cookie is only a preference: it
 * is honoured only when it names an org the user is a member of (never trust client org ids).
 */
export const getOrgContext = cache(async (): Promise<OrgContext> => {
  const session = await requireSession();
  const db = await getDb();
  const { orgs, profile } = await withDbContext(db, { userId: session.userId }, async (tx) => ({
    orgs: await listMyOrganizations(tx, session.userId),
    profile: await getCurrentUserProfile(tx, session.userId),
  }));
  const preferred = (await cookies()).get(COOKIES.currentOrg)?.value;
  const current = orgs.find((o) => o.id === preferred) ?? orgs[0] ?? null;
  return { session, email: profile?.email ?? null, orgs, current };
});

/** For pages and actions that need an organization; users without one go to onboarding. */
export async function requireOrgActor(): Promise<OrgActor & { org: OrgSummary; session: Session }> {
  const { session, current } = await getOrgContext();
  if (!current) redirect('/orgs/new');
  return { userId: session.userId, orgId: current.id, role: current.role, org: current, session };
}
