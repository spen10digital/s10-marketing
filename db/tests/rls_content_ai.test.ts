/**
 * RLS, tenancy and budget tests for 0002_content_ai against real Postgres 16, connecting as
 * app_rw exactly like production. Runs after rls_core (files run one at a time).
 */
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  finishGeneration,
  getAiUsage,
  NO_USAGE,
  recordWebFetch,
  reserveGeneration,
  type AiLimits,
  type ReserveParams,
} from '../../packages/core/src/ai';
import {
  createDatabase,
  rowsOf,
  sql,
  withDbContext,
  type Database,
  type DbTx,
} from '../../packages/core/src/db';
import { pgExecutor } from '../../packages/core/src/db/executors';
import { loadMigrations, migrate, setAppRolePassword } from '../../packages/core/src/db/migrate';
import type { OrgRole } from '../../packages/core/src/db/schema';
import {
  createBrand,
  createOrganization,
  createPostDraft,
  getMembershipRole,
  registerUser,
  type OrgActor,
} from '../../packages/core/src/domain';
import { AppError } from '../../packages/core/src/errors/app-error';

const ADMIN_URL =
  process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/s10_marketing';
const APP_PASSWORD = 'app_rw_test_password';
const ISSUER = 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_TEST';

let admin: pg.Pool;
let db: Database;
const users = { alice: '', bob: '', carol: '', dave: '' };
let orgA: string;
let orgB: string;
let brandA: string;
let brandA2: string;
let brandB: string;

const asUser = <T>(userId: string, fn: (tx: DbTx) => Promise<T>) => withDbContext(db, { userId }, fn);
const actor = async (userId: string, orgId: string): Promise<OrgActor> => ({
  userId,
  orgId,
  role: await asUser(userId, (tx) => getMembershipRole(tx, userId, orgId)),
});
const LIMITS: AiLimits = { monthlyBudgetMicros: 1_000_000, dailyCalls: 100, webFetchDaily: 20 };
const params = (brandId: string, reservedMicros = 1000): ReserveParams => ({
  brandId,
  task: 'rewrite',
  templateId: 'rewrite',
  templateVersion: 1,
  provider: 'fake',
  modelId: 'us.anthropic.claude-haiku-5-5',
  reservedMicros,
});
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
  orgA = await asUser(users.alice, (tx) => createOrganization(tx, { name: 'S10', timezone: 'UTC' }));
  orgB = await asUser(users.bob, (tx) => createOrganization(tx, { name: 'LimitKeep', timezone: 'UTC' }));
  await addMember(orgA, users.carol, 'viewer');
  await addMember(orgA, users.dave, 'editor');
  const alice = await actor(users.alice, orgA);
  brandA = (await asUser(users.alice, (tx) => createBrand(tx, alice, { name: 'Loot Goblin Labs' }))).id;
  brandA2 = (await asUser(users.alice, (tx) => createBrand(tx, alice, { name: 'SPEN10' }))).id;
  const bob = await actor(users.bob, orgB);
  brandB = (await asUser(users.bob, (tx) => createBrand(tx, bob, { name: 'LimitKeep' }))).id;
}, 60_000);

afterAll(async () => {
  await admin?.end();
  await (db as unknown as { $client?: pg.Pool })?.$client?.end();
});

describe('0002 tables', () => {
  it('all have RLS enabled and forced', async () => {
    const { rows } = await admin.query<{ relname: string; on: boolean; forced: boolean }>(
      `select c.relname, c.relrowsecurity as on, c.relforcerowsecurity as forced from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1)`,
      [['org_entitlements', 'ai_generations', 'usage_events', 'content_items', 'posts', 'post_revisions']],
    );
    expect(rows).toHaveLength(6);
    for (const r of rows) expect([r.relname, r.on, r.forced]).toEqual([r.relname, true, true]);
  });
});

