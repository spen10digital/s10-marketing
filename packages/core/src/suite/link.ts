import { z } from 'zod';
import type { SqlExecutor } from '../db/migrate';

/**
 * OPTIONAL backfill: link EXISTING organizations and brands to Suite ids. Nothing needs it for a
 * new account: organizations and brands are created on first use from the Suite
 * (`app.sync_suite_orgs` / `app.sync_suite_brands`). It exists so whoever has older rows (made
 * before Suite sign-in) can link them. It takes an explicit mapping file that is never committed
 * (the format is documented in `docs/phases/suite-integration.md`), is a dry run unless asked to
 * apply, and derives no keys: the ids come from the file, so no `created_at` or run time is used.
 */
export const linkMappingSchema = z
  .object({
    organizations: z
      .array(
        z.object({
          /** The local organization: its uuid or its slug. */
          org: z.string().trim().min(1),
          suiteAccountId: z.string().trim().min(1).max(64),
        }),
      )
      .default([]),
    brands: z
      .array(
        z.object({
          /** The local brand: its uuid, or `<organization slug>/<brand slug>`. */
          brand: z.string().trim().min(1),
          suiteBusinessId: z.string().trim().min(1).max(64),
        }),
      )
      .default([]),
  })
  .strict();
export type LinkMapping = z.infer<typeof linkMappingSchema>;

export interface LinkSnapshot {
  orgs: { id: string; slug: string; suiteAccountId: string | null }[];
  brands: { id: string; orgId: string; slug: string; suiteBusinessId: string | null }[];
}

export type LinkAction =
  | { kind: 'org'; id: string; label: string; suiteAccountId: string }
  | { kind: 'brand'; id: string; label: string; suiteBusinessId: string };

export interface LinkPlan {
  actions: LinkAction[];
  /** Already linked to the same id: nothing to do. */
  unchanged: string[];
  errors: string[];
}

export function planSuiteLinks(mapping: LinkMapping, current: LinkSnapshot): LinkPlan {
  const plan: LinkPlan = { actions: [], unchanged: [], errors: [] };
  const usedAccounts = new Map<string, string>(); // suite id -> local label
  const usedBusinesses = new Map<string, string>();
  for (const o of current.orgs) if (o.suiteAccountId) usedAccounts.set(o.suiteAccountId, o.slug);
  for (const b of current.brands) if (b.suiteBusinessId) usedBusinesses.set(b.suiteBusinessId, b.slug);
  const linkedOrgs = new Set(current.orgs.filter((o) => o.suiteAccountId).map((o) => o.id));

  for (const m of mapping.organizations) {
    const org = current.orgs.find((o) => o.id === m.org || o.slug === m.org);
    if (!org) {
      plan.errors.push(`organization "${m.org}" does not exist`);
      continue;
    }
    if (org.suiteAccountId === m.suiteAccountId) {
      plan.unchanged.push(`organization ${org.slug}`);
      continue;
    }
    if (org.suiteAccountId) {
      plan.errors.push(`organization ${org.slug} is already linked to a different Suite account`);
      continue;
    }
    const taken = usedAccounts.get(m.suiteAccountId);
    if (taken) {
      plan.errors.push(`Suite account ${m.suiteAccountId} is already used by organization ${taken}`);
      continue;
    }
    usedAccounts.set(m.suiteAccountId, org.slug);
    linkedOrgs.add(org.id);
    plan.actions.push({ kind: 'org', id: org.id, label: org.slug, suiteAccountId: m.suiteAccountId });
  }

  for (const m of mapping.brands) {
    const brand = current.brands.find((b) => {
      if (b.id === m.brand) return true;
      const org = current.orgs.find((o) => o.id === b.orgId);
      return org ? `${org.slug}/${b.slug}` === m.brand : false;
    });
    if (!brand) {
      plan.errors.push(`brand "${m.brand}" does not exist`);
      continue;
    }
    const label = `${current.orgs.find((o) => o.id === brand.orgId)?.slug ?? '?'}/${brand.slug}`;
    if (brand.suiteBusinessId === m.suiteBusinessId) {
      plan.unchanged.push(`brand ${label}`);
      continue;
    }
    if (brand.suiteBusinessId) {
      plan.errors.push(`brand ${label} is already linked to a different Suite business`);
      continue;
    }
    if (!linkedOrgs.has(brand.orgId)) {
      plan.errors.push(`brand ${label}: link its organization first`);
      continue;
    }
    const taken = usedBusinesses.get(m.suiteBusinessId);
    if (taken) {
      plan.errors.push(`Suite business ${m.suiteBusinessId} is already used by brand ${taken}`);
      continue;
    }
    usedBusinesses.set(m.suiteBusinessId, brand.slug);
    plan.actions.push({ kind: 'brand', id: brand.id, label, suiteBusinessId: m.suiteBusinessId });
  }
  return plan;
}

/** Reads what the plan needs. Run as the migration owner (bypasses RLS), never as the app role. */
export async function readLinkSnapshot(db: SqlExecutor): Promise<LinkSnapshot> {
  const orgs = await db.query<{ id: string; slug: string; suite_account_id: string | null }>(
    'select id::text as id, slug, suite_account_id from public.organizations',
  );
  const brands = await db.query<{
    id: string;
    org_id: string;
    slug: string;
    suite_business_id: string | null;
  }>('select id::text as id, org_id::text as org_id, slug, suite_business_id from public.brands');
  return {
    orgs: orgs.map((o) => ({ id: o.id, slug: o.slug, suiteAccountId: o.suite_account_id })),
    brands: brands.map((b) => ({
      id: b.id,
      orgId: b.org_id,
      slug: b.slug,
      suiteBusinessId: b.suite_business_id,
    })),
  };
}

/** Applies a plan in one transaction. Only fills empty links; never overwrites one. */
export async function applyLinkPlan(db: SqlExecutor, plan: LinkPlan): Promise<void> {
  if (plan.errors.length) throw new Error('Refusing to apply a plan with errors.');
  await db.transaction(async (tx) => {
    for (const a of plan.actions) {
      if (a.kind === 'org') {
        await tx.exec(
          'update public.organizations set suite_account_id = :sid where id = :id::uuid and suite_account_id is null',
          { sid: a.suiteAccountId, id: a.id },
        );
      } else {
        await tx.exec(
          'update public.brands set suite_business_id = :sid where id = :id::uuid and suite_business_id is null',
          { sid: a.suiteBusinessId, id: a.id },
        );
      }
    }
  });
}
