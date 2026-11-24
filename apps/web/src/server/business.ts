import 'server-only';
import { withDbContext } from '@s10/core/db';
import { getBrandById, getBrandBySlug, type Brand } from '@s10/core/domain';
import { getCurrentBusiness, type CurrentBusinessView, type DenialReason } from '@s10/core/suite';
import { notFound, redirect } from 'next/navigation';
import { getDb } from './db';
import { checkMarketingEntitlement } from './entitlement';
import { getOrgContext, requireOrgActor, type ActorOptions } from './org-context';
import { getSuiteClient } from './suite';

export type BrandAccess = { ok: true } | { ok: false; reason: 'hidden' | DenialReason };

/**
 * May this person use this brand? The brand must be linked to a Suite business the Suite lists
 * for them (a brand that is not is hidden, fail closed), and the entitlement check runs for that
 * business (plan, seat, Viewer read-only, business membership).
 */
export async function checkBrandAccess(
  ctx: Awaited<ReturnType<typeof getOrgContext>>,
  brand: Pick<Brand, 'suiteBusinessId'>,
  options: { write?: boolean } = {},
): Promise<BrandAccess> {
  if (!ctx.current) return { ok: false, reason: 'not-in-plan' };
  if (!brand.suiteBusinessId || !ctx.visibleBusinessIds.has(brand.suiteBusinessId)) {
    return { ok: false, reason: 'hidden' };
  }
  const decision = await checkMarketingEntitlement(ctx.session, ctx.current, {
    write: options.write,
    businessId: brand.suiteBusinessId,
    requireBusiness: true,
  });
  return decision.allowed ? { ok: true } : { ok: false, reason: decision.suiteReason ?? 'not-in-plan' };
}

function enforce(access: BrandAccess): void {
  if (access.ok) return;
  if (access.reason === 'hidden') notFound();
  redirect(`/no-access?reason=${access.reason}`);
}

/**
 * A brand (a Suite business) for the signed-in person, by URL name, or 404. The business
 * details (name, website, contact) come from the Suite through `getCurrentBusiness()`; Marketing
 * keeps the brand voice itself.
 */
export async function requireBrand(slug: string, options: Pick<ActorOptions, 'write'> = {}) {
  const actor = await requireOrgActor({ write: options.write });
  const ctx = await getOrgContext();
  const db = await getDb();
  const brand = await withDbContext(db, { userId: actor.userId }, (tx) =>
    getBrandBySlug(tx, actor.orgId, slug),
  );
  if (!brand) notFound();
  enforce(await checkBrandAccess(ctx, brand, options));

  const client = await getSuiteClient();
  const who = { accessToken: actor.session.accessToken, sub: actor.session.subject };
  const business: CurrentBusinessView | null = await withDbContext(db, { userId: actor.userId }, (tx) =>
    getCurrentBusiness({ tx, business: (id) => client.business(who, id) }, actor.orgId, {
      brandId: brand.id,
    }),
  );
  if (!business) notFound();
  return { actor, brand, business };
}

/**
 * For actions that name a brand by id (the id comes from the client, so it is checked like
 * any other input): the brand must be in the person's organization and pass the access check.
 */
export async function requireBrandById(brandId: string, options: Pick<ActorOptions, 'write'> = {}) {
  const actor = await requireOrgActor({ write: options.write });
  const ctx = await getOrgContext();
  const brand = await withDbContext(await getDb(), { userId: actor.userId }, (tx) =>
    getBrandById(tx, actor.orgId, brandId),
  );
  if (!brand) notFound();
  enforce(await checkBrandAccess(ctx, brand, options));
  return { actor, brand };
}