describe('post drafts', () => {
  it('are saved with a first revision and a content item, and isolated per org', async () => {
    const dave = await actor(users.dave, orgA);
    const post = await asUser(users.dave, (tx) =>
      createPostDraft(tx, dave, {
        brandId: brandA,
        body: 'Hello goblins',
        brief: 'launch',
        linkUrl: 'https://spen10.com/a',
      }),
    );
    expect(post.status).toBe('draft');
    expect(post.targetId).toBeNull();
    const seen = await asUser(users.alice, async (tx) => ({
      posts: await count(tx, 'posts'),
      revisions: await count(tx, 'post_revisions'),
      items: await count(tx, 'content_items'),
    }));
    expect(seen).toEqual({ posts: 1, revisions: 1, items: 1 });
    const other = await asUser(users.bob, async (tx) => ({
      posts: await count(tx, 'posts'),
      revisions: await count(tx, 'post_revisions'),
      items: await count(tx, 'content_items'),
    }));
    expect(other).toEqual({ posts: 0, revisions: 0, items: 0 });
  });

  it('need editor or above, in the domain and in the database', async () => {
    const carol = await actor(users.carol, orgA);
    await expect(
      asUser(users.carol, (tx) => createPostDraft(tx, carol, { brandId: brandA, body: 'x' })),
    ).rejects.toThrow(AppError);
    await expect(
      asUser(users.carol, (tx) =>
        tx.execute(
          sql`insert into public.posts (org_id, brand_id, body, created_by) values (${orgA}, ${brandA}, 'x', ${users.carol})`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('cannot be created in another tenant or point at another tenant’s brand', async () => {
    await expect(
      asUser(users.dave, (tx) =>
        tx.execute(
          sql`insert into public.posts (org_id, brand_id, body, created_by) values (${orgB}, ${brandB}, 'x', ${users.dave})`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(users.dave, (tx) =>
        tx.execute(
          sql`insert into public.posts (org_id, brand_id, body, created_by) values (${orgA}, ${brandB}, 'x', ${users.dave})`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('start as drafts, and only drafts can be edited', async () => {
    await expect(
      asUser(users.dave, (tx) =>
        tx.execute(
          sql`insert into public.posts (org_id, brand_id, body, status, created_by) values (${orgA}, ${brandA}, 'x', 'approved', ${users.dave})`,
        ),
      ),
    ).rejects.toThrow();
    const { rows } = await admin.query<{ id: string }>(
      `insert into public.posts (org_id, brand_id, body, status) values ($1, $2, 'approved body', 'approved') returning id`,
      [orgA, brandA],
    );
    const updated = await asUser(users.dave, async (tx) =>
      rowsOf(
        await tx.execute(
          sql`update public.posts set body = 'changed' where id = ${rows[0]!.id} returning id`,
        ),
      ),
    );
    expect(updated).toEqual([]);
    await expect(
      asUser(users.dave, (tx) =>
        tx.execute(sql`update public.posts set status = 'published' where id = ${rows[0]!.id}`),
      ),
    ).rejects.toThrow(); // no column grant on status
  });

  it('revisions are append-only', async () => {
    await expect(
      asUser(users.alice, (tx) => tx.execute(sql`update public.post_revisions set body = 'x'`)),
    ).rejects.toThrow();
    await expect(
      asUser(users.alice, (tx) => tx.execute(sql`delete from public.post_revisions`)),
    ).rejects.toThrow();
  });

  it('only link AI generations of the same brand', async () => {
    const dave = await actor(users.dave, orgA);
    const generationId = await asUser(users.dave, (tx) =>
      reserveGeneration(tx, dave, LIMITS, params(brandA2)),
    );
    await expect(
      asUser(users.dave, (tx) =>
        createPostDraft(tx, dave, { brandId: brandA, body: 'x', aiGenerationId: generationId }),
      ),
    ).rejects.toThrow(/Unknown AI generation/);
  });
});

describe('AI generations and budget', () => {
  it('are reserved by editors as themselves and finished exactly once', async () => {
    const dave = await actor(users.dave, orgA);
    const id = await asUser(users.dave, (tx) => reserveGeneration(tx, dave, LIMITS, params(brandA)));
    await asUser(users.dave, (tx) =>
      finishGeneration(tx, dave, id, {
        status: 'succeeded',
        usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costMicros: 12,
        latencyMs: 5,
        output: { text: 'ok' },
      }),
    );
    // A finished generation is immutable: the update policy only matches pending rows.
    const again = await asUser(users.dave, async (tx) =>
      rowsOf(
        await tx.execute(sql`update public.ai_generations set cost_micros = 0 where id = ${id} returning id`),
      ),
    );
    expect(again).toEqual([]);
    const meter = await asUser(users.alice, async (tx) =>
      rowsOf<{ quantity: string; cost_micros: string }>(
        await tx.execute(sql`select quantity, cost_micros from public.usage_events where ref_id = ${id}`),
      ),
    );
    expect(meter.map((m) => [Number(m.quantity), Number(m.cost_micros)])).toEqual([[30, 12]]);
  });

  it('cannot change who, which model or the reservation', async () => {
    const dave = await actor(users.dave, orgA);
    const id = await asUser(users.dave, (tx) => reserveGeneration(tx, dave, LIMITS, params(brandA)));
    for (const column of ['reserved_micros = 0', `model_id = 'x'`, `created_by = ${`'${users.alice}'`}`]) {
      await expect(
        asUser(users.dave, (tx) =>
          tx.execute(sql.raw(`update public.ai_generations set ${column} where id = '${id}'`)),
        ),
      ).rejects.toThrow();
    }
  });

  it('cannot be started by viewers, for someone else, or as already finished', async () => {
    const carol = await actor(users.carol, orgA);
    await expect(
      asUser(users.carol, (tx) => reserveGeneration(tx, carol, LIMITS, params(brandA))),
    ).rejects.toThrow(AppError);
    const raw = (createdBy: string, status = 'pending') =>
      sql`insert into public.ai_generations (org_id, brand_id, task, template_id, template_version, provider, model_id, status, created_by)
          values (${orgA}, ${brandA}, 'rewrite', 'rewrite', 1, 'fake', 'm', ${status}, ${createdBy})`;
    await expect(asUser(users.carol, (tx) => tx.execute(raw(users.carol)))).rejects.toThrow();
    await expect(asUser(users.dave, (tx) => tx.execute(raw(users.alice)))).rejects.toThrow();
    await expect(asUser(users.dave, (tx) => tx.execute(raw(users.dave, 'succeeded')))).rejects.toThrow();
  });

  it('are invisible to other tenants', async () => {
    const n = await asUser(users.bob, (tx) => count(tx, 'ai_generations'));
    expect(n).toBe(0);
    const bobUsage = await asUser(users.bob, (tx) => getAiUsage(tx, orgA));
    expect(bobUsage).toEqual({ spentMicros: 0, callsToday: 0, webFetchesToday: 0 });
  });

  it('refuse a call that would exceed the monthly budget, before anything is recorded', async () => {
    const bob = await actor(users.bob, orgB);
    const limits = { ...LIMITS, monthlyBudgetMicros: 2_500 };
    await asUser(users.bob, (tx) => reserveGeneration(tx, bob, limits, params(brandB, 2_000)));
    await expect(
      asUser(users.bob, (tx) => reserveGeneration(tx, bob, limits, params(brandB, 1_000))),
    ).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
    });
    expect(await asUser(users.bob, (tx) => count(tx, 'ai_generations'))).toBe(1);
  });

  it('count pending calls at their reservation and finished calls at their real cost', async () => {
    const bob = await actor(users.bob, orgB);
    const before = await asUser(users.bob, (tx) => getAiUsage(tx, orgB));
    const id = await asUser(users.bob, (tx) => reserveGeneration(tx, bob, LIMITS, params(brandB, 5_000)));
    expect((await asUser(users.bob, (tx) => getAiUsage(tx, orgB))).spentMicros).toBe(
      before.spentMicros + 5_000,
    );
    await asUser(users.bob, (tx) =>
      finishGeneration(tx, bob, id, {
        status: 'failed',
        usage: NO_USAGE,
        costMicros: 0,
        latencyMs: 1,
        errorCode: 'X',
      }),
    );
    expect((await asUser(users.bob, (tx) => getAiUsage(tx, orgB))).spentMicros).toBe(before.spentMicros);
  });

  it('serialize concurrent reservations so the budget holds', async () => {
    const [{ id: orgC }] = (
      await admin.query<{ id: string }>(
        `insert into public.organizations (name, slug) values ('C', 'c-org') returning id`,
      )
    ).rows as [{ id: string }];
    await addMember(orgC, users.dave, 'editor');
    const { rows } = await admin.query<{ id: string }>(
      `insert into public.brands (org_id, name, slug) values ($1, 'C', 'c') returning id`,
      [orgC],
    );
    const dave = await actor(users.dave, orgC);
    const limits = { ...LIMITS, monthlyBudgetMicros: 10_000 };
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        asUser(users.dave, (tx) => reserveGeneration(tx, dave, limits, params(rows[0]!.id, 3_000))),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
  });

  it('enforce the daily call cap', async () => {
    const dave = await actor(users.dave, orgA);
    const used = (await asUser(users.dave, (tx) => getAiUsage(tx, orgA))).callsToday;
    await expect(
      asUser(users.dave, (tx) =>
        reserveGeneration(tx, dave, { ...LIMITS, dailyCalls: used }, params(brandA)),
      ),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('enforce the daily website-read cap', async () => {
    const dave = await actor(users.dave, orgA);
    const limits = { ...LIMITS, webFetchDaily: 2 };
    await asUser(users.dave, (tx) => recordWebFetch(tx, dave, limits, 5));
    await asUser(users.dave, (tx) => recordWebFetch(tx, dave, limits, 1));
    await expect(asUser(users.dave, (tx) => recordWebFetch(tx, dave, limits, 1))).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });
});

describe('usage and entitlements', () => {
  it('usage events are append-only', async () => {
    await expect(
      asUser(users.alice, (tx) => tx.execute(sql`update public.usage_events set cost_micros = 0`)),
    ).rejects.toThrow();
    await expect(
      asUser(users.alice, (tx) => tx.execute(sql`delete from public.usage_events`)),
    ).rejects.toThrow();
  });

  it('entitlements are readable by members but never writable by the app', async () => {
    await admin.query(
      `insert into public.org_entitlements (org_id, ai_monthly_budget_micros) values ($1, 5000000)`,
      [orgA],
    );
    const rows = await asUser(users.carol, async (tx) =>
      rowsOf(await tx.execute(sql`select ai_monthly_budget_micros from public.org_entitlements`)),
    );
    expect(rows).toHaveLength(1);
    expect(await asUser(users.bob, (tx) => count(tx, 'org_entitlements'))).toBe(0);
    await expect(
      asUser(users.alice, (tx) =>
        tx.execute(sql`update public.org_entitlements set ai_monthly_budget_micros = 999999999`),
      ),
    ).rejects.toThrow();
    await expect(
      asUser(users.bob, (tx) =>
        tx.execute(sql`insert into public.org_entitlements (org_id) values (${orgB})`),
      ),
    ).rejects.toThrow();
  });
});
