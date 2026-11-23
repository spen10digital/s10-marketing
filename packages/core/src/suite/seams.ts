import { and, eq } from 'drizzle-orm';
import { DEFAULT_AI_DAILY_CALLS, DEFAULT_WEB_FETCH_DAILY } from '../ai/budget';
import { usdToMicros } from '../ai/pricing';
import type { DbTx } from '../db/client';
import { brands, orgEntitlements, type OrgRole } from '../db/schema';
import type { Brand } from '../domain/brands/service';
import { getCurrentVoice, type BrandVoiceProfile } from '../domain/brands/voice';
import { SuiteUnavailableError, type SuiteEntitlements } from './client';
import { decide, type DenialReason } from './entitlement';

/**
 * S10/Suite Phase 3 Integration Seams (S10Suite/docs/apps/s10-marketing.md §5–§6).
 *
 * Canonical mappings:
 * - `organizations.id` (`OrgId`) <-> Suite `account_id` (`SuiteAccountId`)
 * - `brands.id` (`BrandId`) <-> Suite `business_id` (`SuiteBusinessId`)
 * - Marketing `OrgRole` ('owner' | 'admin' | 'editor' | 'viewer') <->
 *   Suite `SuiteRole` ('owner' | 'admin' | 'member' | 'viewer')
 */

export type OrgId = string;
export type BrandId = string;
export type SuiteAccountId = string;
export type SuiteBusinessId = string;

export interface MarketingTenancyRef {
  orgId: OrgId;
  brandId: BrandId;
}

export interface SuiteTenancyRef {
  accountId: SuiteAccountId;
  businessId: SuiteBusinessId;
}

export function toSuiteTenancy(ref: MarketingTenancyRef): SuiteTenancyRef {
  return {
    accountId: ref.orgId,
    businessId: ref.brandId,
  };
}

export function toMarketingTenancy(ref: SuiteTenancyRef): MarketingTenancyRef {
  return {
    orgId: ref.accountId,
    brandId: ref.businessId,
  };
}

export const SUITE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type SuiteRole = (typeof SUITE_ROLES)[number];

/** Canonical Marketing role alias matching `OrgRole` in `db/schema`. */
export type Role = OrgRole;
export type MarketingRole = OrgRole;

const SUITE_TO_MARKETING_ROLE: Record<SuiteRole, Role> = {
  owner: 'owner',
  admin: 'admin',
  member: 'editor',
  viewer: 'viewer',
};

const MARKETING_TO_SUITE_ROLE: Record<Role, SuiteRole> = {
  owner: 'owner',
  admin: 'admin',
  editor: 'member',
  viewer: 'viewer',
};

/** Maps a unified S10/Suite 4-role value ('member') to Marketing's `OrgRole` ('editor'). */
export function suiteRoleToMarketingRole(role: SuiteRole): Role {
  return SUITE_TO_MARKETING_ROLE[role];
}

/** Maps a Marketing `OrgRole` ('editor') to the unified S10/Suite 4-role value ('member'). */
export function marketingRoleToSuiteRole(role: Role): SuiteRole {
  return MARKETING_TO_SUITE_ROLE[role];
}

export interface BrandKitVoiceView {
  version: number;
  audience: string;
  tone: string;
  guidelines: string;
  doList: string[];
  dontList: string[];
  examplePosts: string[];
  ctaDefaults: string[];
}

export interface CurrentBusinessView {
  accountId: SuiteAccountId;
  businessId: SuiteBusinessId;
  orgId: OrgId;
  brandId: BrandId;
  name: string;
  slug: string;
  description: string | null;
  websiteUrl: string | null;
  timezone: string | null;
  archived: boolean;
  voice: BrandKitVoiceView | null;
  source: 'local_db' | 'suite_brand_kit';
}

export type BrandRecordForBusiness = Pick<
  Brand,
  'id' | 'orgId' | 'name' | 'slug' | 'description' | 'websiteUrl' | 'timezone' | 'archivedAt'
