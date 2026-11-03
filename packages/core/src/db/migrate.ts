import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { splitSqlStatements } from './sql-split';

/**
 * Minimal statement executor shared by the local `pg` and the RDS Data API back ends, so the
 * same runner applies migrations in both places (05 §4).
 */
export interface SqlExecutor {
  /** Runs `fn` in one transaction; statements inside use `exec`/`query` on the given handle. */
  transaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T>;
  query<T extends Record<string, unknown>>(sql: string, params?: Record<string, string>): Promise<T[]>;
}

export interface SqlTx {
  exec(sql: string, params?: Record<string, string>): Promise<void>;
}

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

export async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => MIGRATION_FILE.test(f)).sort();
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(join(dir, name), 'utf8');
      return { name, sql, checksum: checksum(sql) };
    }),
  );
}

export function checksum(sql: string): string {
  // Line endings differ between Windows checkouts and CI; they must not change the checksum.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * Applies pending migrations in order, each in its own transaction, and records them in
 * `app.schema_migrations`. An applied file whose checksum changed stops the run: applied
 * migrations are never edited (05 §4).
 */
export async function migrate(db: SqlExecutor, migrations: Migration[]): Promise<MigrateResult> {
  await db.transaction(async (tx) => {
    await tx.exec('create schema if not exists app');
    await tx.exec(
      `create table if not exists app.schema_migrations (
         name text primary key,
         checksum text not null,
         applied_at timestamptz not null default now()
       )`,
    );
  });

  const rows = await db.query<{ name: string; checksum: string }>(
    'select name, checksum from app.schema_migrations',
  );
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));
  const result: MigrateResult = { applied: [], skipped: [] };

  for (const m of migrations) {
    const previous = applied.get(m.name);
    if (previous !== undefined) {
      if (previous !== m.checksum) {
        throw new Error(`Migration ${m.name} changed after it was applied; add a new migration instead.`);
      }
      result.skipped.push(m.name);
      continue;
    }
    await db.transaction(async (tx) => {
      for (const statement of splitSqlStatements(m.sql)) await tx.exec(statement);
      await tx.exec('insert into app.schema_migrations (name, checksum) values (:name, :checksum)', {
        name: m.name,
        checksum: m.checksum,
      });
    });
    result.applied.push(m.name);
  }
  return result;
}

/**
 * Gives `app_rw` a login password. DDL cannot take bind parameters, so the value is quoted as a
 * literal; generated passwords are alphanumeric, and quotes are escaped regardless.
 */
export async function setAppRolePassword(db: SqlExecutor, password: string): Promise<void> {
  if (password.length < 8) throw new Error('app_rw password is too short');
  const literal = `'${password.replace(/'/g, "''")}'`;
  await db.transaction((tx) => tx.exec(`alter role app_rw with login password ${literal}`));
}
