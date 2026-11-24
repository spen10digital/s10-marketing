import 'server-only';
import { getCurrentUserProfile, type OrgActor, type OrgSummary } from '@s10/core/domain';
import { withDbContext } from '@s10/core/db';
import { createOrgResolver, visibleBusinessIds, type DenialReason, type SuiteMe } from '@s10/core/suite';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getCognitoSettings } from './auth/cognito';
import { getSession, requireSession, type Session } from './auth/session';
import { getDb } from './db';
import { checkMarketingEntitlement } from './entitlement';
import { getSuiteClient } from './suite';

export type SuiteState =
  /** The Suite answered. */
  | 'ok'
  /** The Suite could not be reached or gave an unusable answer: nothing is allowed (fail closed). */
  | 'suite-unavailable'
  /** The Suite refused this person's token. */
  | 'suite-refused';

export interface OrgContext {
  session: Session;
  email: string | null;
  suite: SuiteState;
  /** The Suite's answer, for decisions and brand visibility. null unless `suite` is 'ok'. */
  me: SuiteMe | null;
  /** Organizations (Suite accounts) where this app is on for the person. Empty unless `suite` is 'ok'. */
  orgs: OrgSummary[];
  current: OrgSummary | null;
  /** Suite business ids the person may see in the current organization; a brand outside this set is hidden. */
  visibleBusinessIds: Set<string>;
}

let resolver: { appId: string; value: ReturnType<typeof createOrgResolver> } | undefined;

/**
 * The user's organizations and the selected one. Organizations ARE Suite accounts: they come
 * from the Suite's answer (`/api/v1/me`) and are created on first use for any account. When
 * the Suite cannot be reached nothing is read from memberships kept earlier and nothing is
 * written: the context is empty and the pages say so (fail closed).
 *
 * The selection cookie is only a preference: honoured only when it names one of these orgs.
 */
export const getOrgContext = cache(async (): Promise<OrgContext> => {
  const session = await requireSession();
  const settings = await getCognitoSettings();
  if (resolver?.appId !== settings.appId) {
    resolver = { appId: settings.appId, value: createOrgResolver({ appId: settings.appId }) };
  }
  const db = await getDb();
  const result = await resolver.value.resolve({
    client: await getSuiteClient(),
    db,
    userId: session.userId,
    accessToken: session.accessToken,
    sub: session.subject,
  });
  if (result.state !== 'ok') {
    return {
      session,
      email: session.email ?? null,
      suite: result.state,
      me: null,
      orgs: [],
      current: null,
      visibleBusinessIds: new Set(),
    };
  }
  const email =
    session.email ??
    (await withDbContext(db, { userId: session.userId }, (tx) => getCurrentUserProfile(tx, session.userId)))
      ?.email ??
    null;
  const preferred = (await cookies()).get(settings.names.currentOrg)?.value;
  const current = result.orgs.find((o) => o.id === preferred) ?? result.orgs[0] ?? null;
  return {
    session,
    email,
    suite: 'ok',
    me: result.me,
    orgs: result.orgs,
    current,
    visibleBusinessIds: visibleBusinessIds(result.accounts, current?.suiteAccountId ?? null),
  };
});

export interface ActorOptions {
  /** The page or action creates or changes something: Viewers may only view. */
  write?: boolean;
  /** The Suite business (brand) it acts on. */
  businessId?: string;
}

/**
 * For pages and actions that need an organization AND permission to use S10/Marketing there:
 * the entitlement check (the Suite, fail closed) runs here, so no page can skip it. People who
 * cannot be let in land on /no-access with the reason.
 */
export async function requireOrgActor(
  options: ActorOptions = {},
): Promise<OrgActor & { org: OrgSummary; session: Session }> {
  const { session, current } = await getOrgContext();
  if (!current) redirect('/no-access');
  const decision = await checkMarketingEntitlement(session, current, {
    write: options.write,
    businessId: options.businessId,
  });
  if (!decision.allowed) redirect(`/no-access?reason=${decision.suiteReason ?? 'not-in-plan'}`);
  return { userId: session.userId, orgId: current.id, role: current.role, org: current, session };
}

export type ApiActorResult =
  | { ok: true; actor: OrgActor & { session: Session } }
  | {
      ok: false;
      reason: 'unauthenticated' | 'suite-unavailable' | 'no-access' | 'denied';
      /** The Suite's reason when `reason` is 'denied'. */
      suiteReason?: DenialReason;
    };

/**
 * For API routes, which answer with a status instead of redirecting: the signed-in user's
 * selected organization if the Suite lets them in, or why not.
 */
export async function getOrgActorForApi(options: ActorOptions = {}): Promise<ApiActorResult> {
  const session = await getSession();
  if (!session) return { ok: false, reason: 'unauthenticated' };
  const { suite, current } = await getOrgContext();
  if (suite === 'suite-unavailable') return { ok: false, reason: 'suite-unavailable' };
  if (suite === 'suite-refused') return { ok: false, reason: 'unauthenticated' };
  if (!current) return { ok: false, reason: 'no-access' };
  const decision = await checkMarketingEntitlement(session, current, {
    write: options.write,
    businessId: options.businessId,
  });
  if (!decision.allowed) {
    return decision.suiteReason === 'suite-unavailable'
      ? { ok: false, reason: 'suite-unavailable' }
      : { ok: false, reason: 'denied', suiteReason: decision.suiteReason };
  }
  return { ok: true, actor: { userId: session.userId, orgId: current.id, role: current.role, session } };
}
