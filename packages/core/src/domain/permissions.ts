import { AppError } from '../errors/app-error';
import type { OrgRole } from '../db/schema';

/**
 * Domain-level authorization (02 §3.2 layer 2). RLS enforces the same rules in the database;
 * these checks give users a clear error before a query is refused.
 */
export const ACTION_MIN_ROLE = {
  'org.update': 'admin',
  'brand.create': 'admin',
  'brand.update': 'admin',
  'brand.voice.update': 'editor',
  'ai.generate': 'editor',
  'post.draft.write': 'editor',
  'audit.read': 'admin',
  'org.read': 'viewer',
} as const satisfies Record<string, OrgRole>;

export type Action = keyof typeof ACTION_MIN_ROLE;

const rank: Record<OrgRole, number> = { owner: 0, admin: 1, editor: 2, viewer: 3 };

export function can(role: OrgRole | null | undefined, action: Action): boolean {
  if (!role) return false;
  return rank[role] <= rank[ACTION_MIN_ROLE[action]];
}

export function assertCan(role: OrgRole | null | undefined, action: Action): void {
  if (!can(role, action)) throw new AppError('FORBIDDEN', 'You don’t have permission to do that.');
}
