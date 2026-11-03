import type { z } from 'zod';

/** Every AI task the app runs; each has one versioned prompt template (prompts/). */
export const AI_TASKS = [
  'generate_post_variants',
  'rewrite',
  'summarize_article',
  'campaign_concepts',
  'voice_draft',
  'voice_tune',
  'voice_samples',
] as const;
export type AiTask = (typeof AI_TASKS)[number];

/** `generate` = Claude Sonnet 5.5, `fast` = Claude Haiku 5.5 (model IDs in Parameter Store). */
export type ModelTier = 'generate' | 'fast';
export type Effort = 'low' | 'medium' | 'high';

/** A piece of prompt text. `cache: true` puts a prompt-cache point after it. */
export interface PromptBlock {
  text: string;
  cache?: boolean;
}

/** A fully rendered prompt plus everything needed to validate and record its result. */
export interface BuiltPrompt<T> {
  task: AiTask;
  templateId: string;
  templateVersion: number;
  tier: ModelTier;
  system: PromptBlock[];
  user: PromptBlock[];
  /** Strict schema for the final output (lengths, counts). */
  schema: z.ZodType<T>;
  /** Name sent with the JSON schema to the model. */
  schemaName: string;
  maxTokens: number;
  effort: Effort;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const NO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export interface ProviderRequest {
  modelId: string;
  system: PromptBlock[];
  user: PromptBlock[];
  maxTokens: number;
  effort: Effort;
  /** JSON schema the model's text output must follow (structured output). */
  jsonSchema: { name: string; schema: Record<string, unknown> };
}

export type ProviderEvent =
  { type: 'text'; text: string } | { type: 'usage'; usage: TokenUsage } | { type: 'stop'; reason: string };

/** A model backend. It only produces text: the model never gets tools (02 §5). */
export interface AiProvider {
  readonly name: string;
  stream(request: ProviderRequest, signal?: AbortSignal): AsyncIterable<ProviderEvent>;
}
