/**
 * 0003_suite_link against real Postgres 16: organizations are created on first use for ANY
 * Suite account (throwaway ids only, nothing seeded), roles follow the Suite, and access taken
 * away in the Suite removes the membership. The app side connects as app_rw like production.
 */
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  pgErrorCode,
  rowsOf,
  sql,
  withDbContext,
  type Database,
} from '../../packages/core/src/db';
import { pgExecutor } from '../../packages/core/src/db/executors';
import { loadMigrations, migrate, setAppRolePassword } from '../../packages/core/src/db/migrate';
import {
  createOrganization,
  getBrandBySlug,
  listBrands,
  listMyOrganizations,
  registerUser,
} from '../../packages/core/src/domain';
import {
  applyLinkPlan,
  filterVisibleBrands,
  getCurrentBusiness,
  planSuiteLinks,
  readLinkSnapshot,
  SuiteUnavailableError,
  syncSuiteBrands,
  syncSuiteOrganizations,
  syncSuiteTenancy,
  type SuiteBusinessProfile,
  type SyncAccount,
} from '../../packages/core/src/suite';

const ADMIN_URL =
  process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/s10_marketing';
const APP_PASSWORD = 'app_rw_test_password';
const ISSUER = 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_SUITETEST';

let admin: pg.Pool;
let db: Database;
const users = { ann: '', ben: '' };

const account = (id: string, name: string, role: SyncAccount['role'] = 'owner'): SyncAccount => ({
  accountId: id,
  name,
  role,
  businesses: [],
});
const memberRows = async (userId: string) =>
  (
    await admin.query(
      'select o.suite_account_id, m.role from public.organization_members m join public.organizations o on o.id = m.org_id where m.user_id = $1 order by 1',
      [userId],
    )
  ).rows;

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
  await admin.query(
    'drop schema if exists app cascade; drop schema if exists public cascade; create schema public;',
  );
  const executor = pgExecutor(admin);
  await migrate(executor, await loadMigrations(join(import.meta.dirname, '../migrations')));
  await setAppRolePassword(executor, APP_PASSWORD);
  const appUrl = new URL(ADMIN_URL);
  appUrl.username = 'app_rw';
  appUrl.password = APP_PASSWORD;
  db = createDatabase({ kind: 'pg', url: appUrl.toString() });
  users.ann = await registerUser(db, { issuer: ISSUER, subject: 'sub-ann', email: 'ann@example.test' });
  users.ben = await registerUser(db, { issuer: ISSUER, subject: 'sub-ben', email: 'ben@example.test' });
}, 60_000);

afterAll(async () => {
  await admin?.end();
  await (db as unknown as { $client?: pg.Pool })?.$client?.end();
});

