import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';
import { z } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * Runtime configuration (05 §5). Locally it comes from `.env.local`; in AWS, non-secret
 * values come from SSM Parameter Store under `/s10-marketing/<env>/`, read through the
 * IAM role and cached per cold start. Secrets (Secrets Manager) are added with the first
 * feature that needs one (M1.4, Meta app secret).
 */
const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

export const configSchema = z.object({
  APP_ENV: z.enum(['local', 'dev', 'prod']),
  AWS_REGION: z.literal('us-east-1').default('us-east-1'),
  APP_URL: z.url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().optional(),
  DB_CLUSTER_ARN: z.string().optional(),
  DB_SECRET_ARN: z.string().optional(),
  DB_NAME: z.string().optional(),

  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),
  COGNITO_DOMAIN: z.string().optional(),

  META_APP_ID: z.string().optional(),
  META_LOGIN_CONFIG_ID: z.string().optional(),
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v26.0'),
  META_REDIRECT_URI: z.url().optional(),

  TOKEN_KMS_KEY_ARN: z.string().optional(),
  PUBLISH_QUEUE_URL: z.string().optional(),
  INGEST_QUEUE_URL: z.string().optional(),
  SCHEDULER_GROUP: z.string().optional(),
  SCHEDULER_TARGET_ROLE_ARN: z.string().optional(),
  MEDIA_BUCKET: z.string().optional(),
  OPS_ALERT_TOPIC_ARN: z.string().optional(),

  AI_MODEL_GENERATE: z.string().optional(),
  AI_MODEL_FAST: z.string().optional(),
  AI_DEFAULT_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(10),

  SES_FROM_ADDRESS: z.string().optional(),
  SES_CONFIGURATION_SET: z.string().optional(),

  PUBLISHING_ENABLED: bool,
  AUTOMATION_ENABLED: bool,
});

export type AppConfig = z.infer<typeof configSchema>;
type RawConfig = Record<string, string | undefined>;

/** `/s10-marketing/dev/app-url` → `APP_URL` */
export function parameterNameToKey(name: string, prefix: string): string {
  return name.slice(prefix.length).replace(/^\//, '').replace(/[-/]/g, '_').toUpperCase();
}

export function parameterPrefix(appEnv: 'dev' | 'prod'): string {
  return `/s10-marketing/${appEnv}/`;
}

export async function readParameters(ssm: SSMClient, prefix: string): Promise<RawConfig> {
  const out: RawConfig = {};
  let nextToken: string | undefined;
  do {
    const page = await ssm.send(
      new GetParametersByPathCommand({
        Path: prefix,
        Recursive: true,
        WithDecryption: false,
        NextToken: nextToken,
      }),
    );
    for (const p of page.Parameters ?? []) {
      if (p.Name && p.Value !== undefined) out[parameterNameToKey(p.Name, prefix)] = p.Value;
    }
    nextToken = page.NextToken;
  } while (nextToken);
  return out;
}

export function parseConfig(raw: RawConfig): AppConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    // Report key names only; values may be sensitive.
    const keys = [...new Set(result.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new AppError('CONFIG_INVALID', `Invalid configuration: ${keys}`);
  }
  return result.data;
}

export interface LoadConfigOptions {
  env?: RawConfig;
  ssm?: SSMClient;
}

/**
 * Local: environment only. dev/prod: Parameter Store values, with the process environment
 * (APP_ENV, AWS_REGION and anything Amplify/Lambda sets) taking precedence.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<AppConfig> {
  const env = options.env ?? process.env;
  const appEnv = env.APP_ENV ?? 'local';
  if (appEnv !== 'dev' && appEnv !== 'prod') return parseConfig({ ...env, APP_ENV: appEnv });

  const ssm = options.ssm ?? new SSMClient({ region: env.AWS_REGION ?? 'us-east-1' });
  const params = await readParameters(ssm, parameterPrefix(appEnv));
  return parseConfig({ ...params, ...definedOnly(env), APP_ENV: appEnv });
}

let cached: Promise<AppConfig> | undefined;

/** Cached per process (cold start). Resets on failure so the next request retries. */
export function getConfig(): Promise<AppConfig> {
  cached ??= loadConfig().catch((err: unknown) => {
    cached = undefined;
    throw err;
  });
  return cached;
}

export function resetConfigCache(): void {
  cached = undefined;
}

/** The only config values allowed in the browser bundle. */
export function publicConfig(config: AppConfig) {
  return {
    appEnv: config.APP_ENV,
    appUrl: config.APP_URL,
    cognitoClientId: config.COGNITO_CLIENT_ID,
    cognitoDomain: config.COGNITO_DOMAIN,
  };
}

function definedOnly(env: RawConfig): RawConfig {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
}
