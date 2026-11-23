import type { SuiteEntitlements } from './client';

/**
 * The entitlement decision every S10 app makes server-side (integration contract item 3), the
 * same semantics as `s10-app-template`'s `decide()`. Pure, so it is unit tested. The Suite says
 * what an account may use; the app enforces it.
 */
export type Decision =
  | { allowed: true; limit?: number | null }
  | {
      allowed: false;
      reason:
        | 'suite-unavailable'
        | 'not-in-plan'
        | 'no-seat'
        | 'view-only'
        | 'over-limit'
        | 'no-business'
        | 'needs-business';
      limit?: number;
    };

export type DenialReason = Exclude<Decision, { allowed: true }>['reason'];

export interface DecideOptions {
  limitKey?: string;
  amount?: number;
  businessId?: string;
  /** The feature stores data, so the person must be working in a business. */
  requireBusiness?: boolean;
  /** The feature creates or changes something. Viewers can only view. */
  write?: boolean;
}

/**
 * May this account use this app (and, optionally, this much of one of the app's limits)?
 * `null` entitlements mean the Suite could not be reached: fail closed. A limit key the plan
 * does not set means the feature is not included. A `null` limit means no limit.
 */
export function decide(ent: SuiteEntitlements | null, appId: string, opts: DecideOptions = {}): Decision {
  if (!ent) return { allowed: false, reason: 'suite-unavailable' };
  if (ent.status !== 'active' || !ent.apps.includes(appId)) return { allowed: false, reason: 'not-in-plan' };
  // The account has the app, but this person needs a seat in it.
  if (Array.isArray(ent.member_apps) && !ent.member_apps.includes(appId)) {
    return { allowed: false, reason: 'no-seat' };
  }
  // A Viewer may look, never change. A null role is the app's own server, with no person to limit.
  if (opts.write && ent.role === 'viewer') return { allowed: false, reason: 'view-only' };
  // An account can have no business yet. Records need a business.
  if (opts.requireBusiness && !opts.businessId) return { allowed: false, reason: 'needs-business' };
  if (opts.businessId && !ent.business_ids.includes(opts.businessId)) {
    return { allowed: false, reason: 'no-business' };
  }
  if (opts.limitKey) {
    const limit = ent.limits[opts.limitKey];
    if (limit === undefined) return { allowed: false, reason: 'not-in-plan' };
    if (limit !== null && (opts.amount ?? 1) > limit) return { allowed: false, reason: 'over-limit', limit };
    return { allowed: true, limit };
  }
  return { allowed: true };
}

export const DECISION_MESSAGES: Record<DenialReason, string> = {
  'suite-unavailable':
    'We can’t check your plan right now, so S10/Marketing is paused. Please try again shortly.',
  'not-in-plan': 'S10/Marketing isn’t included in your plan.',
  'no-seat': 'You don’t have a seat in S10/Marketing. Ask your account owner or an admin for one.',
  'view-only': 'You can view this, but your role doesn’t allow changes. Ask your account owner or an admin.',
  'over-limit': 'That’s more than your plan allows.',
  'no-business': 'You don’t have access to that business.',
  'needs-business': 'Add a business in S10/Suite to get started.',
};
