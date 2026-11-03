import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  ExecuteStatementCommand,
  RecordsFormatType,
  RollbackTransactionCommand,
  type RDSDataClient,
} from '@aws-sdk/client-rds-data';
import type { Pool, PoolClient } from 'pg';
import { withResumeRetry } from './resume-retry';
import type { SqlExecutor, SqlTx } from './migrate';

/** `:name` placeholders (Data API style) → `$1` for node-postgres. Casts like `::uuid` are untouched. */
export function toPositional(sql: string, params: Record<string, string> = {}) {
  const values: string[] = [];
  const index = new Map<string, number>();
  const text = sql.replace(/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g, (match, name: string) => {
    if (!(name in params)) return match;
    if (!index.has(name)) {
      values.push(params[name]!);
      index.set(name, values.length);
    }
    return `$${index.get(name)}`;
  });
  return { text, values };
}

export function pgExecutor(pool: Pool): SqlExecutor {
  const run = (client: PoolClient | Pool, sql: string, params?: Record<string, string>) => {
    const { text, values } = toPositional(sql, params);
    return client.query(text, values);
  };
  return {
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const tx: SqlTx = {
          exec: async (sql, params) => {
            await run(client, sql, params);
          },
        };
        const out = await fn(tx);
        await client.query('commit');
        return out;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async query(sql, params) {
      const res = await run(pool, sql, params);
      return res.rows;
    },
  };
}

export interface DataApiTarget {
  resourceArn: string;
  secretArn: string;
  database: string;
}

export function dataApiExecutor(client: RDSDataClient, target: DataApiTarget): SqlExecutor {
  const parameters = (params: Record<string, string> = {}) =>
    Object.entries(params).map(([name, value]) => ({ name, value: { stringValue: value } }));

  return {
    async transaction(fn) {
      const { transactionId } = await withResumeRetry(() => client.send(new BeginTransactionCommand(target)));
      try {
        const tx: SqlTx = {
          exec: async (sql, params) => {
            await client.send(
              new ExecuteStatementCommand({ ...target, sql, parameters: parameters(params), transactionId }),
            );
          },
        };
        const out = await fn(tx);
        await client.send(
          new CommitTransactionCommand({
            resourceArn: target.resourceArn,
            secretArn: target.secretArn,
            transactionId,
          }),
        );
        return out;
      } catch (err) {
        await client
          .send(
            new RollbackTransactionCommand({
              resourceArn: target.resourceArn,
              secretArn: target.secretArn,
              transactionId,
            }),
          )
          .catch(() => undefined);
        throw err;
      }
    },
    async query<T extends Record<string, unknown>>(sql: string, params?: Record<string, string>) {
      const res = await withResumeRetry(() =>
        client.send(
          new ExecuteStatementCommand({
            ...target,
            sql,
            parameters: parameters(params),
            formatRecordsAs: RecordsFormatType.JSON,
          }),
        ),
      );
      return JSON.parse(res.formattedRecords ?? '[]') as T[];
    },
  };
}
