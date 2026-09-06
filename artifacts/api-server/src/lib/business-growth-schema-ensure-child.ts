/**
 * Standalone helper process for the Task #11A regression tests
 * (business-growth-schema-cleanup-reports.test.ts,
 * business-growth-schema-boot-regression.test.ts).
 *
 * ensureBusinessGrowthSchema() always operates against whatever database
 * @workspace/db's shared pool was bound to at module-import time (i.e.
 * process.env.DATABASE_URL when this process started) -- it cannot be
 * pointed at a different database mid-process. Exercising it against
 * several different disposable databases/states therefore requires a
 * genuinely separate child process per scenario, which is exactly what
 * this script is for: the parent test sets DATABASE_URL to a disposable
 * database it provisioned and fully controls, optionally asks this child
 * to force a specific rollout state first, then calls the real function.
 */
import { pool } from "@workspace/db";
import { BUSINESS_GROWTH_SCHEMA_VERSION, ensureBusinessGrowthSchema } from "./business-growth-schema";

async function run(): Promise<void> {
  const scenario = process.env.LUMERA_TEST_SCHEMA_SCENARIO;

  if (scenario === "broken-current-version") {
    // Deliberately construct the exact broken state Task #11 found: the
    // rollout tracker already reads as current, without ever having run
    // the historical DDL that (pre-fix) was the only place
    // education_salon_cleanup_reports got created. `drizzle-kit push`
    // (used to schema-push this disposable database) already created
    // business_growth_schema_rollout empty, since that table is also
    // declared in the static Drizzle schema -- this INSERT is exactly the
    // "version populated without running the real rollout" step that
    // produces the broken state.
    await pool.query(
      `INSERT INTO business_growth_schema_rollout (singleton, version, completed_at)
       VALUES (true, $1, now())
       ON CONFLICT (singleton) DO UPDATE SET version = EXCLUDED.version, completed_at = EXCLUDED.completed_at`,
      [BUSINESS_GROWTH_SCHEMA_VERSION],
    );
  }

  await ensureBusinessGrowthSchema();

  if (scenario === "healthy-repeat") {
    // Call it again in the same process to prove a second call against an
    // already-fully-migrated database is idempotent (no duplicate-row
    // error, no destructive change).
    await ensureBusinessGrowthSchema();
  }

  console.log("CHILD_OK");
}

run()
  .then(() => pool.end())
  .catch(async (error: unknown) => {
    console.error("CHILD_ERROR", error instanceof Error ? error.stack ?? error.message : error);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
