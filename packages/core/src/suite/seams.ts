import { and, eq } from 'drizzle-orm';
import { DEFAULT_AI_DAILY_CALLS, DEFAULT_WEB_FETCH_DAILY } from '../ai/budget';
import { usdToMicros } from '../ai/pricing';
import type { DbTx } from '../db/client';
import { brands, orgEntitlements, type OrgRole } from '../db/schema';
import type { Brand } from '../domain/brands/service';
import { getCurrentVoice, type BrandVoiceProfile } from '../domain/brands/voice';

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
  | 'feature_disabled';

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

/**
 * Server-side Entitlements seam (`s10-marketing.md` §5.3).
 * Today reads `org_entitlements` in Aurora Postgres; in Phase 3 this swaps to
 * S10/Suite `GET /api/v1/entitlements` (60s cache, fail-closed, Vercel OIDC for worker calls).
 */
export async function checkEntitlement(
  tx: DbTx,
  input: Omit<EntitlementCheckInput, 'entitlement' | 'source'>,
): Promise<EntitlementCheckResult> {
  const [row] = await tx
    .select()
    .from(orgEntitlements)
    .where(eq(orgEntitlements.orgId, input.accountId));
  return evaluateMarketingEntitlement({
    ...input,
    entitlement: row ?? null,
    source: 'local_db',
  });
}
