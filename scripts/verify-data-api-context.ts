/**
 * Proves the assumption behind withDbContext on the real Data API (02 §3.2 ⚠️): a value set with
 * set_config(..., is_local => true) in a Data API transaction is visible to later statements of
 * that transaction, and gone in the next one.
 *
 *   pnpm db:verify-context --env dev      (SSO profile; read-only except for its own transactions)
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createDatabase, rowsOf, sql, withDbContext } from '../packages/core/src/db';

const REGION = 'us-east-2';

async function main() {
  const { values } = parseArgs({ options: { env: { type: 'string' } } });
  if (values.env !== 'dev' && values.env !== 'prod') throw new Error('Use --env dev|prod');
  const prefix = `/s10-marketing/${values.env}/`;
  const ssm = new SSMClient({ region: REGION });
  const params = new Map<string, string>();
  let NextToken: string | undefined;
  do {
    const page = await ssm.send(new GetParametersByPathCommand({ Path: prefix, NextToken }));
    for (const p of page.Parameters ?? []) if (p.Name && p.Value) params.set(p.Name, p.Value);
    NextToken = page.NextToken;
  } while (NextToken);
  const param = (name: string) => {
    const value = params.get(`${prefix}${name}`);
    if (!value) throw new Error(`Missing parameter ${prefix}${name}`);
    return value;
  };

  // Same identity as the app: the app_rw secret.
  const db = createDatabase({
    kind: 'data-api',
    resourceArn: param('db-cluster-arn'),
    secretArn: param('db-secret-arn'),
    database: param('db-name'),
  });
  const userId = randomUUID();
  const setting = sql`select current_setting('app.user_id', true) as v, current_user as role`;

  const inside = await withDbContext(
    db,
    { userId },
    async (tx) => rowsOf<{ v: string; role: string }>(await tx.execute(setting))[0],
  );
  const after = await db.transaction(
    async (tx) => rowsOf<{ v: string | null }>(await tx.execute(setting))[0],
  );

  const persisted = inside?.v === userId;
  const leaked = Boolean(after?.v);
  console.error(`role: ${inside?.role}`);
  console.error(
    `set_config visible to the next statement in the same transaction: ${persisted ? 'yes' : 'NO'}`,
  );
  console.error(`value leaked into the next transaction: ${leaked ? 'YES' : 'no'}`);
  if (!persisted || leaked || inside?.role !== 'app_rw') process.exit(1);
  console.error('OK: withDbContext is safe on the Data API.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
