'use server';

import { withDbContext } from '@s10/core/db';
import {
  createBrand,
  createOrganization,
  listMyOrganizations,
  saveVoice,
  setBrandArchived,
  updateBrand,
} from '@s10/core/domain';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { COOKIES, cookieOptions } from '@/server/auth/cookies';
import { requireSession } from '@/server/auth/session';
import { formBlocks, formLines, formString, toActionState, type ActionState } from '@/server/action-state';
import { getConfig } from '@/server/config';
import { getDb } from '@/server/db';
import { requireOrgActor } from '@/server/org-context';

const ORG_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

async function selectOrg(orgId: string) {
  const secure = (await getConfig()).APP_URL.startsWith('https://');
  (await cookies()).set(COOKIES.currentOrg, orgId, cookieOptions(secure, ORG_COOKIE_MAX_AGE));
}

export async function createOrganizationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let orgId: string;
  try {
    const session = await requireSession('/orgs/new');
    orgId = await withDbContext(await getDb(), { userId: session.userId }, (tx) =>
      createOrganization(tx, { name: formString(form, 'name'), timezone: formString(form, 'timezone') }),
    );
    await selectOrg(orgId);
  } catch (err) {
    return toActionState(err);
  }
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

/** The org id comes from the form, so it is only accepted if the user is a member. */
export async function switchOrganizationAction(form: FormData): Promise<void> {
  const session = await requireSession();
  const orgId = z.uuid().safeParse(formString(form, 'orgId'));
  if (!orgId.success) return;
  const orgs = await withDbContext(await getDb(), { userId: session.userId }, (tx) =>
    listMyOrganizations(tx, session.userId),
  );
  if (!orgs.some((o) => o.id === orgId.data)) return;
  await selectOrg(orgId.data);
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

function brandFields(form: FormData) {
  return {
    name: formString(form, 'name'),
    slug: formString(form, 'slug'),
    description: formString(form, 'description'),
    websiteUrl: formString(form, 'websiteUrl'),
    timezone: formString(form, 'timezone'),
  };
}

export async function createBrandAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let slug: string;
  try {
    const actor = await requireOrgActor();
    const brand = await withDbContext(await getDb(), { userId: actor.userId }, (tx) =>
      createBrand(tx, actor, brandFields(form)),
    );
    slug = brand.slug;
  } catch (err) {
    return toActionState(err);
  }
  revalidatePath('/dashboard');
  redirect(`/b/${slug}`);
}

export async function updateBrandAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let slug: string;
  try {
    const actor = await requireOrgActor();
    const brandId = z.uuid().parse(formString(form, 'brandId'));
    const brand = await withDbContext(await getDb(), { userId: actor.userId }, (tx) =>
      updateBrand(tx, actor, brandId, brandFields(form)),
    );
    slug = brand.slug;
  } catch (err) {
    return toActionState(err);
  }
  revalidatePath('/dashboard');
  revalidatePath(`/b/${slug}`);
  // The URL name may have changed.
  redirect(`/b/${slug}?saved=brand`);
}

export async function setBrandArchivedAction(form: FormData): Promise<void> {
  const actor = await requireOrgActor();
  const brandId = z.uuid().parse(formString(form, 'brandId'));
  const archived = formString(form, 'archived') === 'true';
  const brand = await withDbContext(await getDb(), { userId: actor.userId }, (tx) =>
    setBrandArchived(tx, actor, brandId, archived),
  );
  revalidatePath('/dashboard');
  revalidatePath(`/b/${brand.slug}`);
}

export async function saveVoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let slug: string;
  try {
    const actor = await requireOrgActor();
    const brandId = z.uuid().parse(formString(form, 'brandId'));
    const expectedVersion = z.coerce.number().int().min(0).parse(formString(form, 'expectedVersion'));
    slug = z.string().parse(formString(form, 'brandSlug'));
    await withDbContext(await getDb(), { userId: actor.userId }, (tx) =>
      saveVoice(
        tx,
        actor,
        brandId,
        {
          audience: formString(form, 'audience'),
          tone: formString(form, 'tone'),
          guidelines: formString(form, 'guidelines'),
          doList: formLines(form, 'doList'),
          dontList: formLines(form, 'dontList'),
          ctaDefaults: formLines(form, 'ctaDefaults'),
          examplePosts: formBlocks(form, 'examplePosts'),
        },
        expectedVersion,
      ),
    );
  } catch (err) {
    return toActionState(err);
  }
  revalidatePath(`/b/${slug}`);
  redirect(`/b/${slug}?saved=voice`);
}
