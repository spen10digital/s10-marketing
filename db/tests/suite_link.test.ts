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
import { createOrganization, listMyOrganizations, registerUser } from '../../packages/core/src/domain';
import { syncSuiteOrganizations, type SyncAccount } from '../../packages/core/src/suite';

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
