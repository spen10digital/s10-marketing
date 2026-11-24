/**
 * OPTIONAL: link EXISTING organizations and brands to Suite ids. New accounts never need this:
 * organizations and brands are created on first use from the Suite.
 *
 *   pnpm exec tsx scripts/link-suite-ids.ts --mapping <file.json>            dry run (default)
 *   pnpm exec tsx scripts/link-suite-ids.ts --mapping <file.json> --apply    write
 *
 * Connects with DATABASE_ADMIN_URL (the migration owner; the local Docker default if unset).
 * This script does not read AWS configuration and is not wired to Aurora: do not point it at a
 * shared database unless its owner asks you to. The mapping file is never committed; its format
 * is in docs/phases/suite-integration.md. Prints labels only, never ids of people or secrets.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { pgExecutor } from '../packages/core/src/db/executors';
import {
  applyLinkPlan,
  linkMappingSchema,
  planSuiteLinks,
  readLinkSnapshot,
} from '../packages/core/src/suite/link';

const LOCAL_ADMIN_URL = 'postgres://postgres:postgres@localhost:5432/s10_marketing';

async function main() {
  const { values } = parseArgs({
    options: { mapping: { type: 'string' }, apply: { type: 'boolean', default: false } },
  });
  if (!values.mapping) throw new Error('Pass --mapping <file.json>');
  const mapping = linkMappingSchema.parse(JSON.parse(readFileSync(values.mapping, 'utf8')));

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL ?? LOCAL_ADMIN_URL });
  try {
    const db = pgExecutor(pool);
    const plan = planSuiteLinks(mapping, await readLinkSnapshot(db));
    for (const a of plan.actions)
      console.error(`${values.apply ? 'link' : 'would link'}: ${a.kind} ${a.label}`);
    for (const u of plan.unchanged) console.error(`unchanged: ${u}`);
    for (const e of plan.errors) console.error(`ERROR: ${e}`);
    if (plan.errors.length) process.exitCode = 1;
    else if (values.apply) {
      await applyLinkPlan(db, plan);
      console.error(`Applied ${plan.actions.length} link(s).`);
    } else {
      console.error(`Dry run: ${plan.actions.length} link(s) planned. Pass --apply to write.`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
