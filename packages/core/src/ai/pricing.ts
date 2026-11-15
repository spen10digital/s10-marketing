import { AppError } from '../errors/app-error';
import type { TokenUsage } from './types';

/**
 * Prices in USD per million tokens, which is the same number as micro-USD per token. These are
 * Anthropic's list prices (cache writes = 1.25 × input for the 5-minute cache). Bedrock bills its
 * own on-demand rates: check https://aws.amazon.com/bedrock/pricing/ before changing a model and
 * update this table. An unknown model is refused so spend can never go unmetered.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICES: { match: RegExp; price: ModelPrice }[] = [
  { match: /claude-sonnet-5-5/, price: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
  // Haiku 5.5 doubles in price above 100K-token prompts; our prompts stay far below that.
  { match: /claude-haiku-5-5/, price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } },
];

export function priceFor(modelId: string): ModelPrice {
  const entry = PRICES.find((p) => p.match.test(modelId));
  if (!entry) throw new AppError('CONFIG_INVALID', `No price configured for model ${modelId}`);
  return entry.price;
}

/** Cost in micro-USD, rounded up. Bedrock reports input tokens excluding cache reads/writes. */
export function costMicros(modelId: string, usage: TokenUsage): number {
  const p = priceFor(modelId);
  return Math.ceil(
    usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite,
  );
}

/** Rough token count for budget reservations (~3 characters per token errs on the high side). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Worst case for a call: every prompt token written to cache and the full output budget used. */
export function reservationMicros(modelId: string, promptChars: number, maxTokens: number): number {
  const p = priceFor(modelId);
  return Math.ceil(Math.ceil(promptChars / 3) * p.cacheWrite + maxTokens * p.output);
}

export const microsToUsd = (micros: number) => micros / 1_000_000;
export const usdToMicros = (usd: number) => Math.round(usd * 1_000_000);
