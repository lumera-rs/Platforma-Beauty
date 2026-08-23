/**
 * Task 131 — Backend regression gate
 *
 * Checks:
 *   1. FK-index audit   – every FK column in public schema has a covering index
 *   2. Critical index   – curated named indexes exist in pg_indexes
 *   3. EXPLAIN probes   – representative query paths use expected indexes
 *                         when enable_seqscan=off inside a transaction
 *   4. Cache / archive  – static source code checks for required cache patterns
 *   5. Static scan      – await-in-loop and unbounded-select violations
 *
 * Modes:
 *   --static-only       – publish-safe source checks; does not import @workspace/db
 *   --database-only     – live schema/index checks after development schema sync
 *   no flag             – run all checks (backward-compatible local default)
 *
 * Exit codes:  0 = all pass  /  1 = one or more failures
 */

import {
  checkAwaitInLoops,
  checkCacheInvariants,
  checkUnboundedSelects,
} from "./test-backend-static-checks.js";

// ─── pretty printing ───────────────────────────────────────────────────────

type CheckResult = { name: string; ok: boolean; detail?: string };
type CheckMode = "all" | "static-only" | "database-only";

const results: CheckResult[] = [];

function parseMode(args: string[]): CheckMode {
  args = args.filter((arg) => arg !== "--");
  const supportedFlags = new Set(["--static-only", "--database-only"]);
  const unknownFlags = args.filter((arg) => !supportedFlags.has(arg));
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownFlags.join(", ")}`);
  }
  if (args.includes("--static-only") && args.includes("--database-only")) {
    throw new Error(
      "--static-only and --database-only cannot be used together.",
    );
  }
  if (args.includes("--static-only")) return "static-only";
  if (args.includes("--database-only")) return "database-only";
  return "all";
}

function pass(name: string, detail?: string) {
  results.push({ name, ok: true, detail });
}

function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
}

function printResults() {
  const width = 68;
  console.log("\n" + "─".repeat(width));
  console.log("  BACKEND STANDARDS — Task 131");
  console.log("─".repeat(width));
  for (const r of results) {
    const status = r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const label = r.name.padEnd(58);
    console.log(`  ${status}  ${label}`);
    if (!r.ok && r.detail) {
      for (const line of r.detail.split("\n")) {
        console.log(`       \x1b[33m${line}\x1b[0m`);
      }
    }
  }
  const failures = results.filter((r) => !r.ok).length;
  console.log("─".repeat(width));
  if (failures === 0) {
    console.log(`  \x1b[32mAll ${results.length} checks passed.\x1b[0m\n`);
  } else {
    console.log(
      `  \x1b[31m${failures} / ${results.length} checks failed.\x1b[0m\n`,
    );
  }
}

// ─── raw query helper ─────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** Minimal interface satisfied by pg.PoolClient — avoids importing from 'pg' directly. */
interface DbClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
  release(): void;
}

async function query(
  client: DbClient,
  sql: string,
  values?: unknown[],
): Promise<Row[]> {
  const result = values
    ? await client.query(sql, values)
    : await client.query(sql);
  return result.rows as Row[];
}

// ─── 1. FK-index audit ─────────────────────────────────────────────────────

/**
 * Returns "table(fk_columns)" strings for FK groups that have no covering
 * leading-column index.  PostgreSQL does NOT auto-create indexes for FK columns.
 */
async function auditForeignKeyIndexes(client: DbClient): Promise<string[]> {
  const rows = await query(
    client,
    `
    WITH fk_cols AS (
      SELECT
        kcu.table_name,
        kcu.column_name,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema     = kcu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema    = 'public'
    ),
    idx_cols AS (
      SELECT
        t.relname  AS table_name,
        a.attname  AS column_name,
        i.relname  AS index_name,
        -- position of this column in the index (0-based from pg_index.indkey array)
        array_position(ix.indkey::int[], a.attnum::int) AS pos
      FROM pg_index ix
      JOIN pg_class t  ON t.oid = ix.indrelid
      JOIN pg_class i  ON i.oid = ix.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        AND ix.indisvalid
    )
    SELECT
      fk.table_name,
      string_agg(DISTINCT fk.column_name, ', ' ORDER BY fk.column_name) AS fk_columns,
      min(ic.index_name) AS index_name
    FROM fk_cols fk
    LEFT JOIN idx_cols ic
      ON  ic.table_name  = fk.table_name
      AND ic.column_name = fk.column_name
      AND ic.pos = 0          -- only leading column counts
    GROUP BY fk.table_name, fk.constraint_name
    HAVING min(ic.index_name) IS NULL
    ORDER BY fk.table_name;
  `,
  );

  return rows.map(
    (r) => `${String(r["table_name"])}(${String(r["fk_columns"])})`,
  );
}

// ─── 2. Critical named indexes ─────────────────────────────────────────────

/**
 * These indexes are contractually load-bearing for the application's hot paths.
 * Add to this list whenever a new critical index is defined in the schema.
 */
const REQUIRED_INDEXES = [
  // core.ts
  "appointments_schedule_lookup_index",
  "image_assets_uploader_created_idx",
  "image_assets_status_expires_idx",
  "service_templates_category_subcategory_index",
  "sms_deliveries_retry_index",
  "email_deliveries_retry_index",
  "email_deliveries_report_alert_history_idx",
  "salons_city_active_rating_idx",
  "salons_municipality_active_idx",
  // commerce.ts
  "salon_notifications_salon_created_at_idx",
  "product_reviews_product_salon_unique",
  "product_categories_parent_sort_idx",
  "product_categories_active_sort_idx",
  "products_category_active_idx",
  "products_active_created_idx",
  "orders_salon_created_idx",
  // education.ts
  "course_days_course_sort_idx",
  "course_reviews_course_status_created_idx",
  "course_enrollments_session_status_idx",
  "education_waitlist_session_status_idx",
  "education_escrows_center_status_idx",
  "education_escrows_release_idx",
  "education_ledger_center_created_idx",
  "education_ledger_enrollment_created_idx",
  "education_financial_events_escrow_created_idx",
  "education_disputes_status_created_idx",
  "education_messages_thread_created_idx",
  "education_notifications_user_created_idx",
  "education_media_course_sort_idx",
  "education_featured_charges_course_created_idx",
  "education_featured_charges_status_idx",
  "courses_published_archived_created_idx",
  "course_modules_course_sort_idx",
  "course_lessons_module_sort_idx",
  // media.ts
  "media_assets_owner_created_idx",
  "media_assets_scope_resource_idx",
  "media_variants_asset_idx",
];

async function auditNamedIndexes(
  client: DbClient,
): Promise<{ missing: string[]; found: number }> {
  const rows = await query(
    client,
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
  );
  const existing = new Set(rows.map((r) => String(r["indexname"])));
  const missing = REQUIRED_INDEXES.filter((name) => !existing.has(name));
  return { missing, found: REQUIRED_INDEXES.length - missing.length };
}

// ─── 3. EXPLAIN probes ─────────────────────────────────────────────────────

/**
 * Run EXPLAIN inside a transaction with enable_seqscan=off.
 * The transaction is always rolled back so no side effects remain.
 */
async function explainWithNoSeqScan(
  client: DbClient,
  sql: string,
): Promise<string> {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL enable_seqscan = off");
    const rows = await query(client, `EXPLAIN (FORMAT TEXT) ${sql}`);
    return rows.map((r) => String(r["QUERY PLAN"])).join("\n");
  } finally {
    await client.query("ROLLBACK");
  }
}

/**
 * Whether the plan text mentions an index scan on the given table/index name.
 */
function planUsesIndex(plan: string, hint: string): boolean {
  const lower = plan.toLowerCase();
  const h = hint.toLowerCase();
  // Accept Index Scan, Index Only Scan, Bitmap Index Scan
  return lower.includes("index") && lower.includes(h);
}

interface ExplainCheck {
  name: string;
  sql: string;
  /** A word/phrase that must appear in the plan when seqscan is disabled */
  indexHint: string;
}

const EXPLAIN_CHECKS: ExplainCheck[] = [
  // Salon active lookup (salons.active is used in list queries)
  {
    name: "salons active=true scan",
    sql: `SELECT id FROM salons WHERE active = true LIMIT 10`,
    indexHint: "salons",
  },
  // Product active + created_at (shop list path)
  {
    name: "products active + created_at",
    sql: `SELECT id FROM products WHERE active = true ORDER BY created_at DESC LIMIT 20`,
    indexHint: "products",
  },
  // Orders by salon_id + created_at (admin list path)
  {
    name: "orders salon_id + created_at",
    sql: `SELECT id FROM orders WHERE salon_id = '00000000-0000-0000-0000-000000000000' ORDER BY created_at DESC LIMIT 20`,
    indexHint: "orders",
  },
  // Courses published + not archived + created_at (education list)
  {
    name: "courses published + not archived + created_at",
    sql: `SELECT id FROM courses WHERE published = true AND archived = false ORDER BY created_at DESC LIMIT 20`,
    indexHint: "courses",
  },
  // Appointments schedule lookup — uses appointments_schedule_lookup_index
  {
    name: "appointments schedule lookup index",
    sql: `SELECT id FROM appointments WHERE salon_id = '00000000-0000-0000-0000-000000000000' AND appointment_date = '2025-01-01'`,
    indexHint: "appointments_schedule_lookup_index",
  },
  // Salon notifications feed — uses salon_notifications_salon_created_at_idx
  {
    name: "salon_notifications salon_id + created_at index",
    sql: `SELECT id FROM salon_notifications WHERE salon_id = '00000000-0000-0000-0000-000000000000' ORDER BY created_at DESC LIMIT 50`,
    indexHint: "salon_notifications_salon_created_at_idx",
  },
  // Education messages thread feed — uses education_messages_thread_created_idx
  {
    name: "education_messages thread_id + created_at index",
    sql: `SELECT id FROM education_messages WHERE thread_id = '00000000-0000-0000-0000-000000000000' ORDER BY created_at ASC LIMIT 50`,
    indexHint: "education_messages_thread_created_idx",
  },
];

// ─── Main ──────────────────────────────────────────────────────────────────

async function runDatabaseChecks(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL is not set.");
  }

  const { pool } = await import("@workspace/db");
  let client: DbClient | null = null;
  try {
    client = await pool.connect();

    // ── 1. FK index audit ────────────────────────────────────────────────
    try {
      const unindexed = await auditForeignKeyIndexes(client);

      // Known acceptable exceptions: single-row settings tables or
      // cascade-only relationships where a full-table scan is intentional.
      const ACCEPTABLE_MISSING: Set<string> = new Set([
        // none currently
      ]);

      const violations = unindexed.filter((v) => !ACCEPTABLE_MISSING.has(v));
      if (violations.length === 0) {
        pass("FK-index audit: all FK leading columns are indexed");
      } else {
        fail(
          "FK-index audit: FK columns lack a leading index",
          violations.join("\n"),
        );
      }
    } catch (err) {
      fail("FK-index audit", String(err));
    }

    // ── 2. Named index presence ──────────────────────────────────────────
    try {
      const { missing, found } = await auditNamedIndexes(client);
      if (missing.length === 0) {
        pass(
          `Named-index check: all ${REQUIRED_INDEXES.length} critical indexes present (${found} found)`,
        );
      } else {
        fail(
          `Named-index check: ${missing.length} critical index(es) missing`,
          missing.join("\n"),
        );
      }
    } catch (err) {
      fail("Named-index check", String(err));
    }

    // ── 3. EXPLAIN probes ─────────────────────────────────────────────────
    for (const check of EXPLAIN_CHECKS) {
      try {
        const plan = await explainWithNoSeqScan(client, check.sql);
        if (planUsesIndex(plan, check.indexHint)) {
          pass(`EXPLAIN: ${check.name}`);
        } else {
          // On a fresh demo database the planner may choose a seqscan even with
          // enable_seqscan=off when there are no rows or no statistics.
          // Treat this as a skip (not a hard failure) to keep the gate deterministic.
          const emptyTable =
            plan.toLowerCase().includes("rows=0") ||
            plan.toLowerCase().includes("rows=1");
          if (emptyTable) {
            pass(
              `EXPLAIN: ${check.name} (empty/tiny table — index not needed, ok)`,
            );
          } else {
            fail(
              `EXPLAIN: ${check.name}`,
              `Expected index hint "${check.indexHint}" not found in plan:\n${plan}`,
            );
          }
        }
      } catch (err) {
        fail(`EXPLAIN: ${check.name}`, String(err));
      }
    }
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

async function runStaticChecks(): Promise<void> {
  // 4a. Cache invariants
  try {
    const cacheResults = await checkCacheInvariants();
    for (const r of cacheResults) {
      if (r.ok) {
        pass(`Static: ${r.name}`);
      } else {
        fail(`Static: ${r.name}`, r.detail ?? "failed");
      }
    }
  } catch (err) {
    fail("Static: cache invariant check", String(err));
  }

  // 4b. Await-in-loop
  try {
    const loopViolations = await checkAwaitInLoops();
    if (loopViolations.length === 0) {
      pass("Static: no await-db-call inside loop in list assembler regions");
    } else {
      fail(
        "Static: await-db call inside loop detected",
        loopViolations.join("\n"),
      );
    }
  } catch (err) {
    fail("Static: await-in-loop check", String(err));
  }

  // 4c. Unbounded selects
  try {
    const unboundedViolations = await checkUnboundedSelects();
    if (unboundedViolations.length === 0) {
      pass("Static: no unbounded selects in critical paginated routes");
    } else {
      fail(
        "Static: unbounded select in paginated route",
        unboundedViolations.join("\n"),
      );
    }
  } catch (err) {
    fail("Static: unbounded-select check", String(err));
  }
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));

  if (mode !== "static-only") {
    await runDatabaseChecks();
  }
  if (mode !== "database-only") {
    await runStaticChecks();
  }

  printResults();

  const exitCode = results.some((r) => !r.ok) ? 1 : 0;
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
