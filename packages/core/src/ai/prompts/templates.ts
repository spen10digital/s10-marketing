import { z } from 'zod';
import { brandVoiceInput } from '../../domain/brands/voice-input';
import {
  brandBlock,
  recentPostsBlock,
  renderVoice,
  type BrandContext,
  type VoiceForPrompt,
} from '../brand-context';
import {
  articleSummaryOutput,
  campaignConceptsOutput,
  postVariantsOutput,
  rewriteOutput,
  voiceDraftOutput,
  voiceSamplesOutput,
  voiceTuneOutput,
} from '../schemas';
import type { BuiltPrompt, PromptBlock } from '../types';
import { BASE_RULES, untrusted } from './common';

/**
 * Versioned prompt templates (02 §5). Each builder returns the whole prompt; the gateway adds
 * nothing to it. Bump `version` whenever the text or schema changes.
 */

const httpUrl = z.url({ protocol: /^https?$/, message: 'Enter a full http(s) URL' }).max(2048);

/** Text the server fetched (article or website page). */
export interface FetchedPage {
  url: string;
  title: string | null;
  text: string;
}

function system(context: Pick<BrandContext, 'name' | 'description' | 'websiteUrl' | 'voice'>): PromptBlock[] {
  return [{ text: BASE_RULES }, brandBlock(context)];
}

function pageBlock(label: string, page: FetchedPage): string {
  return untrusted(label, `URL: ${page.url}\nTitle: ${page.title ?? '(none)'}\n\n${page.text}`);
}

// ---------------------------------------------------------------------------------------------
// generate_post_variants
// ---------------------------------------------------------------------------------------------

export const generateVariantsInput = z.object({
  brief: z.string().trim().min(1, 'Describe what the post is about').max(4000),
  linkUrl: httpUrl.nullish().or(z.literal('').transform(() => null)),
  count: z.coerce.number().int().min(1).max(5).default(3),
});
export type GenerateVariantsInput = z.input<typeof generateVariantsInput>;

