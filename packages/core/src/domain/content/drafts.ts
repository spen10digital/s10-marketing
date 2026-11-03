import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbTx } from '../../db/client';
import { aiGenerations, contentItems, postRevisions, posts } from '../../db/schema';
import { AppError } from '../../errors/app-error';
import { checkFacebookPost } from '../../ai/validate';
import type { OrgActor } from '../brands/service';
import { assertCan } from '../permissions';

export type Post = typeof posts.$inferSelect;

export const postDraftInput = z.object({
  brandId: z.uuid(),
  body: z.string().trim().min(1, 'The post is empty').max(63_206),
  linkUrl: z
    .url({ protocol: /^https?$/, message: 'Enter a full http(s) URL' })
    .max(2048)
    .nullish()
    .or(z.literal('').transform(() => null)),
  brief: z.string().trim().max(4000).nullish(),
  aiGenerationId: z.uuid().nullish(),
});
export type PostDraftInput = z.input<typeof postDraftInput>;

/**
 * Saves a new draft (unassigned: `target_id` stays null until a Page is chosen, ADR 0018) with
 * its first revision. Facebook's hard limits are enforced here; warnings are the UI's job.
 */
export async function createPostDraft(tx: DbTx, actor: OrgActor, input: PostDraftInput): Promise<Post> {
  assertCan(actor.role, 'post.draft.write');
  const data = postDraftInput.parse(input);
  const blocking = checkFacebookPost(data.body, { linkUrl: data.linkUrl }).find((c) => c.level === 'error');
  if (blocking) throw new AppError('BAD_REQUEST', blocking.message);

  if (data.aiGenerationId) {
    // Only link a generation from this org and brand (RLS hides other orgs; the brand check is ours).
    const [generation] = await tx
      .select({ brandId: aiGenerations.brandId })
      .from(aiGenerations)
      .where(and(eq(aiGenerations.orgId, actor.orgId), eq(aiGenerations.id, data.aiGenerationId)));
    if (generation?.brandId !== data.brandId) throw new AppError('BAD_REQUEST', 'Unknown AI generation.');
  }

  let contentItemId: string | null = null;
  if (data.brief) {
    const [item] = await tx
      .insert(contentItems)
      .values({
        orgId: actor.orgId,
        brandId: data.brandId,
        kind: 'post',
        brief: data.brief,
        createdBy: actor.userId,
      })
      .returning({ id: contentItems.id });
    contentItemId = item?.id ?? null;
  }
  const [post] = await tx
    .insert(posts)
    .values({
      orgId: actor.orgId,
      brandId: data.brandId,
      contentItemId,
      body: data.body,
      linkUrl: data.linkUrl ?? null,
      aiGenerationId: data.aiGenerationId ?? null,
      createdBy: actor.userId,
    })
    .returning();
  if (!post) throw new AppError('INTERNAL', 'The draft could not be saved.');
  await tx.insert(postRevisions).values({
    orgId: actor.orgId,
    postId: post.id,
    version: post.version,
    body: post.body,
    linkUrl: post.linkUrl,
    createdBy: actor.userId,
  });
  return post;
}

export async function listRecentPosts(tx: DbTx, orgId: string, brandId: string, limit = 20) {
  return tx
    .select({
      id: posts.id,
      status: posts.status,
      body: posts.body,
      linkUrl: posts.linkUrl,
      aiGenerationId: posts.aiGenerationId,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .where(and(eq(posts.orgId, orgId), eq(posts.brandId, brandId)))
    .orderBy(desc(posts.updatedAt))
    .limit(limit);
}
