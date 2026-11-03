import { and, eq, sql } from 'drizzle-orm';
import type { DbTx } from '../db/client';
import { rowsOf } from '../db/rows';
import { aiGenerations, orgEntitlements, usageEvents, type AiGenerationStatus } from '../db/schema';
import type { OrgActor } from '../domain/brands/service';
import { assertCan } from '../domain/permissions';
import { AppError } from '../errors/app-error';
import { microsToUsd, usdToMicros } from './pricing';
import type { AiTask, TokenUsage } from './types';

/**
 * Per-org AI limits and the budget reservation (ADR 0016). Every check runs under a per-org
 * advisory lock, so concurrent requests can't both slip under the cap.
 */
export interface AiLimits {
  monthlyBudgetMicros: number;
  dailyCalls: number;
  webFetchDaily: number;
}

export const DEFAULT_AI_DAILY_CALLS = 100;
export const DEFAULT_WEB_FETCH_DAILY = 20;

export async function getAiLimits(
  tx: DbTx,
  orgId: string,
  defaultMonthlyBudgetUsd: number,
): Promise<AiLimits> {
  const [row] = await tx.select().from(orgEntitlements).where(eq(orgEntitlements.orgId, orgId));
  return {
    monthlyBudgetMicros: row?.aiMonthlyBudgetMicros ?? usdToMicros(defaultMonthlyBudgetUsd),
    dailyCalls: row?.aiDailyCalls ?? DEFAULT_AI_DAILY_CALLS,
    webFetchDaily: row?.webFetchDaily ?? DEFAULT_WEB_FETCH_DAILY,
  };
}

export interface AiUsageSummary {
  /** This UTC month: finished calls at their real cost, pending ones at their reservation. */
  spentMicros: number;
  callsToday: number;
  webFetchesToday: number;
}

export async function getAiUsage(tx: DbTx, orgId: string): Promise<AiUsageSummary> {
  const [row] = rowsOf<{ spent: string | null; calls: string | null; fetches: string | null }>(
    await tx.execute(sql`
      select
        (select coalesce(sum(case when g.status = 'pending' then g.reserved_micros else g.cost_micros end), 0)
           from public.ai_generations g
          where g.org_id = ${orgId}
            and g.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc') as spent,
        (select count(*) from public.ai_generations g
          where g.org_id = ${orgId}
            and g.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') as calls,
        (select count(*) from public.usage_events u
          where u.org_id = ${orgId} and u.kind = 'web_fetch'
            and u.occurred_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') as fetches`),
  );
  return {
    spentMicros: Number(row?.spent ?? 0),
    callsToday: Number(row?.calls ?? 0),
    webFetchesToday: Number(row?.fetches ?? 0),
  };
}

async function lockOrg(tx: DbTx, orgId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ai_budget:${orgId}`}, 0))`);
}

export interface ReserveParams {
  brandId: string;
  task: AiTask;
  templateId: string;
  templateVersion: number;
  provider: string;
  modelId: string;
  reservedMicros: number;
  sourceUrl?: string | null;
  sourceExcerpt?: string | null;
}

/**
 * Checks the daily call cap and the monthly budget, then records a `pending` generation holding
 * the worst-case cost. Throws before any model call when a limit would be exceeded.
 */
export async function reserveGeneration(
  tx: DbTx,
  actor: OrgActor,
  limits: AiLimits,
  params: ReserveParams,
): Promise<string> {
  assertCan(actor.role, 'ai.generate');
  await lockOrg(tx, actor.orgId);
  const usage = await getAiUsage(tx, actor.orgId);
  if (usage.callsToday >= limits.dailyCalls) {
    throw new AppError(
      'RATE_LIMITED',
      `This organization has used its ${limits.dailyCalls} AI requests for today. The limit resets at midnight UTC.`,
    );
  }
  if (usage.spentMicros + params.reservedMicros > limits.monthlyBudgetMicros) {
    throw new AppError(
      'BUDGET_EXCEEDED',
      `This organization has reached its monthly AI budget ($${microsToUsd(limits.monthlyBudgetMicros).toFixed(2)}). It resets on the 1st (UTC).`,
    );
  }
  const [row] = await tx
    .insert(aiGenerations)
    .values({
      orgId: actor.orgId,
      brandId: params.brandId,
      task: params.task,
      templateId: params.templateId,
      templateVersion: params.templateVersion,
      provider: params.provider,
      modelId: params.modelId,
      status: 'pending',
      reservedMicros: params.reservedMicros,
      sourceUrl: params.sourceUrl ?? null,
      sourceExcerpt: params.sourceExcerpt?.slice(0, 2000) ?? null,
      createdBy: actor.userId,
    })
    .returning({ id: aiGenerations.id });
  if (!row) throw new AppError('INTERNAL', 'Could not start the AI request.');
  return row.id;
}

export interface FinishParams {
  status: Exclude<AiGenerationStatus, 'pending'>;
  usage: TokenUsage;
  costMicros: number;
  latencyMs: number;
  errorCode?: string | null;
  output?: unknown;
}

/** Records the real outcome and meters it. A finished generation can't be changed again (RLS). */
export async function finishGeneration(
  tx: DbTx,
  actor: OrgActor,
  generationId: string,
  result: FinishParams,
) {
  await tx
    .update(aiGenerations)
    .set({
      status: result.status,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      costMicros: result.costMicros,
      latencyMs: result.latencyMs,
      errorCode: result.errorCode ?? null,
      output: result.output ?? null,
      finishedAt: new Date(),
    })
    .where(and(eq(aiGenerations.orgId, actor.orgId), eq(aiGenerations.id, generationId)));
  const tokens =
    result.usage.inputTokens +
    result.usage.outputTokens +
    result.usage.cacheReadTokens +
    result.usage.cacheWriteTokens;
  if (tokens > 0 || result.costMicros > 0) {
    await tx.insert(usageEvents).values({
      orgId: actor.orgId,
      kind: 'ai_tokens',
      quantity: tokens,
      costMicros: result.costMicros,
      refId: generationId,
      createdBy: actor.userId,
    });
  }
}

/** Counts one website read against the daily cap before anything is fetched. */
export async function recordWebFetch(
  tx: DbTx,
  actor: OrgActor,
  limits: AiLimits,
  pages: number,
): Promise<void> {
  assertCan(actor.role, 'ai.generate');
  await lockOrg(tx, actor.orgId);
  const usage = await getAiUsage(tx, actor.orgId);
  if (usage.webFetchesToday >= limits.webFetchDaily) {
    throw new AppError(
      'RATE_LIMITED',
      `This organization has read ${limits.webFetchDaily} websites today. The limit resets at midnight UTC.`,
    );
  }
  await tx.insert(usageEvents).values({
    orgId: actor.orgId,
    kind: 'web_fetch',
    quantity: pages,
    createdBy: actor.userId,
  });
}
