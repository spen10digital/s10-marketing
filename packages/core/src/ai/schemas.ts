import { z } from 'zod';
import { brandVoiceInput } from '../domain/brands/voice-input';

/**
 * Output schemas (zod for all AI output, 05 §2). The model gets a relaxed JSON-schema version
 * (json-schema.ts); these strict versions decide whether a result is usable.
 */

/** Facebook's hard limit for a Page post's text. */
export const FACEBOOK_MAX_POST_CHARS = 63_206;

const hashtag = z
  .string()
  .trim()
  .regex(/^#?[\p{L}\p{N}_]{1,60}$/u, 'Hashtags are a single word')
  .transform((h) => (h.startsWith('#') ? h : `#${h}`));

export const postVariant = z.object({
  text: z.string().trim().min(1).max(FACEBOOK_MAX_POST_CHARS),
  hook: z.string().trim().max(300),
  cta: z.string().trim().max(300),
  hashtags: z.array(hashtag).max(5),
  angle: z.string().trim().max(200),
});
export type PostVariant = z.output<typeof postVariant>;

export const postVariantsOutput = z.object({ variants: z.array(postVariant).min(1).max(5) });
export type PostVariantsOutput = z.output<typeof postVariantsOutput>;

export const rewriteOutput = z.object({ text: z.string().trim().min(1).max(FACEBOOK_MAX_POST_CHARS) });
export type RewriteOutput = z.output<typeof rewriteOutput>;

export const articleSummaryOutput = z.object({
  summary: z.string().trim().min(1).max(1500),
  keyPoints: z.array(z.string().trim().min(1).max(300)).max(6),
});
export type ArticleSummaryOutput = z.output<typeof articleSummaryOutput>;

export const campaignConceptsOutput = z.object({
  concepts: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        summary: z.string().trim().min(1).max(600),
        samplePost: z.string().trim().min(1).max(3000),
        rationale: z.string().trim().max(600),
      }),
    )
    .min(1)
    .max(5),
});
export type CampaignConceptsOutput = z.output<typeof campaignConceptsOutput>;

/** A drafted voice profile must be saveable as is, so it is checked against the editor's own schema. */
export const voiceDraftOutput = brandVoiceInput;
export type VoiceDraftOutput = z.output<typeof voiceDraftOutput>;

export const VOICE_TEXT_FIELDS = ['audience', 'tone', 'guidelines'] as const;
export const VOICE_LIST_FIELDS = ['doList', 'dontList', 'examplePosts', 'ctaDefaults'] as const;
export type VoiceField = (typeof VOICE_TEXT_FIELDS)[number] | (typeof VOICE_LIST_FIELDS)[number];

export const voiceSuggestion = z.object({
  field: z.enum([...VOICE_TEXT_FIELDS, ...VOICE_LIST_FIELDS]),
  /** `replace` sets a text field; `add`/`remove` change one item of a list field. */
  action: z.enum(['replace', 'add', 'remove']),
  value: z.string().trim().min(1).max(4000),
  reason: z.string().trim().min(1).max(500),
});
export type VoiceSuggestion = z.output<typeof voiceSuggestion>;

export const voiceTuneOutput = z.object({ suggestions: z.array(voiceSuggestion).max(10) });
export type VoiceTuneOutput = z.output<typeof voiceTuneOutput>;

export const voiceSamplesOutput = z.object({
  samples: z
    .array(z.object({ text: z.string().trim().min(1).max(3000), angle: z.string().trim().max(200) }))
    .min(1)
    .max(3),
});
export type VoiceSamplesOutput = z.output<typeof voiceSamplesOutput>;
