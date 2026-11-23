import { z } from 'zod';

/**
 * Calls to the versioned S10/Suite API (MASTER-PLAN 6.9) as a signed-in person: their Cognito
 * access token plus `X-S10-App`. The Suite checks the token came from this app's own client.
 *
 * Fail closed: a Suite that cannot be reached, answers 5xx, times out or sends something that
 * does not match the expected shape throws `SuiteUnavailableError`. Callers must then allow
 * nothing and write no state from the missing answer. A 4xx answer (the Suite understood and
 * refused) returns null. Failures are never cached.
 *
 * No `server-only` import and no globals read at import time, so it is unit-testable.
 */
export class SuiteUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuiteUnavailableError';
  }
}

export const SUITE_ROLE_VALUES = ['owner', 'admin', 'member', 'viewer'] as const;
const roleSchema = z.enum(SUITE_ROLE_VALUES);

const meSchema = z.object({
  user: z.object({ sub: z.string() }),
  accounts: z.array(
    z.object({
      account_id: z.string().min(1),
      name: z.string(),
      display_name: z.string().optional(),
      role: roleSchema,
      /** Apps this person holds a seat in. */
      apps: z.array(z.string()).optional(),
      per_business_apps: z.array(z.string()).optional(),
      businesses: z.array(
        z.object({
          business_id: z.string().min(1),
          name: z.string(),
          apps: z.array(z.string()).optional(),
          enabled_apps: z.array(z.string()).optional(),
        }),
      ),
    }),
  ),
});
export type SuiteMe = z.infer<typeof meSchema>;
export type SuiteMeAccount = SuiteMe['accounts'][number];

const entitlementsSchema = z.object({
  account_id: z.string(),
  status: z.enum(['none', 'active', 'inactive']),
  plan_id: z.string().nullable(),
  plan_ids: z.array(z.string()).optional(),
  apps: z.array(z.string()),
  /** null means no limit. A missing key means the feature is not included. */
  limits: z.record(z.string(), z.number().nullable()),
  /** null when an app's server called with no user present. */
  role: roleSchema.nullable(),
  member_apps: z.array(z.string()).nullable().optional(),
  business_ids: z.array(z.string()),
  comped: z.boolean().optional(),
  version: z.number(),
});
export type SuiteEntitlements = z.infer<typeof entitlementsSchema>;

const preferencesSchema = z.object({
  theme: z.string(),
  mode: z.string(),
  /** False when the person never chose a look and this is the Suite's default. */
  saved: z.boolean().optional(),
});
export type SuitePreferences = z.infer<typeof preferencesSchema>;

export interface SuiteClientConfig {
  suiteUrl: string;
  /** This app's registry id, sent as `X-S10-App`. */
  appId: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** The person making the call. `sub` keys the caches so one person's answer never reaches another. */
export interface SuiteCaller {
  accessToken: string;
  sub: string;
}

export const SUITE_TIMEOUT_MS = 5000;
/** Entitlements and the account list are cached about 60 seconds (MASTER-PLAN 6.3). */
export const SUITE_CACHE_TTL_MS = 60_000;

export function createSuiteClient(config: SuiteClientConfig) {
  const suiteUrl = config.suiteUrl.replace(/\/+$/, '');
  const doFetch = config.fetchImpl ?? fetch;
  const now = config.now ?? Date.now;
  const timeoutMs = config.timeoutMs ?? SUITE_TIMEOUT_MS;
  const cache = new Map<string, { at: number; value: unknown }>();

  async function request<T>(
    path: string,
    bearer: string,
    schema: z.ZodType<T>,
    init: { method?: 'GET' | 'PUT'; body?: unknown } = {},
  ): Promise<T | null> {
    let res: Response;
    try {
      res = await doFetch(`${suiteUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'X-S10-App': config.appId,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
    } catch {
      throw new SuiteUnavailableError(`Suite unreachable: ${path.split('?')[0]}`);
    }
    if (res.status >= 500)
      throw new SuiteUnavailableError(`Suite error ${res.status}: ${path.split('?')[0]}`);
    if (!res.ok) return null;
    const parsed = schema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success)
      throw new SuiteUnavailableError(`Unexpected answer from the Suite: ${path.split('?')[0]}`);
    return parsed.data;
  }

  async function cached<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < SUITE_CACHE_TTL_MS) return hit.value as T;
    const value = await load();
    if (value) cache.set(key, { at: now(), value });
    return value;
  }

  return {
    /** `/api/v1/me`: accounts, roles, businesses and which apps are on where. null = refused (sign in again). */
    me: (who: SuiteCaller) => cached(`me:${who.sub}`, () => request('/api/v1/me', who.accessToken, meSchema)),

    /** `/api/v1/entitlements`: what the account may use. null = refused for this person. */
    entitlements: (who: SuiteCaller, accountId: string) =>
      cached(`ent:${who.sub}:${accountId}`, () =>
        request(
          `/api/v1/entitlements?account_id=${encodeURIComponent(accountId)}`,
          who.accessToken,
          entitlementsSchema,
        ),
      ),

    /** `/api/v1/me/preferences`: the person's theme and light/dark choice, the same in every app. Not cached here. */
    preferences: (who: Pick<SuiteCaller, 'accessToken'>) =>
      request('/api/v1/me/preferences', who.accessToken, preferencesSchema),

    savePreferences: (who: Pick<SuiteCaller, 'accessToken'>, prefs: { theme: string; mode: string }) =>
      request('/api/v1/me/preferences', who.accessToken, preferencesSchema, { method: 'PUT', body: prefs }),

    /** For tests. */
    clearCache: () => cache.clear(),
  };
}

export type SuiteClient = ReturnType<typeof createSuiteClient>;
