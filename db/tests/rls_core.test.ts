/**
 * RLS and tenancy tests for 0001_core_tenancy against real Postgres 16 (Docker locally, a
 * service container in CI). The app side always connects as app_rw, exactly like production.
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
  type DbContext,
  type DbTx,
} from '../../packages/core/src/db';
import { pgExecutor } from '../../packages/core/src/db/executors';
import { loadMigrations, migrate, setAppRolePassword } from '../../packages/core/src/db/migrate';
import {
  createBrand,
  createOrganization,
  getMembershipRole,
  listBrands,
  listMyOrganizations,
  registerUser,
  saveVoice,
  type OrgActor,
} from '../../packages/core/src/domain';
import type { OrgRole } from '../../packages/core/src/db/schema';

const ADMIN_URL =
  process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/s10_marketing';
const APP_PASSWORD = 'app_rw_test_password';
const ISSUER = 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_TEST';

let admin: pg.Pool;
let db: Database;
const users: Record<'alice' | 'bob' | 'carol' | 'dave', string> = { alice: '', bob: '', carol: '', dave: '' };
let orgA: string;
let orgB: string;

const as = <T>(context: DbContext, fn: (tx: DbTx) => Promise<T>) => withDbContext(db, context, fn);
const asUser = <T>(userId: string, fn: (tx: DbTx) => Promise<T>) => as({ userId }, fn);
const actor = async (userId: string, orgId: string): Promise<OrgActor> => ({
  userId,
  orgId,
  role: await asUser(userId, (tx) => getMembershipRole(tx, userId, orgId)),
});
/** Bypasses the domain checks so the database alone decides. */
const rawBrandInsert = (tx: DbTx, orgId: string, userId: string, slug: string) =>
  tx.execute(
    sql`insert into public.brands (org_id, name, slug, created_by) values (${orgId}, ${slug}, ${slug}, ${userId})`,
  );
const count = async (tx: DbTx, table: string) =>
  Number(rowsOf<{ n: string }>(await tx.execute(sql.raw(`select count(*) as n from public.${table}`)))[0]!.n);

async function addMember(orgId: string, userId: string, role: OrgRole) {
  await admin.query('insert into public.organization_members (org_id, user_id, role) values ($1, $2, $3)', [
    orgId,
    userId,
    role,
  ]);
}

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

  for (const name of Object.keys(users) as (keyof typeof users)[]) {
    users[name] = await registerUser(db, {
      issuer: ISSUER,
      subject: `sub-${name}`,
      email: `${name}@example.com`,
    });
  }
  orgA = await asUser(users.alice, (tx) =>
    createOrganization(tx, { name: 'S10', timezone: 'America/Los_Angeles' }),
  );
  orgB = await asUser(users.bob, (tx) => createOrganization(tx, { name: 'LimitKeep', timezone: 'UTC' }));
  await addMember(orgA, users.carol, 'viewer');
  await addMember(orgA, users.dave, 'editor');
}, 60_000);

afterAll(async () => {
  await admin?.end();
  await (db as unknown as { $client?: pg.Pool })?.$client?.end();
});

