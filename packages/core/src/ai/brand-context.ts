import { and, desc, eq } from 'drizzle-orm';
import type { DbTx } from '../db/client';
import { brands, posts } from '../db/schema';
import { getCurrentVoice } from '../domain/brands/voice';
import { AppError } from '../errors/app-error';
import { untrusted } from './prompts/common';
import type { PromptBlock } from './types';

/** What the prompts know about a brand. */
export interface BrandContext {
  name: string;
  description: string | null;
  websiteUrl: string | null;
  voice: VoiceForPrompt | null;
  /** Most recent drafts/posts, newest first, for anti-repetition. */
  recentPosts: string[];
}

export interface VoiceForPrompt {
  audience: string;
  tone: string;
  guidelines: string;
  doList: string[];
  dontList: string[];
  examplePosts: string[];
  ctaDefaults: string[];
}

const RECENT_POSTS = 8;
const RECENT_POST_CHARS = 400;

/** BrandContextBuilder (02 §5): brand, current voice and recent posts, read under RLS. */
export async function loadBrandContext(tx: DbTx, orgId: string, brandId: string): Promise<BrandContext> {
  const [brand] = await tx
    .select()
    .from(brands)
    .where(and(eq(brands.orgId, orgId), eq(brands.id, brandId)));
  if (!brand) throw new AppError('NOT_FOUND', 'Brand not found.');
  const voice = await getCurrentVoice(tx, orgId, brandId);
  const recent = await tx
    .select({ body: posts.body })
    .from(posts)
    .where(and(eq(posts.orgId, orgId), eq(posts.brandId, brandId)))
    .orderBy(desc(posts.updatedAt))
    .limit(RECENT_POSTS);
  return {
    name: brand.name,
    description: brand.description,
    websiteUrl: brand.websiteUrl,
    voice: voice && {
      audience: voice.audience,
      tone: voice.tone,
      guidelines: voice.guidelines,
      doList: voice.doList,
      dontList: voice.dontList,
      examplePosts: voice.examplePosts,
      ctaDefaults: voice.ctaDefaults,
    },
    recentPosts: recent.map((r) => r.body.slice(0, RECENT_POST_CHARS)).filter((b) => b.trim() !== ''),
  };
}

/**
 * The brand block: stable for a brand and voice version, so it ends with a cache point. The voice
 * is written by the brand's own members but still goes in as delimited data.
 */
export function brandBlock(
  context: Pick<BrandContext, 'name' | 'description' | 'websiteUrl' | 'voice'>,
): PromptBlock {
  const lines = [`Brand: ${context.name}`];
  if (context.description) lines.push(`About the brand: ${context.description}`);
  if (context.websiteUrl) lines.push(`Website: ${context.websiteUrl}`);
  lines.push('', 'Brand voice:', untrusted('brand_voice', renderVoice(context.voice)));
  return { text: lines.join('\n'), cache: true };
}

export function renderVoice(voice: VoiceForPrompt | null): string {
  if (!voice) return '(No voice profile yet. Write in a clear, friendly, professional voice.)';
  const list = (title: string, items: string[]) =>
    items.length ? `${title}:\n${items.map((i) => `- ${i}`).join('\n')}` : '';
  return [
    voice.audience && `Audience: ${voice.audience}`,
    voice.tone && `Tone: ${voice.tone}`,
    voice.guidelines && `Guidelines: ${voice.guidelines}`,
    list('Do', voice.doList),
    list("Don't", voice.dontList),
    list('Calls to action we use', voice.ctaDefaults),
    voice.examplePosts.length
      ? `Example posts:\n${voice.examplePosts.map((p, i) => `[${i + 1}]\n${p}`).join('\n\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Recent posts change often, so they go after the cache point. */
export function recentPostsBlock(recentPosts: string[]): PromptBlock | null {
  if (recentPosts.length === 0) return null;
  return {
    text: `Recent posts for this brand. Don't repeat their openings, angles or phrasing:\n${untrusted(
      'recent_posts',
      recentPosts.map((p, i) => `[${i + 1}] ${p}`).join('\n\n'),
    )}`,
  };
}