>;

export type VoiceRecordForBusiness = Pick<
  BrandVoiceProfile,
  'version' | 'audience' | 'tone' | 'guidelines' | 'doList' | 'dontList' | 'examplePosts' | 'ctaDefaults'
>;

/**
 * Pure seam resolver converting a local `brands` + `brand_voice_profiles` pair (or future Suite
 * Brand Kit payload) into the canonical `CurrentBusinessView`.
 */
export function resolveCurrentBusiness(
  brand: BrandRecordForBusiness,
  voice: VoiceRecordForBusiness | null = null,
  source: 'local_db' | 'suite_brand_kit' = 'local_db',
): CurrentBusinessView {
  return {
    accountId: brand.orgId,
    businessId: brand.id,
    orgId: brand.orgId,
    brandId: brand.id,
    name: brand.name,
    slug: brand.slug,
    description: brand.description ?? null,
    websiteUrl: brand.websiteUrl ?? null,
    timezone: brand.timezone ?? null,
    archived: brand.archivedAt !== null,
    voice: voice
      ? {
          version: voice.version,
          audience: voice.audience,
          tone: voice.tone,
          guidelines: voice.guidelines,
          doList: [...voice.doList],
          dontList: [...voice.dontList],
          examplePosts: [...voice.examplePosts],
          ctaDefaults: [...voice.ctaDefaults],
        }
      : null,
    source,
  };
}

/**
 * Server-side Business & Brand Kit seam (`s10-marketing.md` §5.2).
 * Today reads Marketing's own `brands` and `brand_voice_profiles` tables under RLS;
 * in Phase 3 this swaps to the Suite Brand Kit API (`/api/v1/brands`).
 */
export async function getCurrentBusiness(
  tx: DbTx,
  orgId: OrgId,
  lookup: { brandId: BrandId } | { slug: string },
): Promise<CurrentBusinessView | null> {
  const condition =
    'brandId' in lookup
      ? and(eq(brands.orgId, orgId), eq(brands.id, lookup.brandId))
      : and(eq(brands.orgId, orgId), eq(brands.slug, lookup.slug));
  const [brand] = await tx.select().from(brands).where(condition);
  if (!brand) return null;
  const voice = await getCurrentVoice(tx, orgId, brand.id);
  return resolveCurrentBusiness(brand, voice, 'local_db');
}

export type MarketingEntitlementKey =
  /** May this person use S10/Marketing here at all (plan, seat, role, business). */
  | 'app.access'
  | 'ai.monthly_budget_micros'
  | 'ai.daily_calls'
  | 'web_fetch.daily'
  | 'marketing.seats'
  | 'social.connected_pages';

export interface LocalOrgEntitlementRecord {
  orgId: OrgId;
  aiMonthlyBudgetMicros?: number | null;
  aiDailyCalls?: number | null;
  webFetchDaily?: number | null;
  seats?: number | null;
  connectedSocialPages?: number | null;
}

export type EntitlementDenialReason =
  | 'limit_exceeded'
  | 'budget_exceeded'
  | 'no_seat'
  | 'feature_disabled'
  /** From the Suite (fail closed when it cannot be reached). */
  | 'suite_unavailable'
  | 'not_in_plan'
  | 'view_only'
  | 'needs_business'
  | 'no_business';

export interface EntitlementCheckInput {
  accountId: SuiteAccountId;
  key: MarketingEntitlementKey;
  /** Current usage count/amount prior to the requested operation (defaults to 0). */
  used?: number;
  /** Incremental amount requested (defaults to 1). */
  requested?: number;
  /** Local `org_entitlements` override row, if any. */
  entitlement?: LocalOrgEntitlementRecord | null;
  /** Default monthly AI budget in USD when no org override exists (defaults to $10). */
  defaultMonthlyBudgetUsd?: number;
  source?: 'local_db' | 'suite_api';
}

