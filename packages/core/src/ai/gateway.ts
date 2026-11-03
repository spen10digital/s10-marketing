import type { Database } from '../db/client';
import { withDbContext } from '../db/context';
import type { OrgActor } from '../domain/brands/service';
import { AppError } from '../errors/app-error';
import type { Logger } from '../logging/logger';
import {
  finishGeneration,
  reserveGeneration,
  type AiLimits,
  type FinishParams,
  type ReserveParams,
} from './budget';
import { modelJsonSchema } from './json-schema';
import { noopMetrics, type AiMetricsSink } from './metrics';
import { costMicros, reservationMicros } from './pricing';
import type { ModelRouter } from './router';
import { NO_USAGE, type AiProvider, type BuiltPrompt, type TokenUsage } from './types';

/** Where generations are reserved and recorded (the database, or a fake in unit tests). */
export interface GenerationLedger {
  reserve(actor: OrgActor, params: ReserveParams): Promise<string>;
  finish(actor: OrgActor, generationId: string, result: FinishParams): Promise<void>;
}

/** The real ledger: budget checks and records in Postgres under the user's RLS context. */
export function dbLedger(db: Database, limits: (actor: OrgActor) => Promise<AiLimits>): GenerationLedger {
  return {
    async reserve(actor, params) {
      const orgLimits = await limits(actor);
      return withDbContext(db, { userId: actor.userId }, (tx) =>
        reserveGeneration(tx, actor, orgLimits, params),
      );
    },
    async finish(actor, generationId, result) {
      await withDbContext(db, { userId: actor.userId }, (tx) =>
        finishGeneration(tx, actor, generationId, result),
      );
    },
  };
}

export interface AiGatewayDeps {
  ledger: GenerationLedger;
  provider: AiProvider;
  router: ModelRouter;
  metrics?: AiMetricsSink;
  logger?: Logger;
  now?: () => number;
}

export type GatewayEvent<T> =
  | { type: 'start'; generationId: string; modelId: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; generationId: string; output: T };

export interface GatewayRequest<T> {
  brandId: string;
  prompt: BuiltPrompt<T>;
  /** Website/article the prompt was built from (stored as a short excerpt only). */
  source?: { url: string; excerpt: string };
  signal?: AbortSignal;
}

/**
 * AiGateway (02 §5, ADR 0006): budget check and reservation → streamed model call → strict
 * validation → metering. Every call is recorded in ai_generations, including failures.
 */
export class AiGateway {
  constructor(private readonly deps: AiGatewayDeps) {}

  async *stream<T>(actor: OrgActor, request: GatewayRequest<T>): AsyncGenerator<GatewayEvent<T>> {
    const { ledger, provider, router, logger } = this.deps;
    const metrics = this.deps.metrics ?? noopMetrics;
    const now = this.deps.now ?? Date.now;
    const { prompt } = request;
    const modelId = router.modelFor(prompt.tier);
    const promptChars = [...prompt.system, ...prompt.user].reduce((n, b) => n + b.text.length, 0);
    const reserved = reservationMicros(modelId, promptChars, prompt.maxTokens);

    const generationId = await ledger.reserve(actor, {
      brandId: request.brandId,
      task: prompt.task,
      templateId: prompt.templateId,
      templateVersion: prompt.templateVersion,
      provider: provider.name,
      modelId,
      reservedMicros: reserved,
      sourceUrl: request.source?.url,
      sourceExcerpt: request.source?.excerpt,
    });
    yield { type: 'start', generationId, modelId };

    const started = now();
    let text = '';
    let usage: TokenUsage | null = null;
    let stopReason = 'unknown';
    const finish = async (
      status: 'succeeded' | 'failed' | 'invalid_output',
      errorCode: string | null,
      output?: unknown,
    ) => {
      // Without a usage report the real cost is unknown: keep the reservation if anything was generated.
      const cost = usage ? costMicros(modelId, usage) : text ? reserved : 0;
      const finalUsage = usage ?? NO_USAGE;
      try {
        await ledger.finish(actor, generationId, {
          status,
          usage: finalUsage,
          costMicros: cost,
          latencyMs: Math.max(0, Math.round(now() - started)),
          errorCode,
          output,
        });
      } catch (err) {
        logger?.error('ai.finish_failed', {
          generationId,
          error: err instanceof Error ? err.name : 'unknown',
        });
      }
      await metrics
        .record({ task: prompt.task, modelId, status, usage: finalUsage, costMicros: cost })
        .catch((err: unknown) =>
          logger?.warn('ai.metrics_failed', { error: err instanceof Error ? err.name : 'unknown' }),
        );
      logger?.info('ai.generation', {
        generationId,
        task: prompt.task,
        modelId,
        status,
        errorCode,
        inputTokens: finalUsage.inputTokens,
        outputTokens: finalUsage.outputTokens,
        cacheReadTokens: finalUsage.cacheReadTokens,
        costMicros: cost,
      });
    };

    try {
      for await (const event of provider.stream(
        {
          modelId,
          system: prompt.system,
          user: prompt.user,
          maxTokens: prompt.maxTokens,
          effort: prompt.effort,
          jsonSchema: { name: prompt.schemaName, schema: modelJsonSchema(prompt.schema) },
        },
        request.signal,
      )) {
        if (event.type === 'text') {
          text += event.text;
          yield { type: 'delta', text: event.text };
        } else if (event.type === 'usage') usage = event.usage;
        else stopReason = event.reason;
      }
    } catch (err) {
      const appError =
        err instanceof AppError
          ? err
          : new AppError('UPSTREAM_UNAVAILABLE', 'The AI service had a problem. Please try again.', {
              cause: err,
            });
      await finish('failed', providerErrorCode(err));
      throw appError;
    }

    const output = parseOutput(prompt, text, stopReason);
    if (!output.ok) {
      await finish('invalid_output', output.code);
      throw new AppError(
        'AI_OUTPUT_INVALID',
        output.code === 'max_tokens'
          ? 'The AI ran out of room before finishing. Try a shorter request.'
          : output.code === 'refusal'
            ? 'The AI declined this request. Try rephrasing it.'
            : 'The AI’s answer wasn’t usable. Please try again.',
      );
    }
    await finish('succeeded', null, output.value);
    yield { type: 'done', generationId, output: output.value };
  }
}

type Parsed<T> =
  { ok: true; value: T } | { ok: false; code: 'max_tokens' | 'refusal' | 'invalid_json' | 'schema_mismatch' };

export function parseOutput<T>(prompt: BuiltPrompt<T>, text: string, stopReason: string): Parsed<T> {
  if (stopReason === 'max_tokens') return { ok: false, code: 'max_tokens' };
  if (
    stopReason === 'refusal' ||
    stopReason === 'content_filtered' ||
    stopReason === 'guardrail_intervened'
  ) {
    return { ok: false, code: 'refusal' };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, code: 'invalid_json' };
  }
  const result = prompt.schema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false, code: 'schema_mismatch' };
}

function providerErrorCode(err: unknown): string {
  const cause =
    err instanceof AppError ? (err.cause as { name?: string } | undefined) : (err as { name?: string });
  return (cause?.name ?? 'Error').slice(0, 64);
}
