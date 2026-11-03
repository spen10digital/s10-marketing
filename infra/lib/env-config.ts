export type EnvName = 'dev' | 'prod';

export interface EnvConfig {
  envName: EnvName;
  /** All workloads run in us-east-2, the organization's workload region (D3, ADR 0013). */
  region: 'us-east-2';
  /** Monthly cost budget with alerts at each threshold (USD, actual spend). */
  budgetThresholdsUsd: number[];
  /** Vercel project name (OIDC subject claim). */
  vercelProject: string;
  /** Vercel team slug, passed with `--context vercelTeam=...`; the web role needs it. */
  vercelTeam?: string;
  /** Optional: owner's alert email, passed with `--context alertEmail=...`. */
  alertEmail?: string;
  /**
   * Optional: the GitHub repo as it appears in the Actions OIDC subject (D1). Repos using
   * GitHub's immutable subject format need `owner@ownerId/repo@repoId` (see `gh api
   * repos/<owner>/<repo>/actions/oidc/customization/sub`); older ones use `owner/repo`.
   */
  githubRepo?: string;
  /**
   * Origins of the web app that may complete Cognito sign-in (callback and sign-out URLs).
   * Cognito does not accept wildcards, so per-commit Vercel preview URLs cannot sign in; use the
   * stable branch alias. Override with `--context appUrls=https://a,https://b`. The Identity stack
   * is only created when this is non-empty; the first entry becomes APP_URL.
   */
  appUrls: string[];
  /** Aurora Serverless v2 capacity range (ACU). Min 0 lets the cluster pause when idle. */
  dbCapacity: { min: number; max: number };
  /**
   * Bedrock models (US cross-Region inference profiles; confirm the IDs in the Bedrock console)
   * and the default monthly AI budget per organization (orgs can differ via org_entitlements).
   */
  ai: { generateModel: string; fastModel: string; defaultMonthlyBudgetUsd: number };
}

const base = {
  region: 'us-east-2',
  budgetThresholdsUsd: [25, 75, 150],
  vercelProject: 's10-marketing',
} as const;

// Claude Sonnet 5.5 for generation, Claude Haiku 5.5 for quick edits (price/performance pick).
const ai = {
  generateModel: 'us.anthropic.claude-sonnet-5-5',
  fastModel: 'us.anthropic.claude-haiku-5-5',
  defaultMonthlyBudgetUsd: 10,
};

export const ENVIRONMENTS: Record<EnvName, Omit<EnvConfig, 'alertEmail' | 'githubRepo' | 'vercelTeam'>> = {
  dev: {
    ...base,
    budgetThresholdsUsd: [...base.budgetThresholdsUsd],
    envName: 'dev',
    // The `develop` branch alias on Vercel (<project>-git-<branch>-<team>.vercel.app) and local dev.
    appUrls: ['https://s10-marketing-git-develop-spen-10-digital.vercel.app', 'http://localhost:3000'],
    dbCapacity: { min: 0, max: 4 },
    ai: { ...ai },
  },
  // Prod sign-in waits for the production domain (--context appUrls=https://…).
  prod: {
    ...base,
    budgetThresholdsUsd: [...base.budgetThresholdsUsd],
    envName: 'prod',
    appUrls: [],
    dbCapacity: { min: 0, max: 4 },
    ai: { ...ai },
  },
};

const optionalString = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

export function resolveEnvConfig(context: {
  env?: unknown;
  alertEmail?: unknown;
  githubRepo?: unknown;
  vercelTeam?: unknown;
  appUrls?: unknown;
}): EnvConfig {
  const envName = context.env ?? 'dev';
  if (envName !== 'dev' && envName !== 'prod') {
    throw new Error(`Unknown env "${String(envName)}"; use --context env=dev|prod`);
  }
  const githubRepo = optionalString(context.githubRepo);
  if (githubRepo && !/^[\w.-]+(@\d+)?\/[\w.-]+(@\d+)?$/.test(githubRepo)) {
    throw new Error('githubRepo must look like "owner/repo" or "owner@ownerId/repo@repoId"');
  }
  const vercelTeam = optionalString(context.vercelTeam);
  if (vercelTeam && !/^[a-z0-9][a-z0-9-]*$/.test(vercelTeam)) {
    throw new Error('vercelTeam must be the Vercel team slug (lowercase letters, digits, hyphens)');
  }
  const appUrlsOverride = optionalString(context.appUrls)
    ?.split(',')
    .map((u) => u.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  for (const url of appUrlsOverride ?? []) {
    if (!/^(https:\/\/[a-z0-9.-]+|http:\/\/localhost(:\d+)?)$/.test(url)) {
      throw new Error(`appUrls entry "${url}" must be an https origin (or http://localhost) with no path`);
    }
  }
  const base = ENVIRONMENTS[envName];
  return {
    ...base,
    appUrls: appUrlsOverride ?? [...base.appUrls],
    alertEmail: optionalString(context.alertEmail),
    githubRepo,
    vercelTeam,
  };
}

/** Regions a US cross-Region inference profile may route to (the foundation-model ARNs it needs). */
export const US_INFERENCE_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2'] as const;

/** Parameter Store prefix read by `packages/core/src/config/params.ts`. */
export const paramPrefix = (env: EnvName) => `/s10-marketing/${env}`;
export const resourcePrefix = (env: EnvName) => `s10-marketing-${env}`;