export function generatePostVariantsPrompt(
  context: BrandContext,
  rawInput: GenerateVariantsInput,
  article?: FetchedPage,
): BuiltPrompt<z.output<typeof postVariantsOutput>> {
  const input = generateVariantsInput.parse(rawInput);
  const user: PromptBlock[] = [];
  const recent = recentPostsBlock(context.recentPosts);
  if (recent) user.push(recent);
  user.push({
    text: [
      `Write ${input.count} different Facebook Page post${input.count === 1 ? '' : 's'} for this brand.`,
      'Each variant takes a different angle and opening. For each one give: the full post text, its hook (first line), its call to action, up to 5 hashtags (none is fine), and a few words naming the angle.',
      input.linkUrl
        ? `The post will be published with this link attached: ${input.linkUrl}. Don't paste other URLs.`
        : 'No link will be attached.',
      article ? 'Base the posts on the article below; only use facts it states.' : '',
      'Brief from the team:',
      untrusted('brief', input.brief),
      article ? pageBlock('article', article) : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
  return {
    task: 'generate_post_variants',
    templateId: 'generate_post_variants',
    templateVersion: 1,
    tier: 'generate',
    system: system(context),
    user,
    schema: postVariantsOutput,
    schemaName: 'post_variants',
    maxTokens: 12_000,
    effort: 'medium',
  };
}

// ---------------------------------------------------------------------------------------------
// rewrite (Studio transforms)
// ---------------------------------------------------------------------------------------------

export const TRANSFORM_OPS = ['shorten', 'expand', 'tone', 'adapt'] as const;
export const transformInput = z.object({
  text: z.string().trim().min(1, 'Nothing to rewrite').max(63_206),
  op: z.enum(TRANSFORM_OPS),
  tone: z.string().trim().max(100).optional(),
});
export type TransformInput = z.input<typeof transformInput>;

const OP_INSTRUCTIONS: Record<(typeof TRANSFORM_OPS)[number], (tone?: string) => string> = {
  shorten: () => 'Make this post noticeably shorter (about half) while keeping its point and call to action.',
  expand: () => 'Expand this post with a little more detail or context, without inventing facts.',
  tone: (tone) => `Rewrite this post in a ${tone || 'different'} tone, still within the brand voice.`,
  adapt: () =>
    'Adapt this text into a Facebook Page post: a strong first line, short paragraphs, a clear call to action.',
};

export function rewritePrompt(
  context: BrandContext,
  rawInput: TransformInput,
): BuiltPrompt<z.output<typeof rewriteOutput>> {
  const input = transformInput.parse(rawInput);
  return {
    task: 'rewrite',
    templateId: 'rewrite',
    templateVersion: 1,
    tier: 'fast',
    system: system(context),
    user: [{ text: `${OP_INSTRUCTIONS[input.op](input.tone)}\n\n${untrusted('post', input.text)}` }],
    schema: rewriteOutput,
    schemaName: 'rewrite',
    maxTokens: 6_000,
    effort: 'low',
  };
}

// ---------------------------------------------------------------------------------------------
// summarize_article
// ---------------------------------------------------------------------------------------------

export const summarizeArticleInput = z.object({ url: httpUrl });

export function summarizeArticlePrompt(
  context: BrandContext,
  article: FetchedPage,
): BuiltPrompt<z.output<typeof articleSummaryOutput>> {
  return {
    task: 'summarize_article',
    templateId: 'summarize_article',
    templateVersion: 1,
    tier: 'fast',
    system: system(context),
    user: [
      {
        text: `Summarize this article for the brand's social media team in a short paragraph, then list up to 6 key points. Only use what the article says.\n\n${pageBlock('article', article)}`,
      },
    ],
    schema: articleSummaryOutput,
    schemaName: 'article_summary',
    maxTokens: 6_000,
    effort: 'low',
  };
}

// ---------------------------------------------------------------------------------------------
// campaign_concepts
// ---------------------------------------------------------------------------------------------

export const campaignConceptsInput = z.object({
  goal: z.string().trim().min(1, 'Describe the campaign goal').max(2000),
  count: z.coerce.number().int().min(1).max(5).default(3),
});
export type CampaignConceptsInput = z.input<typeof campaignConceptsInput>;

export function campaignConceptsPrompt(
  context: BrandContext,
  rawInput: CampaignConceptsInput,
): BuiltPrompt<z.output<typeof campaignConceptsOutput>> {
  const input = campaignConceptsInput.parse(rawInput);
  const user: PromptBlock[] = [];
  const recent = recentPostsBlock(context.recentPosts);
  if (recent) user.push(recent);
  user.push({
    text: `Propose ${input.count} distinct campaign concepts for this brand's Facebook Page. For each: a short name, a summary of the idea, one sample post, and why it fits the brand.\n\nCampaign goal from the team:\n${untrusted('goal', input.goal)}`,
  });
  return {
    task: 'campaign_concepts',
    templateId: 'campaign_concepts',
    templateVersion: 1,
    tier: 'generate',
    system: system(context),
    user,
    schema: campaignConceptsOutput,
    schemaName: 'campaign_concepts',
    maxTokens: 12_000,
    effort: 'medium',
  };
}

// ---------------------------------------------------------------------------------------------
// Brand Voice assistant
// ---------------------------------------------------------------------------------------------

const VOICE_FIELDS_HELP = `Voice profile fields:
- audience: who the brand writes for (max 1000 characters)
- tone: how it sounds, in a few words or a sentence (max 500)
- guidelines: concrete writing guidance (max 4000)
- doList / dontList: short, specific rules (up to 20 each, max 300 characters each)
- examplePosts: example posts in this voice (up to 10)
- ctaDefaults: calls to action the brand uses (up to 10)`;

export const guidedAnswersInput = z.object({
  audience: z.string().trim().max(1000).default(''),
  sound: z.string().trim().max(1000).default(''),
  avoid: z.string().trim().max(1000).default(''),
  examples: z.string().trim().max(6000).default(''),
});
export type GuidedAnswers = z.input<typeof guidedAnswersInput>;

/** Brand facts only: a voice draft must not be steered by the profile it replaces. */
type BrandFacts = Pick<BrandContext, 'name' | 'description' | 'websiteUrl'>;

export function voiceDraftFromWebsitePrompt(
  brand: BrandFacts,
  pages: FetchedPage[],
): BuiltPrompt<z.output<typeof voiceDraftOutput>> {
  return voiceDraftPrompt(
    brand,
    `Draft a complete voice profile for this brand from its website below. Infer the audience and tone from how the site is written. Example posts should be new posts in that voice, not copied text.\n\n${pages
      .map((p, i) => pageBlock(i === 0 ? 'website_home' : 'website_page', p))
      .join('\n\n')}`,
  );
}

export function voiceDraftFromAnswersPrompt(
  brand: BrandFacts,
  rawAnswers: GuidedAnswers,
): BuiltPrompt<z.output<typeof voiceDraftOutput>> {
  const a = guidedAnswersInput.parse(rawAnswers);
  return voiceDraftPrompt(
    brand,
    `Draft a complete voice profile for this brand from the team's answers below. Fill gaps sensibly; keep rules specific.\n\n${untrusted(
      'answers',
      `Who it's for: ${a.audience || '(not answered)'}\nHow it should sound: ${a.sound || '(not answered)'}\nWords or topics to avoid: ${a.avoid || '(not answered)'}\nExample posts they like:\n${a.examples || '(none)'}`,
    )}`,
  );
}

function voiceDraftPrompt(
  brand: BrandFacts,
  instructions: string,
): BuiltPrompt<z.output<typeof voiceDraftOutput>> {
  return {
    task: 'voice_draft',
    templateId: 'voice_draft',
    templateVersion: 1,
    tier: 'generate',
    system: system({ ...brand, voice: null }),
    user: [{ text: `${VOICE_FIELDS_HELP}\n\n${instructions}` }],
    schema: voiceDraftOutput,
    schemaName: 'voice_profile',
    maxTokens: 8_000,
    effort: 'medium',
  };
}

export const voiceProposalInput = brandVoiceInput;

export function voiceTunePrompt(
  brand: BrandFacts,
  rawVoice: z.input<typeof brandVoiceInput>,
): BuiltPrompt<z.output<typeof voiceTuneOutput>> {
  const voice: VoiceForPrompt = brandVoiceInput.parse(rawVoice);
  return {
    task: 'voice_tune',
    templateId: 'voice_tune',
    templateVersion: 1,
    tier: 'generate',
    system: system({ ...brand, voice: null }),
    user: [
      {
        text: `${VOICE_FIELDS_HELP}\n\nReview the voice profile below and suggest up to 10 specific improvements: vague rules made concrete, gaps filled, contradictions resolved. Use "replace" for audience, tone or guidelines (value = the full new text), "add" to add one list item, "remove" to drop one list item (value = the exact existing item). Give a short reason for each. Suggest nothing if it is already good.\n\n${untrusted('voice_profile', renderVoice(voice))}`,
      },
    ],
    schema: voiceTuneOutput,
    schemaName: 'voice_suggestions',
    maxTokens: 6_000,
    effort: 'medium',
  };
}

export const voiceSamplesInput = z.object({
  voice: brandVoiceInput,
  topic: z.string().trim().max(500).optional(),
});

export function voiceSamplesPrompt(
  brand: BrandFacts,
  rawInput: z.input<typeof voiceSamplesInput>,
): BuiltPrompt<z.output<typeof voiceSamplesOutput>> {
  const input = voiceSamplesInput.parse(rawInput);
  return {
    task: 'voice_samples',
    templateId: 'voice_samples',
    templateVersion: 1,
    tier: 'fast',
    // The voice being tried goes in the cached brand block, exactly as real posts would see it.
    system: system({ ...brand, voice: input.voice }),
    user: [
      {
        text: `Write 3 short sample Facebook posts that show off this voice, each with a different angle.${
          input.topic ? `\n\nTopic:\n${untrusted('topic', input.topic)}` : ''
        }`,
      },
    ],
    schema: voiceSamplesOutput,
    schemaName: 'voice_samples',
    maxTokens: 6_000,
    effort: 'low',
  };
}
