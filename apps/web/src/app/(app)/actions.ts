'use server';

import { withDbContext } from '@s10/core/db';
import { createBrand, createPostDraft, saveVoice, setBrandArchived, updateBrand } from '@s10/core/domain';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getCognitoSettings } from '@/server/auth/cognito';
import { cookieOptions } from '@/server/auth/cookies';
import { formBlocks, formLines, formString, toActionState, type ActionState } from '@/server/action-state';
import { getDb } from '@/server/db';
import { getOrgContext, requireOrgActor } from '@/server/org-context';

const ORG_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** Organizations are Suite accounts and come from the Suite; the selection here is only a preference. */
export async function switchOrganizationAction(form: FormData): Promise<void> {
  const { orgs } = await getOrgContext();
  const orgId = z.uuid().safeParse(formString(form, 'orgId'));
  if (!orgId.success) return;
  // The org id comes from the form, so it is only accepted if it is one of the person's orgs.
  if (!orgs.some((o) => o.id === orgId.data)) return;
  const settings = await getCognitoSettings();
  (await cookies()).set(
    settings.names.currentOrg,
    orgId.data,
    cookieOptions(settings.secureCookies, ORG_COOKIE_MAX_AGE),
  );
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
    const actor = await requireOrgActor({ write: true });
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
    const actor = await requireOrgActor({ write: true });
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
  const actor = await requireOrgActor({ write: true });
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
    const actor = await requireOrgActor({ write: true });
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

/** Saves a Studio draft (unassigned until a Page is chosen). Called directly, not from a form. */
export async function savePostDraftAction(input: {
  brandId: string;
  brandSlug: string;
  body: string;
  linkUrl?: string | null;
  brief?: string | null;
  aiGenerationId?: string | null;
}): Promise<ActionState & { postId?: string }> {
  try {
    const actor = await requireOrgActor({ write: true });
    const post = await withDbContext(await getDb(), { userId: actor.userId }, (tx) =>
      createPostDraft(tx, actor, {
        brandId: input.brandId,
        body: input.body,
        linkUrl: input.linkUrl,
        brief: input.brief,
        aiGenerationId: input.aiGenerationId,
      }),
    );
    revalidatePath(`/b/${z.string().max(64).parse(input.brandSlug)}/studio`);
    return { status: 'success', message: 'Draft saved.', postId: post.id };
  } catch (err) {
    return toActionState(err);
  }
}
