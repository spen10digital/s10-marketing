import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbTx } from '../../db/client';
import { rowsOf } from '../../db/rows';
import { organizationMembers, organizations, type OrgRole } from '../../db/schema';
import { AppError } from '../../errors/app-error';
import { isValidTimeZone, slugify } from '../slug';

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  role: OrgRole;
}

export const timeZoneSchema = z.string().trim().max(64).refine(isValidTimeZone, 'Unknown time zone');

export const createOrganizationInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  timezone: timeZoneSchema,
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationInput>;

/** Organizations the current user belongs to, with their role (RLS limits rows to memberships). */
export async function listMyOrganizations(tx: DbTx, userId: string): Promise<OrgSummary[]> {
  return tx
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      timezone: organizations.timezone,
      role: organizationMembers.role,
    })
    .from(organizations)
    .innerJoin(organizationMembers, eq(organizationMembers.orgId, organizations.id))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(asc(organizations.name));
}

export async function getMembershipRole(tx: DbTx, userId: string, orgId: string): Promise<OrgRole | null> {
  const [row] = await tx
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)));
  return row?.role ?? null;
}

/** Any signed-in user may create an organization; they become its owner. */
export async function createOrganization(tx: DbTx, input: CreateOrganizationInput): Promise<string> {
  const { name, timezone } = createOrganizationInput.parse(input);
  const result = await tx.execute(
    sql`select app.create_organization(${name}, ${slugify(name)}, ${timezone}) as id`,
  );
  const id = rowsOf<{ id: string | null }>(result)[0]?.id;
  if (!id) throw new AppError('INTERNAL', 'The organization could not be created.');
  return id;
}
