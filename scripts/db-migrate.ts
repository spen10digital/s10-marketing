/**
 * Applies db/migrations (05 §4).
 *
 *   pnpm db:migrate                       local Docker Postgres (DATABASE_ADMIN_URL or the compose default)
 *   pnpm db:migrate --aws --env dev       Aurora via the RDS Data API, as app_owner (⛔ owner approval)
 *
 * After migrating it gives app_rw its login password: locally LOCAL_APP_RW_PASSWORD (a throwaway
 * dev value), in AWS the generated password from the app_rw secret in Secrets Manager. AWS mode
 * uses the caller's SSO profile (`aws sso login --profile s10-dev`); no keys are read from files.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';
import pg from 'pg';
import { dataApiExecutor, pgExecutor } from '../packages/core/src/db/executors';
import {
  loadMigrations,
  migrate,
  setAppRolePassword,
  type SqlExecutor,
} from '../packages/core/src/db/migrate';

const REGION = 'us-east-2';
const LOCAL_ADMIN_URL = 'postgres://postgres:postgres@localhost:5432/s10_marketing';

async function main() {
  const { values } = parseArgs({
    options: { aws: { type: 'boolean', default: false }, env: { type: 'string' } },
  });
  const migrations = await loadMigrations(resolve(import.meta.dirname, '../db/migrations'));

  if (!values.aws) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL ?? LOCAL_ADMIN_URL });
    try {
      const db = pgExecutor(pool);
      report(await migrate(db, migrations));
      await setAppRolePassword(db, process.env.LOCAL_APP_RW_PASSWORD ?? 'app_rw_local');
    } finally {
      await pool.end();
    }
    return;
  }

  if (values.env !== 'dev' && values.env !== 'prod') throw new Error('--aws needs --env dev|prod');
  const params = await readDbParams(values.env);
  const db: SqlExecutor = dataApiExecutor(new RDSDataClient({ region: REGION }), {
    resourceArn: params.clusterArn,
    secretArn: params.ownerSecretArn,
    database: params.database,
  });
  report(await migrate(db, migrations));

  const secret = await new SecretsManagerClient({ region: REGION }).send(
    new GetSecretValueCommand({ SecretId: params.appSecretArn }),
  );
  const password = (JSON.parse(secret.SecretString ?? '{}') as { password?: string }).password;
  if (!password) throw new Error('app_rw secret has no password field');
  await setAppRolePassword(db, password);
  console.error('app_rw login password synced from Secrets Manager.');
}

async function readDbParams(env: 'dev' | 'prod') {
  const prefix = `/s10-marketing/${env}/`;
  const ssm = new SSMClient({ region: REGION });
  const out: Record<string, string> = {};
  let NextToken: string | undefined;
  do {
    const page = await ssm.send(new GetParametersByPathCommand({ Path: prefix, NextToken }));
    for (const p of page.Parameters ?? []) if (p.Name && p.Value) out[p.Name.slice(prefix.length)] = p.Value;
    NextToken = page.NextToken;
  } while (NextToken);

  const need = (key: string) => {
    const value = out[key];
    if (!value) throw new Error(`Parameter ${prefix}${key} is missing; deploy the Database stack first.`);
    return value;
  };
  return {
    clusterArn: need('db-cluster-arn'),
    ownerSecretArn: need('db-owner-secret-arn'),
    appSecretArn: need('db-secret-arn'),
    database: need('db-name'),
  };
}

function report({ applied, skipped }: { applied: string[]; skipped: string[] }) {
  console.error(`Applied ${applied.length} migration(s)${applied.length ? `: ${applied.join(', ')}` : ''}.`);
  if (skipped.length) console.error(`Already applied: ${skipped.join(', ')}.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
