import 'server-only';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import {
  AiGateway,
  BedrockConverseProvider,
  CloudWatchAiMetrics,
  dbLedger,
  FakeAiProvider,
  getAiLimits,
  noopMetrics,
  routerFromConfig,
  type ProviderRequest,
  type StudioDeps,
} from '@s10/core/ai';
import type { AppConfig } from '@s10/core/config';
import { withDbContext } from '@s10/core/db';
import type { OrgActor } from '@s10/core/domain';
import { createLogger } from '@s10/core/logging';
import { awsCredentials, AWS_REGION } from './aws';
import { getConfig } from './config';
import { getDb } from './db';

let cached: Promise<StudioDeps> | undefined;

/**
 * The AI stack for this function instance: Bedrock through the web role's OIDC credentials, the
 * Postgres ledger for budgets, CloudWatch for token metrics. `AI_PROVIDER=fake` (local only)
 * swaps Bedrock for canned answers so the UI can be developed without AWS.
 */
export function getStudioDeps(): Promise<StudioDeps> {
  cached ??= build().catch((err: unknown) => {
    cached = undefined;
    throw err;
  });
  return cached;
}

async function build(): Promise<StudioDeps> {
  const [config, db] = await Promise.all([getConfig(), getDb()]);
  const fake = config.AI_PROVIDER === 'fake';
  const limits = (actor: OrgActor) =>
    withDbContext(db, { userId: actor.userId }, (tx) =>
      getAiLimits(tx, actor.orgId, config.AI_DEFAULT_MONTHLY_BUDGET_USD),
    );
  const credentials = awsCredentials();
  const gateway = new AiGateway({
    ledger: dbLedger(db, limits),
    provider: fake
      ? new FakeAiProvider(fakeAnswer)
      : new BedrockConverseProvider(new BedrockRuntimeClient({ region: AWS_REGION, credentials })),
    router: routerFromConfig(fake ? withFakeModels(config) : config),
    metrics: fake
      ? noopMetrics
      : new CloudWatchAiMetrics(new CloudWatchClient({ region: AWS_REGION, credentials }), config.APP_ENV),
    logger: createLogger({ level: config.LOG_LEVEL, bindings: { component: 'ai' } }),
  });
  return { db, gateway, limits };
}

function withFakeModels(config: AppConfig) {
  return {
    AI_MODEL_GENERATE: config.AI_MODEL_GENERATE ?? 'us.anthropic.claude-sonnet-5-5',
    AI_MODEL_FAST: config.AI_MODEL_FAST ?? 'us.anthropic.claude-haiku-5-5',
  };
}

/** Canned, schema-valid answers for local development (`AI_PROVIDER=fake`). */
function fakeAnswer(request: ProviderRequest): unknown {
  const post = 'This is a sample draft from the local fake AI. Real drafts come from Claude on Bedrock.';
  switch (request.jsonSchema.name) {
    case 'post_variants':
      return {
        variants: ['launch', 'behind the scenes', 'question'].map((angle, i) => ({
          text: `${post} (${angle})`,
          hook: `Sample hook ${i + 1}`,
          cta: 'Learn more',
          hashtags: ['sample'],
          angle,
        })),
      };
    case 'rewrite':
      return { text: `${post} (rewritten)` };
    case 'article_summary':
      return { summary: 'A sample summary of the article.', keyPoints: ['First point', 'Second point'] };
    case 'campaign_concepts':
      return {
        concepts: [
          {
            name: 'Sample campaign',
            summary: 'A sample idea.',
            samplePost: post,
            rationale: 'Fits the brand.',
          },
        ],
      };
    case 'voice_profile':
      return {
        audience: 'Sample audience',
        tone: 'Friendly, clear',
        guidelines: 'Short sentences. One idea per post.',
        doList: ['Use plain words'],
        dontList: ['Jargon'],
        examplePosts: [post],
        ctaDefaults: ['Learn more'],
      };
    case 'voice_suggestions':
      return {
        suggestions: [
          { field: 'doList', action: 'add', value: 'End with a question', reason: 'Invites replies.' },
        ],
      };
    case 'voice_samples':
      return { samples: [{ text: post, angle: 'sample' }] };
    default:
      return {};
  }
}