export interface EntitlementCheckResult {
  allowed: boolean;
  accountId: SuiteAccountId;
  orgId: OrgId;
  key: MarketingEntitlementKey;
  /** Numeric cap, or `null` when unlimited (matches S10/Suite `decide()` convention). */
  limit: number | null;
  used: number;
  remaining: number | null;
  reason?: EntitlementDenialReason;
  /** The Suite's own reason (and message key in DECISION_MESSAGES) when the Suite denied. */
  suiteReason?: DenialReason;
  source: 'local_db' | 'suite_api';
}

export const DEFAULT_MONTHLY_AI_BUDGET_USD = 10;

function resolveEntitlementLimit(
  key: MarketingEntitlementKey,
  entitlement: LocalOrgEntitlementRecord | null | undefined,
  defaultMonthlyBudgetUsd: number,
): number | null {
  switch (key) {
    case 'ai.monthly_budget_micros':
      return entitlement?.aiMonthlyBudgetMicros ?? usdToMicros(defaultMonthlyBudgetUsd);
    case 'ai.daily_calls':
      return entitlement?.aiDailyCalls ?? DEFAULT_AI_DAILY_CALLS;
    case 'web_fetch.daily':
      return entitlement?.webFetchDaily ?? DEFAULT_WEB_FETCH_DAILY;
    case 'marketing.seats':
      return entitlement?.seats ?? null;
    case 'app.access':
      return null;
    case 'social.connected_pages':
      return entitlement?.connectedSocialPages ?? null;
  }
}

/**
 * Pure entitlement evaluator for S10/Marketing (`s10-marketing.md` §5.3).
 * Evaluates per-account (`org_id` / `account_id`) limits and follows the S10/Suite
 * `null = unlimited` convention for unconfigured caps.
 */
export function evaluateMarketingEntitlement(input: EntitlementCheckInput): EntitlementCheckResult {
  const used = Math.max(0, input.used ?? 0);
  const requested = Math.max(0, input.requested ?? 1);
  const defaultBudgetUsd = input.defaultMonthlyBudgetUsd ?? DEFAULT_MONTHLY_AI_BUDGET_USD;
  const source = input.source ?? 'local_db';
  const limit = resolveEntitlementLimit(input.key, input.entitlement, defaultBudgetUsd);

  if (limit === null) {
    return {
      allowed: true,
      accountId: input.accountId,
      orgId: input.accountId,
      key: input.key,
      limit: null,
      used,
      remaining: null,
      source,
    };
  }

  const allowed = used + requested <= limit;
  const remaining = Math.max(0, limit - used);
  if (allowed) {
    return {
      allowed: true,
      accountId: input.accountId,
      orgId: input.accountId,
      key: input.key,
      limit,
      used,
      remaining,
      source,
    };
  }

  const reason: EntitlementDenialReason =
    input.key === 'ai.monthly_budget_micros'
      ? 'budget_exceeded'
      : input.key === 'marketing.seats'
        ? 'no_seat'
        : 'limit_exceeded';

  return {
    allowed: false,
    accountId: input.accountId,
    orgId: input.accountId,
    key: input.key,
    limit,
    used,
    remaining,
    reason,
    source,
  };
}

/** What the caller wants checked. `app.access` is "may this person use S10/Marketing here at all". */
export interface CheckEntitlementInput {
  /** The Suite account whose entitlements decide. */
  suiteAccountId: string;
  /** The local organization row (for `org_entitlements` overrides and the result). */
  orgId: OrgId;
  key: MarketingEntitlementKey;
  used?: number;
  requested?: number;
  defaultMonthlyBudgetUsd?: number;
  /** The Suite business (brand) the feature acts on. */
  businessId?: string;
  /** The feature stores data, so the person must be working in a business. */
  requireBusiness?: boolean;
  /** The feature creates or changes something: Viewers may only view. */
  write?: boolean;
}

