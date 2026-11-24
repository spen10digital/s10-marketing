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

interface LinkedBrandRow {
  o_brand_id: string;
  o_suite_business_id: string;
  o_slug: string;
}

export interface LinkedBrand {
  brandId: string;
  suiteBusinessId: string;
  slug: string;
}

/**
 * Creates (first use) the brand for each Suite business where this app is on, and keeps the
 * name in step with the Suite. For an organization the person is a member of. Same rule as
 * above: only call it with a real answer from the Suite.
 */
export async function syncSuiteBrands(
  db: Database,
  userId: string,
  orgId: string,
  businesses: SyncAccount['businesses'],
): Promise<LinkedBrand[]> {
  const payload = businesses.map((b) => ({
    business_id: b.businessId,
    name: b.name,
    slug: slugify(b.name),
  }));
  const result = await withDbContext(db, { userId }, (tx) =>
    tx.execute(sql`select * from app.sync_suite_brands(${orgId}::uuid, ${JSON.stringify(payload)}::jsonb)`),
  );
  return rowsOf<LinkedBrandRow>(result).map((r) => ({
    brandId: r.o_brand_id,
    suiteBusinessId: r.o_suite_business_id,
    slug: r.o_slug,
  }));
}

/** Organizations and brands for everything the Suite says this person may use here. Returns the organizations. */
export async function syncSuiteTenancy(
  db: Database,
  userId: string,
  accounts: SyncAccount[],
): Promise<OrgSummary[]> {
  const orgs = await syncSuiteOrganizations(db, userId, accounts);
  for (const account of accounts) {
    const org = orgs.find((o) => o.suiteAccountId === account.accountId);
    if (org) await syncSuiteBrands(db, userId, org.id, account.businesses);
  }
  return orgs;
}

/** The Suite businesses this person may see in an account (a brand is visible only if its business is listed). */
export function visibleBusinessIds(accounts: SyncAccount[], suiteAccountId: string | null): Set<string> {
  const account = accounts.find((a) => a.accountId === suiteAccountId);
  return new Set(account?.businesses.map((b) => b.businessId) ?? []);
}

/** Brands the person may see: linked to a business the Suite lists for them. Unlinked brands are hidden (fail closed). */
export function filterVisibleBrands<T extends { suiteBusinessId: string | null }>(
  brands: T[],
  visible: Set<string>,
): T[] {
  return brands.filter((b) => b.suiteBusinessId !== null && visible.has(b.suiteBusinessId));
}
