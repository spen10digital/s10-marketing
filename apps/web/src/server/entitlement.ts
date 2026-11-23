import 'server-only';
import type { DbTx } from '@s10/core/db';
import type { OrgSummary } from '@s10/core/domain';
import { checkEntitlement, type CheckEntitlementInput, type EntitlementCheckResult } from '@s10/core/suite';
import { getCognitoSettings } from './auth/cognito';
import type { Session } from './auth/session';
import { getSuiteClient } from './suite';

export type MarketingCheck = Omit<CheckEntitlementInput, 'suiteAccountId' | 'orgId' | 'key'> & {
  key?: CheckEntitlementInput['key'];
  tx?: DbTx;
};

/**
 * THE entitlement check for this app. It asks the Suite as the signed-in person (60 s cache,
 * 5 s timeout, fail closed) and then applies the local overrides. Every page, action and route
 * that needs a decision calls this (directly or through `requireOrgActor`), never the plan data.
 */
export async function checkMarketingEntitlement(
  session: Pick<Session, 'accessToken' | 'subject'>,
  org: Pick<OrgSummary, 'id' | 'suiteAccountId'>,
  check: MarketingCheck = {},
): Promise<EntitlementCheckResult> {
  const { tx, key, ...rest } = check;
  if (!org.suiteAccountId) {
    // Cannot happen for an organization made by sign-in; an unlinked one has no Suite answer to trust.
    return {
      allowed: false,
      accountId: '',
      orgId: org.id,
      key: key ?? 'app.access',
      limit: null,
      used: 0,
      remaining: null,
      reason: 'not_in_plan',
      suiteReason: 'not-in-plan',
      source: 'suite_api',
    };
  }
  const [client, settings] = await Promise.all([getSuiteClient(), getCognitoSettings()]);
  return checkEntitlement(
    {
      appId: settings.appId,
      tx,
      entitlements: (accountId) =>
        client.entitlements({ accessToken: session.accessToken, sub: session.subject }, accountId),
    },
    { ...rest, key: key ?? 'app.access', suiteAccountId: org.suiteAccountId, orgId: org.id },
  );
}