describe('app.sync_suite_orgs', () => {
  it('creates the organization on first use for any account, with the Suite role', async () => {
    const orgs = await syncSuiteOrganizations(db, users.ann, [account('ACCT_ONE', 'Throwaway Co')]);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({ suiteAccountId: 'ACCT_ONE', name: 'Throwaway Co', role: 'owner' });
    expect(orgs[0]!.slug).toBe('throwaway-co');
    // It is a normal organization to the rest of the app.
    const mine = await withDbContext(db, { userId: users.ann }, (tx) => listMyOrganizations(tx, users.ann));
    expect(mine.map((o) => o.suiteAccountId)).toEqual(['ACCT_ONE']);
  });

  it('is idempotent and updates role and name', async () => {
    const first = await syncSuiteOrganizations(db, users.ann, [account('ACCT_ONE', 'Throwaway Co')]);
    const again = await syncSuiteOrganizations(db, users.ann, [account('ACCT_ONE', 'Renamed Co', 'admin')]);
    expect(again[0]!.id).toBe(first[0]!.id);
    expect(again[0]).toMatchObject({ name: 'Renamed Co', role: 'admin' });
    const count = await admin.query('select count(*)::int as n from public.organizations');
    expect(count.rows[0].n).toBe(1);
  });

  it('gives a second person the same organization with their own role', async () => {
    const ann = await syncSuiteOrganizations(db, users.ann, [account('ACCT_ONE', 'Renamed Co', 'owner')]);
    const ben = await syncSuiteOrganizations(db, users.ben, [account('ACCT_ONE', 'Renamed Co', 'viewer')]);
    expect(ben[0]!.id).toBe(ann[0]!.id);
    expect(ben[0]!.role).toBe('viewer');
    expect((await memberRows(users.ann))[0].role).toBe('owner');
  });

  it('removes only the caller’s membership when the Suite no longer lists the account', async () => {
    await syncSuiteOrganizations(db, users.ben, []);
    expect(await memberRows(users.ben)).toEqual([]);
    expect(await memberRows(users.ann)).toHaveLength(1); // ann is untouched
  });

  it('never touches memberships in organizations that are not Suite-linked', async () => {
    const legacy = await withDbContext(db, { userId: users.ben }, (tx) =>
      createOrganization(tx, { name: 'Unlinked', timezone: 'UTC' }),
    );
    await syncSuiteOrganizations(db, users.ben, []);
    const rows = await admin.query(
      'select 1 from public.organization_members where org_id = $1 and user_id = $2',
      [legacy, users.ben],
    );
    expect(rows.rowCount).toBe(1);
  });

  it('gives accounts with the same name distinct slugs without revealing other tenants', async () => {
    const orgs = await syncSuiteOrganizations(db, users.ben, [
      account('ACCT_TWO', 'Renamed Co'),
      account('ACCT_THREE', 'Renamed Co'),
    ]);
    const slugs = orgs.map((o) => o.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('creates one organization when two first requests race', async () => {
    const results = await Promise.all([
      syncSuiteOrganizations(db, users.ann, [account('ACCT_RACE', 'Race Co')]),
      syncSuiteOrganizations(db, users.ben, [account('ACCT_RACE', 'Race Co', 'member')]),
    ]);
    const ids = results.map((r) => r.find((o) => o.suiteAccountId === 'ACCT_RACE')!.id);
    expect(ids[0]).toBe(ids[1]);
    const count = await admin.query(
      "select count(*)::int as n from public.organizations where suite_account_id = 'ACCT_RACE'",
    );
    expect(count.rows[0].n).toBe(1);
  });

  it('refuses system actors and rejects bad input', async () => {
    const org = (await admin.query("select id from public.organizations where suite_account_id = 'ACCT_ONE'"))
      .rows[0].id as string;
    const err = await withDbContext(db, { systemOrgId: org }, (tx) =>
      tx.execute(sql`select * from app.sync_suite_orgs('[]'::jsonb)`),
    ).catch((e: unknown) => e);
    expect(pgErrorCode(err)).toBe('42501');

    const badRole = await withDbContext(db, { userId: users.ann }, (tx) =>
      tx.execute(
        sql`select * from app.sync_suite_orgs(${JSON.stringify([{ account_id: 'X', name: 'X', slug: 'x', role: 'god' }])}::jsonb)`,
      ),
    ).catch((e: unknown) => e);
    expect(badRole).toBeInstanceOf(Error);

    const notArray = await withDbContext(db, { userId: users.ann }, (tx) =>
      tx.execute(sql`select * from app.sync_suite_orgs('{}'::jsonb)`),
    ).catch((e: unknown) => e);
    expect(notArray).toBeInstanceOf(Error);
  });

  it('does not let the app role set Suite ids directly', async () => {
    const err = await withDbContext(db, { userId: users.ann }, (tx) =>
      tx.execute(sql`update public.organizations set suite_account_id = 'HIJACK'`),
    ).catch((e: unknown) => e);
    expect(pgErrorCode(err)).toBe('42501');
    const rows = rowsOf<{ n: string }>(
      await admin
        .query("select count(*) as n from public.organizations where suite_account_id = 'HIJACK'")
        .then((r) => ({ rows: r.rows })),
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

describe('app.sync_suite_brands (a Suite business is a brand, created on first use)', () => {
  const biz = (id: string, name: string) => ({ businessId: id, name });
  let orgId: string;

  beforeAll(async () => {
    const orgs = await syncSuiteOrganizations(db, users.ann, [account('ACCT_BRANDS', 'Brands Co')]);
    orgId = orgs[0]!.id;
  });

  it('creates a brand per business for any account, idempotently, and keeps the Suite name', async () => {
    const first = await syncSuiteBrands(db, users.ann, orgId, [
      biz('BIZ_A', 'Alpha Shop'),
      biz('BIZ_B', 'Beta Shop'),
    ]);
    expect(first.map((b) => b.suiteBusinessId).sort()).toEqual(['BIZ_A', 'BIZ_B']);
    const again = await syncSuiteBrands(db, users.ann, orgId, [biz('BIZ_A', 'Alpha Renamed')]);
    expect(again).toHaveLength(2); // the other brand is kept, just not listed this time
    const brands = await withDbContext(db, { userId: users.ann }, (tx) => listBrands(tx, orgId));
    expect(brands.find((b) => b.suiteBusinessId === 'BIZ_A')!.name).toBe('Alpha Renamed');
    expect(brands).toHaveLength(2);
  });

  it('shows only the businesses the Suite lists for the person', async () => {
    const brands = await withDbContext(db, { userId: users.ann }, (tx) => listBrands(tx, orgId));
    const visible = filterVisibleBrands(brands, new Set(['BIZ_A']));
    expect(visible.map((b) => b.suiteBusinessId)).toEqual(['BIZ_A']);
    // A brand not linked to any Suite business is hidden (fail closed).
    expect(filterVisibleBrands([{ suiteBusinessId: null }], new Set(['BIZ_A']))).toEqual([]);
  });

  it('gives businesses with the same name distinct URL names', async () => {
    const out = await syncSuiteBrands(db, users.ann, orgId, [biz('BIZ_C', 'Gamma'), biz('BIZ_D', 'Gamma')]);
    const slugs = out.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('requires membership and never moves a brand into another organization', async () => {
    const other = (await syncSuiteOrganizations(db, users.ben, [account('ACCT_OTHER', 'Other Co')]))[0]!;
    const notMember = await syncSuiteBrands(db, users.ben, orgId, [biz('BIZ_X', 'X')]).catch(
      (e: unknown) => e,
    );
    expect(pgErrorCode(notMember)).toBe('42501');
    // BIZ_A belongs to ann's org: asking for it from another org must not move or rename it.
    await syncSuiteBrands(db, users.ben, other.id, [biz('BIZ_A', 'Hijack')]);
    const row = await admin.query(
      "select org_id::text as org_id, name from public.brands where suite_business_id = 'BIZ_A'",
    );
    expect(row.rows[0].org_id).toBe(orgId);
    expect(row.rows[0].name).toBe('Alpha Renamed');
  });

  it('creates one brand when two first requests race', async () => {
    await Promise.all([
      syncSuiteBrands(db, users.ann, orgId, [biz('BIZ_RACE', 'Race')]),
      syncSuiteBrands(db, users.ann, orgId, [biz('BIZ_RACE', 'Race')]),
    ]);
    const count = await admin.query(
      "select count(*)::int as n from public.brands where suite_business_id = 'BIZ_RACE'",
    );
    expect(count.rows[0].n).toBe(1);
  });

  it('syncSuiteTenancy does organizations and brands together', async () => {
    const orgs = await syncSuiteTenancy(db, users.ann, [
      { ...account('ACCT_BRANDS', 'Brands Co'), businesses: [biz('BIZ_E', 'Epsilon')] },
    ]);
    expect(orgs.map((o) => o.suiteAccountId)).toEqual(['ACCT_BRANDS']);
    const brand = await withDbContext(db, { userId: users.ann }, (tx) =>
      getBrandBySlug(tx, orgId, 'epsilon'),
    );
    expect(brand?.suiteBusinessId).toBe('BIZ_E');
  });
});

describe('getCurrentBusiness (the Business seam) reads the Suite and writes nothing', () => {
  const profile: SuiteBusinessProfile = {
    business_id: 'BIZ_A',
    account_id: 'ACCT_BRANDS',
    name: 'Alpha From Suite',
    website: 'https://alpha.example.test',
    contact_email: 'hello@alpha.example.test',
    address: { city: 'Testville' },
  };
  const orgIdOf = async () =>
    (
      await admin.query(
        "select id::text as id from public.organizations where suite_account_id = 'ACCT_BRANDS'",
      )
    ).rows[0].id as string;

  it('uses the Suite profile for name, website and contact, with Marketing keeping its own voice', async () => {
    const orgId = await orgIdOf();
    const view = await withDbContext(db, { userId: users.ann }, (tx) =>
      getCurrentBusiness({ tx, business: async (id) => (id === 'BIZ_A' ? profile : null) }, orgId, {
        slug: 'alpha-shop',
      }),
    );
    expect(view).toMatchObject({
      accountId: 'ACCT_BRANDS',
      businessId: 'BIZ_A',
      name: 'Alpha From Suite',
      websiteUrl: 'https://alpha.example.test',
      contactEmail: 'hello@alpha.example.test',
      suiteProfile: 'loaded',
      source: 'suite_business',
    });
    expect(view!.voice).toBeNull();
  });

  it('when the Suite is unreachable falls back to the local copy, says so, and changes no state', async () => {
    const orgId = await orgIdOf();
    const before = await admin.query(
      'select (select count(*) from public.brands) b, (select count(*) from public.audit_logs) a',
    );
    const view = await withDbContext(db, { userId: users.ann }, (tx) =>
      getCurrentBusiness(
        { tx, business: async () => Promise.reject(new SuiteUnavailableError('down')) },
        orgId,
        { slug: 'alpha-shop' },
      ),
    );
    expect(view).toMatchObject({ name: 'Alpha Renamed', suiteProfile: 'unavailable', source: 'local_db' });
    const after = await admin.query(
      'select (select count(*) from public.brands) b, (select count(*) from public.audit_logs) a',
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

describe('optional link script logic (existing rows, explicit mapping, dry run first)', () => {
  it('plans, refuses conflicts and applies only empty links', async () => {
    const legacyOrg = await withDbContext(db, { userId: users.ann }, (tx) =>
      createOrganization(tx, { name: 'Legacy Throwaway', timezone: 'UTC' }),
    );
    await admin.query(
      "insert into public.brands (org_id, name, slug, created_by) values ($1, 'Old Brand', 'old-brand', $2)",
      [legacyOrg, users.ann],
    );
    const db2 = pgExecutor(admin);
    const snapshot = await readLinkSnapshot(db2);

    const bad = planSuiteLinks(
      {
        organizations: [{ org: 'legacy-throwaway', suiteAccountId: 'ACCT_BRANDS' }], // already used
        brands: [{ brand: 'legacy-throwaway/old-brand', suiteBusinessId: 'BIZ_L' }], // org not linked yet
      },
      snapshot,
    );
    expect(bad.errors).toHaveLength(2);
    await expect(applyLinkPlan(db2, bad)).rejects.toThrow(/errors/);

    const good = planSuiteLinks(
      {
        organizations: [{ org: 'legacy-throwaway', suiteAccountId: 'ACCT_LEGACY' }],
        brands: [{ brand: 'legacy-throwaway/old-brand', suiteBusinessId: 'BIZ_L' }],
      },
      snapshot,
    );
    expect(good.errors).toEqual([]);
    expect(good.actions).toHaveLength(2);
    await applyLinkPlan(db2, good);
    const row = await admin.query(
      "select o.suite_account_id, b.suite_business_id from public.organizations o join public.brands b on b.org_id = o.id where o.slug = 'legacy-throwaway'",
    );
    expect(row.rows[0]).toEqual({ suite_account_id: 'ACCT_LEGACY', suite_business_id: 'BIZ_L' });

    // Running it again changes nothing and never overwrites.
    const again = planSuiteLinks(
      { organizations: [{ org: 'legacy-throwaway', suiteAccountId: 'ACCT_LEGACY' }], brands: [] },
      await readLinkSnapshot(db2),
    );
    expect(again.actions).toEqual([]);
    expect(again.unchanged).toHaveLength(1);
    const overwrite = planSuiteLinks(
      { organizations: [{ org: 'legacy-throwaway', suiteAccountId: 'ACCT_NEW' }], brands: [] },
      await readLinkSnapshot(db2),
    );
    expect(overwrite.errors[0]).toMatch(/already linked/);
  });
});
