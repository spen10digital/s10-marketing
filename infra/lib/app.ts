import { App, Aspects, Tags, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { CicdStack } from './cicd-stack';
import { CoreStack } from './core-stack';
import { DatabaseStack } from './database-stack';
import type { EnvConfig } from './env-config';
import { Guardrails } from './guardrails';
import { IdentityStack } from './identity-stack';
import { ObservabilityStack } from './observability-stack';
import { VercelAccessStack } from './vercel-access-stack';

export interface BuildAppOptions {
  config: EnvConfig;
  account?: string;
  outdir?: string;
}

/** Builds every stack for one environment; shared by `bin/app.ts` and the CDK tests. */
export function buildApp({ config, account, outdir }: BuildAppOptions) {
  const app = new App({ outdir });
  const env = { account, region: config.region };
  const name = (stack: string) => `S10Marketing-${config.envName}-${stack}`;

  const core = new CoreStack(app, name('Core'), { env, config });
  const observability = new ObservabilityStack(app, name('Observability'), {
    env,
    config,
    opsTopic: core.opsTopic,
  });
  const database = new DatabaseStack(app, name('Database'), { env, config });
  // Sign-in needs registered callback URLs (config.appUrls); prod waits for its domain.
  const identity = config.appUrls.length
    ? new IdentityStack(app, name('Identity'), { env, config })
    : undefined;
  // The web role is only created once the Vercel team slug is known (--context vercelTeam=...).
  const vercel = config.vercelTeam
    ? new VercelAccessStack(app, name('VercelAccess'), {
        env,
        config: { ...config, vercelTeam: config.vercelTeam },
        database: { clusterArn: database.cluster.clusterArn, appSecretArn: database.appSecret.secretArn },
      })
    : undefined;
  const cicd = config.githubRepo
    ? new CicdStack(app, name('Cicd'), { env, config: { ...config, githubRepo: config.githubRepo } })
    : undefined;

  Tags.of(app).add('project', 's10-marketing');
  Tags.of(app).add('environment', config.envName);
  Aspects.of(app).add(new Guardrails());
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));

  return { app, core, observability, database, identity, vercel, cicd };
}
