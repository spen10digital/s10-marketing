import { describe, expect, it, vi } from 'vitest';
import type { DbTx } from '../db/client';
import { SuiteUnavailableError, type SuiteEntitlements } from './client';
import { checkEntitlement, type CheckEntitlementInput } from './seams';

const ent = (over: Partial<SuiteEntitlements> = {}): SuiteEntitlements => ({
  account_id: 'ACCT_A',
  status: 'active',
  plan_id: 'throwaway-plan',
  apps: ['marketing'],
  limits: { 'marketing.seats': 3 },
  role: 'member',
  member_apps: ['marketing'],
  business_ids: ['BIZ_1'],
  version: 1,
  ...over,
});

const input = (over: Partial<CheckEntitlementInput> = {}): CheckEntitlementInput => ({
  suiteAccountId: 'ACCT_A',
  orgId: 'org-uuid',
  key: 'app.access',
  ...over,
});

/** A transaction that fails the test if anything touches it. */
const forbiddenTx = new Proxy(
  {},
  {
    get() {
      throw new Error('the database must not be touched');
    },
  },
) as unknown as DbTx;

const txWithOverride = (row: Record<string, unknown> | null) =>
  ({ select: () => ({ from: () => ({ where: async () => (row ? [row] : []) }) }) }) as unknown as DbTx;

describe('checkEntitlement asks the Suite first and fails closed', () => {
  it.each([
    ['the Suite is unreachable', () => Promise.reject(new SuiteUnavailableError('down'))],
    ['the Suite refuses', () => Promise.resolve(null)],
  ])('allows nothing and touches no state when %s', async (_name, answer) => {
    for (const key of ['app.access', 'marketing.seats', 'ai.daily_calls', 'web_fetch.daily'] as const) {
      const result = await checkEntitlement(
        { entitlements: vi.fn(answer), tx: forbiddenTx },
        input({ key, write: true }),
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('suite_unavailable');
      expect(result.suiteReason).toBe('suite-unavailable');
    }
  });

  it('does not hide programming errors as "unavailable"', async () => {
    await expect(
      checkEntitlement({ entitlements: async () => Promise.reject(new Error('bug')) }, input()),
    ).rejects.toThrow('bug');
  });

  it('allows access for a person with a seat, and passes the account to the Suite', async () => {
    const entitlements = vi.fn(async () => ent());
    const r = await checkEntitlement({ entitlements }, input({ businessId: 'BIZ_1', requireBusiness: true }));
    expect(r).toMatchObject({
      allowed: true,
      limit: null,
      source: 'suite_api',
      accountId: 'ACCT_A',
      orgId: 'org-uuid',
    });
    expect(entitlements).toHaveBeenCalledWith('ACCT_A');
  });

  it.each([
    ['not in plan', ent({ apps: ['mail'] }), {}, 'not_in_plan'],
    ['inactive subscription', ent({ status: 'inactive' }), {}, 'not_in_plan'],
    ['no seat', ent({ member_apps: ['mail'] }), {}, 'no_seat'],
    ['viewer writing', ent({ role: 'viewer' }), { write: true }, 'view_only'],
    ['needs a business', ent(), { requireBusiness: true }, 'needs_business'],
    ['wrong business', ent(), { businessId: 'OTHER' }, 'no_business'],
  ])('denies: %s', async (_n, answer, extra, reason) => {
    const r = await checkEntitlement({ entitlements: async () => answer, tx: forbiddenTx }, input(extra));
    expect(r).toMatchObject({ allowed: false, reason });
  });

  it('lets a Viewer read', async () => {
    const r = await checkEntitlement({ entitlements: async () => ent({ role: 'viewer' }) }, input());
    expect(r.allowed).toBe(true);
  });

  it('checks marketing.seats against the Suite limit, null meaning unlimited', async () => {
    const capped = await checkEntitlement(
      { entitlements: async () => ent() },
      input({ key: 'marketing.seats', used: 3, requested: 1 }),
    );
    expect(capped).toMatchObject({ allowed: false, reason: 'no_seat', limit: 3 });
    const within = await checkEntitlement(
      { entitlements: async () => ent() },
      input({ key: 'marketing.seats', used: 2, requested: 1 }),
    );
    expect(within).toMatchObject({ allowed: true, limit: 3, remaining: 1 });
    const unlimited = await checkEntitlement(
      { entitlements: async () => ent({ limits: { 'marketing.seats': null } }) },
      input({ key: 'marketing.seats', used: 9999 }),
    );
    expect(unlimited).toMatchObject({ allowed: true, limit: null, remaining: null });
    const notIncluded = await checkEntitlement(
      { entitlements: async () => ent({ limits: {} }) },
      input({ key: 'marketing.seats' }),
    );
    expect(notIncluded).toMatchObject({ allowed: false, reason: 'not_in_plan' });
  });
});

describe('local org_entitlements overrides still apply after the Suite allows', () => {
  it('uses the override row for daily AI calls', async () => {
    const tx = txWithOverride({ orgId: 'org-uuid', aiDailyCalls: 5 });
    const deps = { entitlements: async () => ent(), tx };
    expect(await checkEntitlement(deps, input({ key: 'ai.daily_calls', used: 4 }))).toMatchObject({
      allowed: true,
      limit: 5,
      source: 'local_db',
      accountId: 'ACCT_A',
    });
    expect(await checkEntitlement(deps, input({ key: 'ai.daily_calls', used: 5 }))).toMatchObject({
      allowed: false,
      reason: 'limit_exceeded',
    });
  });

  it('falls back to the defaults without an override row', async () => {
    const r = await checkEntitlement(
      { entitlements: async () => ent(), tx: txWithOverride(null) },
      input({ key: 'ai.monthly_budget_micros', used: 0, requested: 1, defaultMonthlyBudgetUsd: 10 }),
    );
    expect(r).toMatchObject({ allowed: true, limit: 10_000_000 });
  });

  it('refuses to run a local-limit key without a transaction', async () => {
    await expect(
      checkEntitlement({ entitlements: async () => ent() }, input({ key: 'web_fetch.daily' })),
    ).rejects.toThrow(/transaction/);
  });
});