describe('migrations', () => {
  it('are recorded and not re-applied', async () => {
    const result = await migrate(
      pgExecutor(admin),
      await loadMigrations(join(import.meta.dirname, '../migrations')),
    );
    expect(result.applied).toEqual([]);
    expect(result.skipped).toContain('0001_core_tenancy.sql');
  });

  it('refuse to run when an applied migration was edited', async () => {
    const [first] = await loadMigrations(join(import.meta.dirname, '../migrations'));
    await expect(migrate(pgExecutor(admin), [{ ...first!, checksum: 'edited' }])).rejects.toThrow(/changed/);
  });

  it('enable and force RLS on every table, and app_rw cannot bypass it', async () => {
    const { rows } = await admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const r of rows)
      expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);

    const role = await admin.query(`select rolsuper, rolbypassrls from pg_roles where rolname = 'app_rw'`);
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe('request context', () => {
  it('without context, app_rw sees no tenant data', async () => {
    const n = await db.transaction(async (tx) => ({
      orgs: await count(tx, 'organizations'),
      users: await count(tx, 'users'),
      members: await count(tx, 'organization_members'),
    }));
    expect(n).toEqual({ orgs: 0, users: 0, members: 0 });
  });

  it('does not leak into the next transaction on the same connection', async () => {
    const single = createDatabase({
      kind: 'pg',
      url: Object.assign(new URL(ADMIN_URL), { username: 'app_rw', password: APP_PASSWORD }).toString(),
    });
    await withDbContext(single, { userId: users.alice }, async () => undefined);
    const leaked = await single.transaction(async (tx) =>
      rowsOf<{ v: string | null }>(await tx.execute(sql`select current_setting('app.user_id', true) as v`)),
    );
    expect(leaked[0]?.v ?? '').toBe('');
    await (single as unknown as { $client: pg.Pool }).$client.end();
  });
});

describe('identity', () => {
  it('register_user is idempotent and links a recreated account by verified email', async () => {
    const again = await registerUser(db, {
      issuer: ISSUER,
      subject: 'sub-alice',
      email: 'alice@example.com',
    });
    expect(again).toBe(users.alice);
    const relinked = await registerUser(db, {
      issuer: ISSUER,
      subject: 'sub-alice-2',
      email: 'ALICE@example.com',
    });
    expect(relinked).toBe(users.alice);
  });

  it('users see themselves and people in their organizations only', async () => {
    const visible = async (userId: string) =>
      asUser(userId, async (tx) =>
        rowsOf<{ email: string }>(await tx.execute(sql`select email from public.users order by email`)).map(
          (r) => r.email,
        ),
      );
    expect(await visible(users.alice)).toEqual([
      'alice@example.com',
      'carol@example.com',
      'dave@example.com',
    ]);
    expect(await visible(users.bob)).toEqual(['bob@example.com']);
  });

  it('identities are visible only to their owner', async () => {
    const n = await asUser(users.bob, (tx) => count(tx, 'user_identities'));
    expect(n).toBe(1);
  });
});

describe('organizations', () => {
  it('make the creator owner and isolate tenants', async () => {
    expect(await asUser(users.alice, (tx) => listMyOrganizations(tx, users.alice))).toMatchObject([
      { id: orgA, name: 'S10', slug: 's10', role: 'owner' },
    ]);
    expect(await asUser(users.bob, (tx) => count(tx, 'organizations'))).toBe(1);
    expect(await asUser(users.bob, (tx) => getMembershipRole(tx, users.bob, orgA))).toBeNull();
  });

  it('get a random suffix when the slug is taken by another tenant', async () => {
    const id = await asUser(users.bob, (tx) => createOrganization(tx, { name: 'S10', timezone: 'UTC' }));
    const orgs = await asUser(users.bob, (tx) => listMyOrganizations(tx, users.bob));
    expect(orgs.find((o) => o.id === id)?.slug).toMatch(/^s10-[0-9a-f]{6}$/);
  });

  it('can only be created by a signed-in user', async () => {
    await expect(
      as({ systemOrgId: orgA }, (tx) => createOrganization(tx, { name: 'Sneaky', timezone: 'UTC' })),
    ).rejects.toThrow();
  });

  it('memberships cannot be written by the app (read-only until invitations exist)', async () => {
    await expect(
      asUser(users.alice, (tx) =>
        tx.execute(
          sql`insert into public.organization_members (org_id, user_id, role) values (${orgA}, ${users.bob}, 'owner')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('only admins and owners can rename', async () => {
    const rename = (userId: string) =>
      asUser(
        userId,
        async (tx) =>
          rowsOf(
            await tx.execute(
              sql`update public.organizations set name = 'Renamed' where id = ${orgA} returning id`,
            ),
          ).length,
      );
    expect(await rename(users.dave)).toBe(0); // editor
    expect(await rename(users.bob)).toBe(0); // other tenant
    expect(await rename(users.alice)).toBe(1);
  });
});

describe('brands', () => {
  let brandA: string;

  beforeAll(async () => {
    brandA = (
      await asUser(users.alice, async (tx) =>
        createBrand(tx, await actor(users.alice, orgA), { name: 'Loot Goblin Labs' }),
      )
    ).id;
    await asUser(users.bob, async (tx) =>
      createBrand(tx, await actor(users.bob, orgB), { name: 'LimitKeep' }),
    );
  });

  it('are visible only inside their organization', async () => {
    expect((await asUser(users.alice, (tx) => listBrands(tx, orgA))).map((b) => b.name)).toEqual([
      'Loot Goblin Labs',
    ]);
    expect(await asUser(users.bob, (tx) => listBrands(tx, orgA))).toEqual([]);
    expect(await asUser(users.bob, (tx) => count(tx, 'brands'))).toBe(1);
  });

  it('cannot be created in or moved into another tenant', async () => {
    await expect(
      asUser(users.bob, (tx) => rawBrandInsert(tx, orgA, users.bob, 'intruder')),
    ).rejects.toThrow();
    // org_id is not an updatable column for app_rw.
    await expect(
      asUser(users.alice, (tx) =>
        tx.execute(sql`update public.brands set org_id = ${orgB} where id = ${brandA}`),
      ),
    ).rejects.toThrow();
  });

  it('enforce the role matrix in the database, not just the domain', async () => {
    await expect(
      asUser(users.carol, (tx) => rawBrandInsert(tx, orgA, users.carol, 'by-viewer')),
    ).rejects.toThrow();
    await expect(
      asUser(users.dave, (tx) => rawBrandInsert(tx, orgA, users.dave, 'by-editor')),
    ).rejects.toThrow();
    await expect(
      asUser(users.alice, (tx) => rawBrandInsert(tx, orgA, users.bob, 'spoofed-creator')),
    ).rejects.toThrow();
    await asUser(users.alice, (tx) => rawBrandInsert(tx, orgA, users.alice, 'by-owner'));

    const updated = (userId: string) =>
      asUser(
        userId,
        async (tx) =>
          rowsOf(
            await tx.execute(
              sql`update public.brands set description = 'x' where id = ${brandA} returning id`,
            ),
          ).length,
      );
    expect(await updated(users.dave)).toBe(0);
    expect(await updated(users.bob)).toBe(0);
    expect(await updated(users.alice)).toBe(1);
  });

  it('cannot be hard-deleted by the app', async () => {
    await expect(
      asUser(users.alice, (tx) => tx.execute(sql`delete from public.brands where id = ${brandA}`)),
    ).rejects.toThrow();
  });

  it('give a free slug within the org on name clashes', async () => {
    const second = await asUser(users.alice, async (tx) =>
      createBrand(tx, await actor(users.alice, orgA), { name: 'Loot Goblin Labs' }),
    );
    expect(second.slug).toBe('loot-goblin-labs-2');
  });

  describe('voice profiles', () => {
    it('version on every save and reject stale edits', async () => {
      const voice = {
        audience: 'Board gamers',
        tone: 'playful',
        guidelines: '',
        doList: ['puns'],
        dontList: [],
        examplePosts: [],
        ctaDefaults: [],
      };
      const v1 = await asUser(users.dave, async (tx) =>
        saveVoice(tx, await actor(users.dave, orgA), brandA, voice, 0),
      );
      const v2 = await asUser(users.alice, async (tx) =>
        saveVoice(tx, await actor(users.alice, orgA), brandA, { ...voice, tone: 'nerdy' }, 1),
      );
      expect([v1.version, v2.version]).toEqual([1, 2]);
      await expect(
        asUser(users.dave, async (tx) => saveVoice(tx, await actor(users.dave, orgA), brandA, voice, 1)),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('are immutable and need editor or above', async () => {
      await expect(
        asUser(users.alice, (tx) =>
          tx.execute(sql`update public.brand_voice_profiles set tone = 'x' where brand_id = ${brandA}`),
        ),
      ).rejects.toThrow();
      await expect(
        asUser(users.carol, (tx) =>
          tx.execute(
            sql`insert into public.brand_voice_profiles (org_id, brand_id, version, created_by) values (${orgA}, ${brandA}, 99, ${users.carol})`,
          ),
        ),
      ).rejects.toThrow();
    });

    it('cannot point at another tenant’s brand (composite foreign key)', async () => {
      const err = await asUser(users.bob, (tx) =>
        tx.execute(
          sql`insert into public.brand_voice_profiles (org_id, brand_id, version, created_by) values (${orgB}, ${brandA}, 999, ${users.bob})`,
        ),
      ).catch((e: unknown) => e);
      expect(pgErrorCode(err)).toBe('23503'); // foreign_key_violation, not just RLS
    });

    it('are invisible to other tenants', async () => {
      expect(await asUser(users.bob, (tx) => count(tx, 'brand_voice_profiles'))).toBe(0);
      expect(await asUser(users.carol, (tx) => count(tx, 'brand_voice_profiles'))).toBe(2);
    });
  });

  describe('system actor', () => {
    it('sees exactly the one organization it acts for', async () => {
      expect((await as({ systemOrgId: orgA }, (tx) => listBrands(tx, orgA))).length).toBeGreaterThan(0);
      expect(await as({ systemOrgId: orgA }, (tx) => listBrands(tx, orgB))).toEqual([]);
    });
  });
});

describe('audit log', () => {
  it('records changes with actor and changed columns, readable by admins only', async () => {
    const entries = await asUser(users.alice, async (tx) =>
      rowsOf<{ action: string; actor_user_id: string; metadata: { changed?: string[] } }>(
        await tx.execute(
          sql`select action, actor_user_id, metadata from public.audit_logs where org_id = ${orgA} order by id`,
        ),
      ),
    );
    const actions = entries.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'organizations.insert',
        'organization_members.insert',
        'brands.insert',
        'brand_voice_profiles.insert',
        'brands.update',
      ]),
    );
    expect(entries.find((e) => e.action === 'brands.insert')?.actor_user_id).toBe(users.alice);
    expect(entries.find((e) => e.action === 'brands.update')?.metadata.changed).toEqual(['description']);

    expect(await asUser(users.carol, (tx) => count(tx, 'audit_logs'))).toBe(0); // viewer
    expect(
      await asUser(
        users.bob,
        async (tx) =>
          rowsOf(await tx.execute(sql`select 1 from public.audit_logs where org_id = ${orgA}`)).length,
      ),
    ).toBe(0);
  });

  it('cannot be written, changed or deleted by the app', async () => {
    await expect(
      asUser(users.alice, (tx) =>
        tx.execute(
          sql`insert into public.audit_logs (org_id, actor_type, action, entity_type) values (${orgA}, 'user', 'fake', 'x')`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(users.alice, (tx) => tx.execute(sql`delete from public.audit_logs`)),
    ).rejects.toThrow();
    await expect(
      asUser(users.alice, (tx) => tx.execute(sql`update public.audit_logs set action = 'x'`)),
    ).rejects.toThrow();
  });
});

describe('system flags', () => {
  it('are readable but not writable by the app, and start off', async () => {
    const flags = await asUser(users.alice, async (tx) =>
      rowsOf<{ key: string; enabled: boolean }>(
        await tx.execute(sql`select key, enabled from public.system_flags order by key`),
      ),
    );
    expect(flags).toEqual([
      { key: 'automation_enabled', enabled: false },
      { key: 'publishing_enabled', enabled: false },
    ]);
    await expect(
      asUser(users.alice, (tx) => tx.execute(sql`update public.system_flags set enabled = true`)),
    ).rejects.toThrow();
  });
});
