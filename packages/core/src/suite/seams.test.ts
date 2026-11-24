import { describe, expect, it } from 'vitest';
import { ORG_ROLES } from '../db/schema';
import {
  DEFAULT_MONTHLY_AI_BUDGET_USD,
  SUITE_ROLES,
  evaluateMarketingEntitlement,
  marketingRoleToSuiteRole,
  resolveCurrentBusiness,
  suiteRoleToMarketingRole,
  toMarketingTenancy,
  toSuiteTenancy,
} from './seams';

describe('S10/Suite Phase 3 integration seams', () => {
  describe('tenancy mapping (SuiteAccountId <-> OrgId, SuiteBusinessId <-> BrandId)', () => {
    it('maps Marketing orgId/brandId 1:1 to Suite accountId/businessId and back', () => {
      const marketingRef = {
        orgId: '11111111-1111-4111-8111-111111111111',
        brandId: '22222222-2222-4222-8222-222222222222',
      };

      const suiteRef = toSuiteTenancy(marketingRef);
      expect(suiteRef).toEqual({
        accountId: marketingRef.orgId,
        businessId: marketingRef.brandId,
      });

      expect(toMarketingTenancy(suiteRef)).toEqual(marketingRef);
    });
  });

  describe('role mapping (SuiteRole <-> Marketing Role)', () => {
    it('maps Suite member to Marketing editor and preserves owner/admin/viewer', () => {
      expect(suiteRoleToMarketingRole('owner')).toBe('owner');
      expect(suiteRoleToMarketingRole('admin')).toBe('admin');
      expect(suiteRoleToMarketingRole('member')).toBe('editor');
      expect(suiteRoleToMarketingRole('viewer')).toBe('viewer');
    });

    it('maps Marketing editor to Suite member and preserves owner/admin/viewer', () => {
      expect(marketingRoleToSuiteRole('owner')).toBe('owner');
      expect(marketingRoleToSuiteRole('admin')).toBe('admin');
      expect(marketingRoleToSuiteRole('editor')).toBe('member');
      expect(marketingRoleToSuiteRole('viewer')).toBe('viewer');
    });

    it('is a lossless bijection across all Suite and Marketing roles', () => {
      for (const suiteRole of SUITE_ROLES) {
        expect(marketingRoleToSuiteRole(suiteRoleToMarketingRole(suiteRole))).toBe(suiteRole);
      }
      for (const orgRole of ORG_ROLES) {
        expect(suiteRoleToMarketingRole(marketingRoleToSuiteRole(orgRole))).toBe(orgRole);
      }
    });
  });

  describe('resolveCurrentBusiness (Business & Brand Kit seam)', () => {
    const baseBrand = {
      id: 'brand-123',
      orgId: 'org-456',
      name: 'SPEN10 Digital',
      slug: 'spen10-digital',
      description: 'Multi-product SaaS ecosystem',
      websiteUrl: 'https://spen10.com',
      timezone: 'America/Los_Angeles',
      archivedAt: null,
    };

    it('resolves a brand without a voice profile into CurrentBusinessView', () => {
      const view = resolveCurrentBusiness(baseBrand, null);
      expect(view).toEqual({
        accountId: 'org-456',
        businessId: 'brand-123',
        orgId: 'org-456',
        brandId: 'brand-123',
        name: 'SPEN10 Digital',
        slug: 'spen10-digital',
        description: 'Multi-product SaaS ecosystem',
        websiteUrl: 'https://spen10.com',
        timezone: 'America/Los_Angeles',
        archived: false,
        voice: null,
        source: 'local_db',
      });
    });

    it('includes cloned voice profile arrays and marks archived brands accurately', () => {
      const doList = ['Be direct'];
      const dontList = ['Use hype'];
      const examplePosts = ['Ship small, ship often.'];
      const ctaDefaults = ['Read more at spen10.com'];

      const view = resolveCurrentBusiness(
        { ...baseBrand, archivedAt: new Date('2026-11-10T00:00:00Z') },
        {
          version: 3,
          audience: 'Founders and builders',
          tone: 'Clear, pragmatic',
          guidelines: 'Keep sentences concise.',
          doList,
          dontList,
          examplePosts,
          ctaDefaults,
        },
        'suite_brand_kit',
      );

      expect(view.archived).toBe(true);
      expect(view.source).toBe('suite_brand_kit');
      expect(view.voice).toEqual({
        version: 3,
        audience: 'Founders and builders',
        tone: 'Clear, pragmatic',
        guidelines: 'Keep sentences concise.',
        doList: ['Be direct'],
        dontList: ['Use hype'],
        examplePosts: ['Ship small, ship often.'],
        ctaDefaults: ['Read more at spen10.com'],
      });

      doList.push('Mutated');
      expect(view.voice?.doList).toEqual(['Be direct']);
    });
  });

  describe('evaluateMarketingEntitlement (Entitlements seam)', () => {
    const accountId = 'org-456';

    it('enforces default monthly AI budget ($10 = 10,000,000 micros) when no override exists', () => {
      expect(DEFAULT_MONTHLY_AI_BUDGET_USD).toBe(10);

      const allowed = evaluateMarketingEntitlement({
        accountId,
        key: 'ai.monthly_budget_micros',
        used: 9_500_000,
        requested: 500_000,
      });
      expect(allowed).toEqual({
        allowed: true,
        accountId,
        orgId: accountId,
        key: 'ai.monthly_budget_micros',
        limit: 10_000_000,
        used: 9_500_000,
        remaining: 500_000,
        source: 'local_db',
      });

      const denied = evaluateMarketingEntitlement({
        accountId,
        key: 'ai.monthly_budget_micros',
        used: 9_500_000,
        requested: 600_000,
      });
      expect(denied).toEqual({
        allowed: false,
        accountId,
        orgId: accountId,
        key: 'ai.monthly_budget_micros',
        limit: 10_000_000,
        used: 9_500_000,
        remaining: 500_000,
        reason: 'budget_exceeded',
        source: 'local_db',
      });
    });

    it('honors org_entitlements overrides for daily AI calls and web fetches', () => {
      const entitlement = {
        orgId: accountId,
        aiMonthlyBudgetMicros: 25_000_000,
        aiDailyCalls: 250,
        webFetchDaily: 50,
      };

      const dailyCheck = evaluateMarketingEntitlement({
        accountId,
        key: 'ai.daily_calls',
        used: 250,
        requested: 1,
        entitlement,
      });
      expect(dailyCheck.allowed).toBe(false);
      expect(dailyCheck.limit).toBe(250);
      expect(dailyCheck.remaining).toBe(0);
      expect(dailyCheck.reason).toBe('limit_exceeded');

      const fetchCheck = evaluateMarketingEntitlement({
        accountId,
        key: 'web_fetch.daily',
        used: 49,
        requested: 1,
        entitlement,
      });
      expect(fetchCheck.allowed).toBe(true);
      expect(fetchCheck.limit).toBe(50);
      expect(fetchCheck.remaining).toBe(1);
    });

    it('treats null limits as unlimited (Suite decide() convention) and enforces seat/page caps when set', () => {
      const unlimitedSeats = evaluateMarketingEntitlement({
        accountId,
        key: 'marketing.seats',
        used: 15,
        requested: 1,
      });
      expect(unlimitedSeats).toEqual({
        allowed: true,
        accountId,
        orgId: accountId,
        key: 'marketing.seats',
        limit: null,
        used: 15,
        remaining: null,
        source: 'local_db',
      });

      const cappedSeats = evaluateMarketingEntitlement({
        accountId,
        key: 'marketing.seats',
        used: 5,
        requested: 1,
        entitlement: { orgId: accountId, seats: 5 },
        source: 'suite_api',
      });
      expect(cappedSeats).toEqual({
        allowed: false,
        accountId,
        orgId: accountId,
        key: 'marketing.seats',
        limit: 5,
        used: 5,
        remaining: 0,
        reason: 'no_seat',
        source: 'suite_api',
      });

      const cappedPages = evaluateMarketingEntitlement({
        accountId,
        key: 'social.connected_pages',
        used: 3,
        requested: 1,
        entitlement: { orgId: accountId, connectedSocialPages: 3 },
        source: 'suite_api',
      });
      expect(cappedPages.allowed).toBe(false);
      expect(cappedPages.reason).toBe('limit_exceeded');
    });
  });
});
