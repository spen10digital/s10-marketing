import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { withDbContext } from '../db/context';
import { rowsOf } from '../db/rows';
import type { OrgSummary } from '../domain/orgs/service';
import { slugify } from '../domain/slug';
import type { SuiteMe, SuiteMeAccount } from './client';
import { suiteRoleToMarketingRole, type SuiteRole } from './seams';

/**
 * Tenancy mapping (Proposed, `docs/phases/suite-integration.md`): a Suite account is a Marketing
 * organization and a Suite business is a Marketing brand. The local tables keep their uuid keys
 * and carry the Suite ids in `suite_account_id` / `suite_business_id`, so no foreign key changes.
 *
 * Nothing is seeded. When a person signs in and the Suite says they may use this app on an
 * account, the organization is created on first use for ANY account, exactly as for a customer.
 * Roles come from the Suite on every sync.
 */

/** Plan 2.4: is this app on for this business? A missing field counts as empty (fail closed). */
export function appActiveOn(
  account: { per_business_apps?: string[] },
  business: { apps?: string[]; enabled_apps?: string[] },
  appId: string,
): boolean {
  if ((account.per_business_apps ?? []).includes(appId)) return (business.enabled_apps ?? []).includes(appId);
  return (business.apps ?? []).includes(appId) || (business.enabled_apps ?? []).includes(appId);
}

export interface SyncAccount {
  accountId: string;
  name: string;
  role: SuiteRole;
  businesses: { businessId: string; name: string }[];
}

/**
 * The accounts (and the businesses in them) where this person may use this app, from `/api/v1/me`.
 * An account the app is not on gets no organization and the person's membership there is removed.
 */
export function accountsToSync(me: SuiteMe, appId: string): SyncAccount[] {
  const out: SyncAccount[] = [];
  for (const account of me.accounts) {
    const businesses = account.businesses
      .filter((b) => appActiveOn(account, b, appId))
      .map((b) => ({ businessId: b.business_id, name: b.name }));
    if (businesses.length === 0 && !accountHasAppSeat(account, appId)) continue;
    out.push({ accountId: account.account_id, name: accountName(account), role: account.role, businesses });
  }
  return out;
}

function accountHasAppSeat(account: SuiteMeAccount, appId: string): boolean {
  if ((account.per_business_apps ?? []).includes(appId)) return false; // needs a business with it enabled
  return (account.apps ?? []).includes(appId);
}

function accountName(account: SuiteMeAccount): string {
  return (account.display_name ?? account.name).trim() || 'Workspace';
}

interface LinkedOrgRow {
  o_org_id: string;
  o_suite_account_id: string;
  o_name: string;
  o_slug: string;
  o_timezone: string;
  o_role: OrgSummary['role'];
}

/**
 * Creates (first use) or updates the organizations for these accounts, sets this person's role
 * in each from the Suite and removes their membership in any Suite-linked organization that is
 * not listed. Returns the person's Suite-linked organizations.
 *
 * Call it only with an answer the Suite really gave. When the Suite cannot be reached, do not
 * call it at all: a missing answer must not look like "no accounts" and must change nothing.
 */
export async function syncSuiteOrganizations(
  db: Database,
  userId: string,
  accounts: SyncAccount[],
): Promise<OrgSummary[]> {
  const payload = accounts.map((a) => ({
    account_id: a.accountId,
    name: a.name,
    slug: slugify(a.name),
    role: suiteRoleToMarketingRole(a.role),
  }));
  const result = await withDbContext(db, { userId }, (tx) =>
    tx.execute(sql`select * from app.sync_suite_orgs(${JSON.stringify(payload)}::jsonb)`),
  );
  return rowsOf<LinkedOrgRow>(result).map((r) => ({
    id: r.o_org_id,
    suiteAccountId: r.o_suite_account_id,
    name: r.o_name,
    slug: r.o_slug,
    timezone: r.o_timezone,
    role: r.o_role,
  }));
}
