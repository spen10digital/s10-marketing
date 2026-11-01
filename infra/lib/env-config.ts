export type EnvName = 'dev' | 'prod';

export interface EnvConfig {
  envName: EnvName;
  /** All accounts run in us-east-1 (D3). */
  region: 'us-east-1';
  /** Monthly cost budget with alerts at each threshold (USD, actual spend). */
  budgetThresholdsUsd: number[];
  /** Vercel project name (OIDC subject claim). */
  vercelProject: string;
  /** Vercel team slug, passed with `--context vercelTeam=...`; the web role needs it. */
  vercelTeam?: string;
  /** Optional: owner's alert email, passed with `--context alertEmail=...`. */
  alertEmail?: string;
  /** Optional: `owner/repo` on GitHub, passed with `--context githubRepo=...` (D1). */
  githubRepo?: string;
}

const base = {
  region: 'us-east-1',
  budgetThresholdsUsd: [25, 75, 150],
  vercelProject: 's10-marketing',
} as const;

export const ENVIRONMENTS: Record<EnvName, Omit<EnvConfig, 'alertEmail' | 'githubRepo' | 'vercelTeam'>> = {
  dev: { ...base, budgetThresholdsUsd: [...base.budgetThresholdsUsd], envName: 'dev' },
  prod: { ...base, budgetThresholdsUsd: [...base.budgetThresholdsUsd], envName: 'prod' },
};

const optionalString = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

export function resolveEnvConfig(context: {
  env?: unknown;
  alertEmail?: unknown;
  githubRepo?: unknown;
  vercelTeam?: unknown;
}): EnvConfig {
  const envName = context.env ?? 'dev';
  if (envName !== 'dev' && envName !== 'prod') {
    throw new Error(`Unknown env "${String(envName)}"; use --context env=dev|prod`);
  }
  const githubRepo = optionalString(context.githubRepo);
  if (githubRepo && !/^[\w.-]+\/[\w.-]+$/.test(githubRepo)) {
    throw new Error('githubRepo must look like "owner/repo"');
  }
  const vercelTeam = optionalString(context.vercelTeam);
  if (vercelTeam && !/^[a-z0-9][a-z0-9-]*$/.test(vercelTeam)) {
    throw new Error('vercelTeam must be the Vercel team slug (lowercase letters, digits, hyphens)');
  }
  return { ...ENVIRONMENTS[envName], alertEmail: optionalString(context.alertEmail), githubRepo, vercelTeam };
}

/** Parameter Store prefix read by `packages/core/src/config/params.ts`. */
export const paramPrefix = (env: EnvName) => `/s10-marketing/${env}`;
export const resourcePrefix = (env: EnvName) => `s10-marketing-${env}`;
