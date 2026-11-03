import 'server-only';
import { connectionFromConfig, createDatabase, type Database } from '@s10/core/db';
import { awsCredentials, AWS_REGION } from './aws';
import { getConfig } from './config';

let cached: Promise<Database> | undefined;

/**
 * Locally: Docker Postgres as app_rw (DATABASE_URL). On Vercel: Aurora through the RDS Data API
 * with the web role's OIDC credentials and the app_rw secret; there are no connections to pool.
 */
export function getDb(): Promise<Database> {
  cached ??= getConfig()
    .then((config) => {
      const connection = connectionFromConfig(config);
      return createDatabase(
        connection.kind === 'data-api'
          ? { ...connection, client: { region: AWS_REGION, credentials: awsCredentials() } }
          : connection,
      );
    })
    .catch((err: unknown) => {
      cached = undefined;
      throw err;
    });
  return cached;
}
