import { z } from 'zod';
import type { Database } from '../db/client';
import { withDbContext } from '../db/context';
import type { OrgActor } from '../domain/brands/service';
import { assertCan } from '../domain/permissions';
import type { SafeFetchOptions } from '../sources/safe-fetch';
import { excerptOf, readArticle, readWebsite } from '../sources/website';
import { recordWebFetch, type AiLimits } from './budget';
import { loadBrandContext } from './brand-context';
import type { AiGateway, GatewayEvent } from './gateway';
import {
  campaignConceptsInput,
  campaignConceptsPrompt,
  generatePostVariantsPrompt,
  generateVariantsInput,
  guidedAnswersInput,
  rewritePrompt,
  summarizeArticleInput,
  summarizeArticlePrompt,
  transformInput,
  voiceDraftFromAnswersPrompt,
  voiceDraftFromWebsitePrompt,
  voiceProposalInput,
  voiceSamplesInput,
  voiceSamplesPrompt,
  voiceTunePrompt,
} from './prompts/templates';
import type { BuiltPrompt } from './types';

const httpUrl = z.url({ protocol: /^https?$/, message: 'Enter a full http(s) URL' }).max(2048);

/** Everything the Studio and the Brand Voice assistant can ask for, as one validated request. */
export const studioRequest = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('generate_variants'),
    input: generateVariantsInput.extend({
      articleUrl: httpUrl.nullish().or(z.literal('').transform(() => null)),
    }),
  }),
  z.object({ action: z.literal('transform'), input: transformInput }),
  z.object({ action: z.literal('summarize_article'), input: summarizeArticleInput }),
  z.object({ action: z.literal('campaign_concepts'), input: campaignConceptsInput }),
  z.object({ action: z.literal('voice_from_website'), input: z.object({ url: httpUrl }) }),
  z.object({ action: z.literal('voice_from_answers'), input: guidedAnswersInput }),
  z.object({ action: z.literal('voice_tune'), input: voiceProposalInput }),
  z.object({ action: z.literal('voice_samples'), input: voiceSamplesInput }),
]);
export type StudioRequest = z.input<typeof studioRequest>;
export type StudioAction = StudioRequest['action'];

export interface StudioDeps {
  db: Database;
  gateway: AiGateway;
  limits: (actor: OrgActor) => Promise<AiLimits>;
  fetchOptions?: SafeFetchOptions;
}

/**
 * Builds the prompt for a Studio request (reading a website or article first when needed) and
 * streams the gateway's events. Website reads count against the daily web-fetch cap before any
 * request leaves the server.
 */
export async function* runStudioAction(
  deps: StudioDeps,
  actor: OrgActor,
  brandId: string,
  rawRequest: unknown,
  signal?: AbortSignal,
): AsyncGenerator<GatewayEvent<unknown>> {
  assertCan(actor.role, 'ai.generate');
  const request = studioRequest.parse(rawRequest);
  const context = await withDbContext(deps.db, { userId: actor.userId }, (tx) =>
    loadBrandContext(tx, actor.orgId, brandId),
  );
  const fetchOptions = { ...deps.fetchOptions, signal };
  const countFetch = async (pages: number) => {
    const limits = await deps.limits(actor);
    await withDbContext(deps.db, { userId: actor.userId }, (tx) => recordWebFetch(tx, actor, limits, pages));
  };
  const run = <T>(prompt: BuiltPrompt<T>, source?: { url: string; excerpt: string }) =>
    deps.gateway.stream<T>(actor, { brandId, prompt, source, signal });

  switch (request.action) {
    case 'generate_variants': {
      const { articleUrl, ...input } = request.input;
      let article;
      if (articleUrl) {
        await countFetch(1);
        article = await readArticle(articleUrl, fetchOptions);
      }
      yield* run(
        generatePostVariantsPrompt(context, input, article),
        article && { url: article.url, excerpt: excerptOf([article]) },
      );
      return;
    }
    case 'transform':
      yield* run(rewritePrompt(context, request.input));
      return;
    case 'summarize_article': {
      await countFetch(1);
      const article = await readArticle(request.input.url, fetchOptions);
      yield* run(summarizeArticlePrompt(context, article), {
        url: article.url,
        excerpt: excerptOf([article]),
      });
      return;
    }
    case 'campaign_concepts':
      yield* run(campaignConceptsPrompt(context, request.input));
      return;
    case 'voice_from_website': {
      await countFetch(1);
      const pages = await readWebsite(request.input.url, fetchOptions);
      yield* run(voiceDraftFromWebsitePrompt(context, pages), {
        url: pages[0]!.url,
        excerpt: excerptOf(pages),
      });
      return;
    }
    case 'voice_from_answers':
      yield* run(voiceDraftFromAnswersPrompt(context, request.input));
      return;
    case 'voice_tune':
      yield* run(voiceTunePrompt(context, request.input));
      return;
    case 'voice_samples':
      yield* run(voiceSamplesPrompt(context, request.input));
      return;
  }
}
