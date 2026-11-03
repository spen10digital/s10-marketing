import { RDSDataClient, type RDSDataClientConfig } from '@aws-sdk/client-rds-data';
import { drizzle as drizzleDataApi } from 'drizzle-orm/aws-data-api/pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { AppError } from '../errors/app-error';
import { schema, type Schema } from './schema';

/** One type for both back ends: node-postgres locally, the RDS Data API in AWS. */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;
export type DbTx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type DbConnection =
  | { kind: 'pg'; url: string }
  | {
      kind: 'data-api';
      resourceArn: string;
      secretArn: string;
      database: string;
      client?: Pick<RDSDataClientConfig, 'credentials' | 'region'>;
    };

export function createDatabase(connection: DbConnection): Database {
  if (connection.kind === 'pg') {
    // Locally the app connects as app_rw, so RLS applies exactly as in AWS.
    const pool = new pg.Pool({ connectionString: connection.url, max: 5 });
    return drizzlePg(pool, { schema }) as unknown as Database;
  }
  const client = new RDSDataClient({ region: 'us-east-2', ...connection.client });
  return drizzleDataApi(client, {
    schema,
    resourceArn: connection.resourceArn,
    secretArn: connection.secretArn,
    database: connection.database,
  }) as unknown as Database;
}

/** Picks the back end from config: DATABASE_URL locally, Data API ARNs in AWS. */
export function connectionFromConfig(config: {
  DATABASE_URL?: string;
  DB_CLUSTER_ARN?: string;
  DB_SECRET_ARN?: string;
  DB_NAME?: string;
}): DbConnection {
  if (config.DB_CLUSTER_ARN && config.DB_SECRET_ARN && config.DB_NAME) {
    return {
      kind: 'data-api',
      resourceArn: config.DB_CLUSTER_ARN,
      secretArn: config.DB_SECRET_ARN,
      database: config.DB_NAME,
    };
  }
  if (config.DATABASE_URL) return { kind: 'pg', url: config.DATABASE_URL };
  throw new AppError(
    'CONFIG_INVALID',
    'No database configured (DATABASE_URL or DB_CLUSTER_ARN/DB_SECRET_ARN/DB_NAME)',
  );
}
