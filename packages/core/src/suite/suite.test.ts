import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client';
import { createSuiteClient, SuiteUnavailableError, type SuiteMe } from './client';
import { decide } from './entitlement';
import { createOrgResolver, SYNC_REUSE_MS } from './orgs';
import { accountsToSync, appActiveOn } from './tenancy';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ME: SuiteMe = {
  user: { sub: 'u-1' },
  accounts: [
    {
      account_id: 'ACCT_A',
      name: 'Throwaway A',
      role: 'owner',
      apps: ['marketing', 'mail'],
      per_business_apps: [],
      businesses: [
        { business_id: 'BIZ_1', name: 'Biz One', apps: ['marketing'], enabled_apps: [] },
        { business_id: 'BIZ_2', name: 'Biz Two', apps: ['mail'], enabled_apps: [] },
      ],
    },
    { account_id: 'ACCT_B', name: 'No Marketing', role: 'member', apps: ['mail'], businesses: [] },
  ],
};

const caller = { accessToken: 'tok', sub: 'u-1' };

describe('Suite client', () => {
  it('calls /me with the bearer token and the app id, and caches for 60 s', async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn(async () => json(ME));
    const client = createSuiteClient({
      suiteUrl: 'https://suite.example.test/',
      appId: 'marketing',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });
    expect((await client.me(caller))?.accounts).toHaveLength(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://suite.example.test/api/v1/me');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'X-S10-App': 'marketing' });
    await client.me(caller);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 61_000;
    await client.me(caller);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Another person never gets this person's cached answer.
    await client.me({ accessToken: 't2', sub: 'u-2' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
    ['500', () => Promise.resolve(json({}, 500))],
    ['503', () => Promise.resolve(json({}, 503))],
    ['malformed body', () => Promise.resolve(json({ nope: true }))],
    ['not json', () => Promise.resolve(new Response('<html>', { status: 200 }))],
  ])('fails closed on %s: throws SuiteUnavailableError and caches nothing', async (_name, respond) => {
    const fetchImpl = vi.fn(respond);
    const client = createSuiteClient({
      suiteUrl: 'https://suite.example.test',
      appId: 'marketing',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.me(caller)).rejects.toBeInstanceOf(SuiteUnavailableError);
    await expect(client.entitlements(caller, 'ACCT_A')).rejects.toBeInstanceOf(SuiteUnavailableError);
    await expect(client.me(caller)).rejects.toBeInstanceOf(SuiteUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // nothing was cached
  });

  it('returns null when the Suite refuses (4xx)', async () => {
    const client = createSuiteClient({
      suiteUrl: 'https://suite.example.test',
      appId: 'marketing',
      fetchImpl: (async () => json({ error: 'forbidden' }, 403)) as unknown as typeof fetch,
    });
    expect(await client.me(caller)).toBeNull();
    expect(await client.entitlements(caller, 'ACCT_A')).toBeNull();
  });
});

describe('which accounts and businesses get an organization and brand', () => {
  it('follows plan 2.4 for per-business apps and treats missing fields as off', () => {
    expect(appActiveOn({}, { apps: ['marketing'] }, 'marketing')).toBe(true);
    expect(appActiveOn({}, {}, 'marketing')).toBe(false);
    expect(appActiveOn({ per_business_apps: ['marketing'] }, { apps: ['marketing'] }, 'marketing')).toBe(
      false,
    );
    expect(
      appActiveOn({ per_business_apps: ['marketing'] }, { enabled_apps: ['marketing'] }, 'marketing'),
    ).toBe(true);
  });

  it('syncs only accounts where Marketing is on, with only the businesses it is on for', () => {
    const accounts = accountsToSync(ME, 'marketing');
    expect(accounts.map((a) => a.accountId)).toEqual(['ACCT_A']);
    expect(accounts[0]!.businesses).toEqual([{ businessId: 'BIZ_1', name: 'Biz One' }]);
  });

  it('does not sync a per-business app account that has no business with it enabled', () => {
    const me: SuiteMe = {
      ...ME,
      accounts: [
        {
          ...ME.accounts[0]!,
          per_business_apps: ['marketing'],
          businesses: [{ business_id: 'B', name: 'B' }],
        },
      ],
    };
    expect(accountsToSync(me, 'marketing')).toEqual([]);
  });
});

describe('org resolver fails closed when the Suite gives no answer', () => {
  const db = {} as Database;
  const fail = (err: unknown) => ({ me: vi.fn(async () => Promise.reject(err)) });

  it('does not sync (no organization created, no membership changed) when the Suite is unreachable', async () => {
    const sync = vi.fn();
    const resolver = createOrgResolver({ appId: 'marketing', sync });
    const result = await resolver.resolve({
      client: fail(new SuiteUnavailableError('down')),
      db,
      userId: 'user',
      accessToken: 't',
      sub: 's',
    });
    expect(result).toEqual({ state: 'suite-unavailable' });
    expect(sync).not.toHaveBeenCalled();
  });

  it('does not sync when the Suite refuses the token', async () => {
    const sync = vi.fn();
    const resolver = createOrgResolver({ appId: 'marketing', sync });
    const result = await resolver.resolve({
      client: { me: vi.fn(async () => null) },
      db,
      userId: 'user',
      accessToken: 't',
      sub: 's',
    });
    expect(result).toEqual({ state: 'suite-refused' });
    expect(sync).not.toHaveBeenCalled();
  });

  it('rethrows unexpected errors instead of hiding them as "unavailable"', async () => {
    const resolver = createOrgResolver({ appId: 'marketing', sync: vi.fn() });
    await expect(
      resolver.resolve({ client: fail(new Error('bug')), db, userId: 'u', accessToken: 't', sub: 's' }),
    ).rejects.toThrow('bug');
  });

  it('syncs on a real answer, reuses it for 5 minutes, and syncs again when the answer changes', async () => {
    let now = 0;
    const orgs = [{ id: 'o1' }] as never;
    const sync = vi.fn(async () => orgs);
    const resolver = createOrgResolver({ appId: 'marketing', sync, now: () => now });
    const client = { me: vi.fn(async () => ME) };
    const args = { client, db, userId: 'user', accessToken: 't', sub: 's' };
    expect((await resolver.resolve(args)).state).toBe('ok');
    await resolver.resolve(args);
    expect(sync).toHaveBeenCalledTimes(1);
    now += SYNC_REUSE_MS + 1;
    await resolver.resolve(args);
    expect(sync).toHaveBeenCalledTimes(2);
    client.me.mockResolvedValueOnce({ ...ME, accounts: [{ ...ME.accounts[0]!, role: 'viewer' as const }] });
    await resolver.resolve(args);
    expect(sync).toHaveBeenCalledTimes(3);
  });
});

describe('decide (same semantics as the template)', () => {
  const ent = {
    account_id: 'ACCT_A',
    status: 'active' as const,
    plan_id: 'p',
    apps: ['marketing'],
    limits: { 'marketing.seats': 5, unlimited: null },
    role: 'member' as const,
    member_apps: ['marketing'],
    business_ids: ['BIZ_1'],
    version: 1,
  };

  it('denies everything without an answer', () => {
    expect(decide(null, 'marketing')).toEqual({ allowed: false, reason: 'suite-unavailable' });
  });
  it('requires the app in the plan, a seat, and the business', () => {
    expect(decide(ent, 'marketing')).toEqual({ allowed: true });
    expect(decide({ ...ent, status: 'inactive' }, 'marketing')).toMatchObject({ reason: 'not-in-plan' });
    expect(decide({ ...ent, apps: ['mail'] }, 'marketing')).toMatchObject({ reason: 'not-in-plan' });
    expect(decide({ ...ent, member_apps: ['mail'] }, 'marketing')).toMatchObject({ reason: 'no-seat' });
    expect(decide(ent, 'marketing', { requireBusiness: true })).toMatchObject({ reason: 'needs-business' });
    expect(decide(ent, 'marketing', { businessId: 'OTHER' })).toMatchObject({ reason: 'no-business' });
    expect(decide(ent, 'marketing', { businessId: 'BIZ_1', requireBusiness: true })).toEqual({
      allowed: true,
    });
  });
  it('keeps Viewers read-only and treats null limit as unlimited, missing key as not included', () => {
    expect(decide({ ...ent, role: 'viewer' }, 'marketing', { write: true })).toMatchObject({
      reason: 'view-only',
    });
    expect(decide({ ...ent, role: null }, 'marketing', { write: true })).toEqual({ allowed: true });
    expect(decide(ent, 'marketing', { limitKey: 'unlimited', amount: 1e9 })).toEqual({
      allowed: true,
      limit: null,
    });
    expect(decide(ent, 'marketing', { limitKey: 'marketing.seats', amount: 6 })).toMatchObject({
      reason: 'over-limit',
    });
    expect(decide(ent, 'marketing', { limitKey: 'missing' })).toMatchObject({ reason: 'not-in-plan' });
  });
});
