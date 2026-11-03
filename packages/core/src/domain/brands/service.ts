import { and, asc, eq, isNull, like, or } from 'drizzle-orm';
import { z } from 'zod';
import type { DbTx } from '../../db/client';
import { pgErrorCode, PG_UNIQUE_VIOLATION } from '../../db/rows';
import { brands, type OrgRole } from '../../db/schema';
import { AppError } from '../../errors/app-error';
import { timeZoneSchema } from '../orgs/service';
import { assertCan } from '../permissions';
import { SLUG_PATTERN, slugify } from '../slug';

export type Brand = typeof brands.$inferSelect;

/** The caller as the domain sees them: their user id and role in the brand's organization. */
export interface OrgActor {
  userId: string;
  orgId: string;
  role: OrgRole | null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();

export const brandInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(64)
    .regex(SLUG_PATTERN, 'Use lowercase letters, numbers and single hyphens')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  description: optionalText(2000),
  websiteUrl: z
    .url({ protocol: /^https?$/, message: 'Enter a full http(s) URL' })
    .max(2048)
    .nullish()
    .or(z.literal('').transform(() => null)),
  timezone: timeZoneSchema.nullish().or(z.literal('').transform(() => null)),
});
export type BrandInput = z.input<typeof brandInput>;

export async function listBrands(tx: DbTx, orgId: string, options: { includeArchived?: boolean } = {}) {
  return tx
    .select()
    .from(brands)
    .where(and(eq(brands.orgId, orgId), options.includeArchived ? undefined : isNull(brands.archivedAt)))
    .orderBy(asc(brands.name));
}

export async function getBrandBySlug(tx: DbTx, orgId: string, slug: string): Promise<Brand | null> {
  const [row] = await tx
    .select()
    .from(brands)
    .where(and(eq(brands.orgId, orgId), eq(brands.slug, slug)));
  return row ?? null;
}

export async function createBrand(tx: DbTx, actor: OrgActor, input: BrandInput): Promise<Brand> {
  assertCan(actor.role, 'brand.create');
  const data = brandInput.parse(input);
  const slug = data.slug ?? (await nextFreeSlug(tx, actor.orgId, slugify(data.name)));
  try {
    const [row] = await tx
      .insert(brands)
      .values({
        orgId: actor.orgId,
        name: data.name,
        slug,
        description: data.description ?? null,
        websiteUrl: data.websiteUrl ?? null,
        timezone: data.timezone ?? null,
        createdBy: actor.userId,
      })
      .returning();
    if (!row) throw new AppError('INTERNAL', 'The brand could not be created.');
    return row;
  } catch (err) {
    throw conflictOr(err, 'A brand with that URL name already exists in this organization.');
  }
}

export async function updateBrand(
  tx: DbTx,
  actor: OrgActor,
  brandId: string,
  input: BrandInput,
): Promise<Brand> {
  assertCan(actor.role, 'brand.update');
  const data = brandInput.parse(input);
  try {
    const [row] = await tx
      .update(brands)
      .set({
        name: data.name,
        ...(data.slug ? { slug: data.slug } : {}),
        description: data.description ?? null,
        websiteUrl: data.websiteUrl ?? null,
        timezone: data.timezone ?? null,
      })
      .where(and(eq(brands.orgId, actor.orgId), eq(brands.id, brandId)))
      .returning();
    if (!row) throw new AppError('NOT_FOUND', 'Brand not found.');
    return row;
  } catch (err) {
    throw conflictOr(err, 'A brand with that URL name already exists in this organization.');
  }
}

export async function setBrandArchived(tx: DbTx, actor: OrgActor, brandId: string, archived: boolean) {
  assertCan(actor.role, 'brand.update');
  const [row] = await tx
    .update(brands)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(brands.orgId, actor.orgId), eq(brands.id, brandId)))
    .returning();
  if (!row) throw new AppError('NOT_FOUND', 'Brand not found.');
  return row;
}

/** Slugs are unique per organization (visible to members), so a free suffix can be chosen. */
async function nextFreeSlug(tx: DbTx, orgId: string, base: string): Promise<string> {
  const taken = new Set(
    (
      await tx
        .select({ slug: brands.slug })
        .from(brands)
        .where(and(eq(brands.orgId, orgId), or(eq(brands.slug, base), like(brands.slug, `${base}-%`))))
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function conflictOr(err: unknown, message: string): unknown {
  return pgErrorCode(err) === PG_UNIQUE_VIOLATION ? new AppError('CONFLICT', message, { cause: err }) : err;
}