export interface CheckEntitlementDeps {
  /**
   * The Suite's entitlements for the account, as the signed-in person. null means the Suite
   * refused; it throws SuiteUnavailableError when it cannot answer. Both deny (fail closed).
   */
  entitlements: (suiteAccountId: string) => Promise<SuiteEntitlements | null>;
  /** Needed only for keys that have local `org_entitlements` overrides (AI budget, daily calls, fetches). */
  tx?: DbTx;
  /** This app's entitlement key in the Suite. Defaults to `marketing`. */
  appId?: string;
}

const SUITE_REASON_TO_DENIAL: Record<DenialReason, EntitlementDenialReason> = {
  'suite-unavailable': 'suite_unavailable',
  'not-in-plan': 'not_in_plan',
  'no-seat': 'no_seat',
  'view-only': 'view_only',
  'over-limit': 'limit_exceeded',
  'no-business': 'no_business',
  'needs-business': 'needs_business',
};

/**
 * Server-side Entitlements seam (`s10-marketing.md` §5.3). EVERY feature and limit check goes
 * through here and asks the Suite (`GET /api/v1/entitlements`, 60 s cache, 5 s timeout) FIRST
 * with the template's `decide()` semantics: app in the plan, a seat, Viewers read-only, the
 * right business, `null` = unlimited. Then the existing `org_entitlements` overrides apply for
 * the AI budget, daily AI calls and daily web fetches, exactly as before.
 *
 * Fail closed: when the Suite gives no answer, nothing is allowed and the database is not
 * touched (no state is read or written from the missing answer).
 */
export async function checkEntitlement(
  deps: CheckEntitlementDeps,
  input: CheckEntitlementInput,
): Promise<EntitlementCheckResult> {
  const appId = deps.appId ?? 'marketing';
  const used = Math.max(0, input.used ?? 0);
  const requested = Math.max(0, input.requested ?? 1);

  let ent: SuiteEntitlements | null;
  try {
    ent = await deps.entitlements(input.suiteAccountId);
  } catch (err) {
    if (!(err instanceof SuiteUnavailableError)) throw err;
    ent = null;
  }

  const seats = input.key === 'marketing.seats';
  const decision = decide(ent, appId, {
    businessId: input.businessId,
    requireBusiness: input.requireBusiness,
    write: input.write,
    ...(seats ? { limitKey: 'marketing.seats', amount: used + requested } : {}),
  });
  const base = {
    accountId: input.suiteAccountId,
    orgId: input.orgId,
    key: input.key,
    used,
    source: 'suite_api' as const,
  };
  if (!decision.allowed) {
    return {
      ...base,
      allowed: false,
      limit: decision.limit ?? null,
      remaining: decision.limit === undefined ? null : Math.max(0, decision.limit - used),
      reason: seats && decision.reason === 'over-limit' ? 'no_seat' : SUITE_REASON_TO_DENIAL[decision.reason],
      suiteReason: decision.reason,
    };
  }
  if (input.key === 'app.access') return { ...base, allowed: true, limit: null, remaining: null };
  if (seats) {
    const limit = decision.limit ?? null;
    return { ...base, allowed: true, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
  }

  // The Suite said yes. Now the local per-organization overrides for the limits this app meters itself.
  if (!deps.tx) throw new Error(`checkEntitlement(${input.key}) needs a transaction for local limits`);
  const [row] = await deps.tx.select().from(orgEntitlements).where(eq(orgEntitlements.orgId, input.orgId));
  const local = evaluateMarketingEntitlement({
    accountId: input.orgId,
    key: input.key,
    used,
    requested,
    defaultMonthlyBudgetUsd: input.defaultMonthlyBudgetUsd,
    entitlement: row ?? null,
    source: 'local_db',
  });
  return { ...local, accountId: input.suiteAccountId, orgId: input.orgId, source: 'local_db' };
}
