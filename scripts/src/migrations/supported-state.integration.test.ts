import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import { explicitAdminUrlFromArgs, withOwnedDisposableDatabase } from "../startup-equivalence/fixtures";
import { adoptBaseline, applyMigrations, migrationStatus } from "./runner";
import { expectedDisposableTarget } from "./disposable-target-fixture";
import { ensureLedger, readLedger } from "./ledger";
import { loadMigrations } from "./files";

assertDestructiveTestRuntimeAllowed(process.env, "Supported migration state integration tests");
const adminUrl = explicitAdminUrlFromArgs();
const skip = adminUrl ? undefined : "Pass --admin-url=postgres://<owner>@127.0.0.1:<non-5432-port>/<db>";

type Client = Pick<pg.PoolClient, "query">;
const startupSourcePath = fileURLToPath(new URL(
  "../../../artifacts/api-server/src/lib/business-growth-schema.ts",
  import.meta.url,
));

async function withClient<T>(pool: pg.Pool, callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

async function baseline(pool: pg.Pool): Promise<void> {
  const migrations = await loadMigrations();
  const first = migrations.find((migration) => migration.id === "000001");
  assert.ok(first);
  await withClient(pool, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(first.body);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    await ensureLedger(client);
    await client.query(`
      INSERT INTO public.lumera_migration_ledger
        (migration_id,checksum,mode,state,finished_at)
      VALUES ($1,$2,$3,'APPLIED',clock_timestamp())
    `, [first.id, first.checksum, first.mode]);
  });
}

async function value(client: Client, sql: string, args: unknown[] = []): Promise<unknown> {
  const result = await client.query(sql, args);
  return Object.values(result.rows[0] ?? {})[0];
}

async function state(pool: pg.Pool): Promise<Record<string, unknown>> {
  return withClient(pool, async (client) => ({
    suppliers: await value(client, "SELECT count(*)::integer FROM public.suppliers"),
    categories: await value(client, "SELECT count(*)::integer FROM public.beauty_job_categories"),
    plans: await value(client, "SELECT count(*)::integer FROM public.subscription_plans"),
    cleanup: await value(client, "SELECT count(*)::integer FROM public.education_salon_cleanup_reports"),
    ledger: await value(client, "SELECT count(*)::integer FROM public.lumera_migration_ledger"),
  }));
}

async function assertNoLedger(pool: pg.Pool): Promise<void> {
  await withClient(pool, async (client) => {
    assert.equal(await value(client, "SELECT to_regclass('public.lumera_migration_ledger')"), null);
  });
}

const comparisonTables = [
  "suppliers", "beauty_job_platform_settings", "beauty_job_categories",
  "shop_settings", "b2c_display_settings", "aftercare_settings",
  "education_placement_settings", "education_b2b_discount_settings", "subscription_plans",
  "education_salon_cleanup_reports",
] as const;

async function snapshotComparison(pool: pg.Pool): Promise<Record<string, unknown[]>> {
  return withClient(pool, async (client) => {
    const snapshot: Record<string, unknown[]> = {};
    for (const table of comparisonTables) {
      snapshot[table] = (await client.query(
        `SELECT to_jsonb(t) AS row FROM public."${table}" t ORDER BY to_jsonb(t)::text`,
      )).rows.map((row) => row.row);
    }
    return snapshot;
  });
}

function normalizeComparison(snapshot: Record<string, unknown[]>): Record<string, unknown[]> {
  return Object.fromEntries(Object.entries(snapshot).map(([table, rows]) => [
    table,
    rows.map((raw) => {
      const row = { ...(raw as Record<string, unknown>) };
      if (table !== "suppliers" && table !== "education_b2b_discount_settings") delete row.id;
      for (const key of ["created_at", "updated_at", "completed_at"]) delete row[key];
      return row;
    }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  ]));
}

function normalizeExistingConfiguration(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((entry) => {
    const row = { ...entry, row: { ...(entry.row as Record<string, unknown>) } };
    const value = row.row as Record<string, unknown>;
    delete value.id;
    delete value.created_at;
    delete value.updated_at;
    return row;
  });
}

/**
 * Test-only oracle extraction. These are the pinned startup literals, not a
 * hand-written approximation. The bounded ranges deliberately cover only the
 * admitted reference seed, plan reconciliation and v99 cleanup DO.
 */
function extractOriginalStartupSql(
  startLine: number,
  endLine: number,
  predicate: (sql: string) => boolean,
): string[] {
  const source = readFileSync(startupSourcePath, "utf8");
  const file = ts.createSourceFile(startupSourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const result: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      if (line >= startLine && line <= endLine) {
        const sql = node.getText(file).slice(1, -1).replaceAll("${s}", "public");
        if (predicate(sql)) result.push(sql);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return result;
}

async function executeOriginalSupportedSql(pool: pg.Pool): Promise<void> {
  const reference = extractOriginalStartupSql(600, 4632, (sql) =>
    /\bINSERT\s+INTO\s+public\.(?:suppliers|beauty_job_platform_settings|beauty_job_categories|shop_settings|b2c_display_settings|aftercare_settings|education_placement_settings|education_b2b_discount_settings)\b/iu.test(sql));
  assert.equal(new Set(reference).size, 8, "reference oracle must contain one literal per admitted table");
  const plans = extractOriginalStartupSql(4787, 4822, (sql) => /^\s*(?:INSERT|UPDATE)\b/iu.test(sql));
  assert.ok(plans.length >= 5, "plan oracle must contain the bounded original operations");
  const cleanup = extractOriginalStartupSql(4566, 4637, (sql) => /^\s*DO\s+\$cleanup\$/iu.test(sql));
  assert.equal(cleanup.length, 1, "cleanup oracle must contain only the known v99 DO");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const sql of [...reference, ...plans, ...cleanup]) await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function insertLegitimateExistingConfiguration(pool: pg.Pool): Promise<void> {
  await withClient(pool, async (client) => {
    await client.query(`
      INSERT INTO public.suppliers (id,name,slug,scope,active)
      VALUES ('00000000-0000-4000-8000-0000000000e1','Existing supplier','existing-supplier','BOTH',true)
    `);
    await client.query(`
      INSERT INTO public.beauty_job_categories (slug,name,subtype_labels,enabled,feature_flag)
      VALUES ('existing-category','Existing category','["existing"]'::jsonb,true,'existing-flag')
    `);
    await client.query(`
      INSERT INTO public.shop_settings
        (show_loyalty_points,points_per_100_rsd,low_stock_threshold,default_delivery_business_days,
         seller_company_name,version)
      VALUES (false,9,8,11,'Existing seller',7)
    `);
    await client.query(`
      INSERT INTO public.aftercare_settings
        (version,is_current,cooldown_days,second_reminder_delay_days,personalized_bundle_discount_percent)
      VALUES (7,false,41,8,13)
    `);
    await client.query(`
      INSERT INTO public.education_placement_settings (kind,scope,price,slot_count,duration_days)
      VALUES ('featured_salon','home',9999,77,88)
    `);
  });
}

async function existingConfiguration(pool: pg.Pool): Promise<Record<string, unknown>[]> {
  return withClient(pool, async (client) => (await client.query(`
    SELECT 'supplier' AS kind,to_jsonb(s) AS row FROM public.suppliers s WHERE slug='existing-supplier'
    UNION ALL
    SELECT 'category',to_jsonb(c) FROM public.beauty_job_categories c WHERE slug='existing-category'
    UNION ALL
    SELECT 'shop',to_jsonb(s) FROM public.shop_settings s WHERE seller_company_name='Existing seller'
    UNION ALL
    SELECT 'aftercare',to_jsonb(a) FROM public.aftercare_settings a WHERE version=7
    UNION ALL
    SELECT 'placement',to_jsonb(p) FROM public.education_placement_settings p WHERE price=9999
    ORDER BY kind
  `)).rows);
}

async function insertEducationSubscriptionFixture(pool: pg.Pool, snapshots: boolean): Promise<void> {
  await withClient(pool, async (client) => {
    const user = "00000000-0000-4000-8000-0000000000f1";
    const center = "00000000-0000-4000-8000-0000000000f2";
    const subscription = "00000000-0000-4000-8000-0000000000f3";
    const plan = "00000000-0000-4000-8000-0000000000f4";
    await client.query(`
      INSERT INTO public.users (id,first_name,last_name,email,password_hash,role)
      VALUES ($1,'Subscription','Fixture','subscription@example.test','test-hash','CUSTOMER')
    `, [user]);
    await client.query(`
      INSERT INTO public.education_centers (id,owner_id,name,city,description,image_url)
      VALUES ($1,$2,'Subscription center','Test city','Subscription fixture','/subscription.png')
    `, [center, user]);
    await client.query(`
      INSERT INTO public.subscription_plans
        (id,name,price,trial_days,features,limits,audience,course_limit,vat_included,price_copy,active)
      VALUES ($1,'Education Start',0,30,'[]'::jsonb,'{"courses":5}'::jsonb,'education',5,true,'Cena uključuje PDV.',false)
    `, [plan]);
    await client.query(`
      INSERT INTO public.education_center_subscriptions
        (id,center_id,plan_id,status,due_amount,current_price_snapshot,current_course_limit_snapshot)
      VALUES ($1,$2,$3,'trial',0,$4,$5)
    `, [subscription, center, plan, snapshots ? 0 : null, snapshots ? 5 : null]);
  });
}

test("manifest exposes exactly the supported numbered state migration", { skip }, async () => {
  const migrations = await loadMigrations();
  assert.deepEqual(migrations.map((migration) => migration.id), ["000001", "000002", "000003"]);
  assert.equal(migrations[1]?.admissionContract, "supported-startup-v1");
  assert.match(migrations[1]?.checksum ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(migrations[1]?.mode, "transactional");
});

test("fresh default pipeline applies the full frontier, then repeats without data drift", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    const migrations = await loadMigrations();
    const first = await withClient(pool, (client) => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    assert.deepEqual(first.applied, ["000001", "000002", "000003"]);
    const before = await state(pool);
    const second = await withClient(pool, (client) => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.skipped, ["000001", "000002", "000003"]);
    assert.deepEqual(await state(pool), before);
    await withClient(pool, async (client) => {
      assert.deepEqual((await readLedger(client)).map((row) => [row.id, row.state]), [
        ["000001", "APPLIED"], ["000002", "APPLIED"], ["000003", "APPLIED"],
      ]);
    });
  });
});

test("existing canonical baseline admits supported data and preserves preexisting salon plan", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await baseline(pool);
    await withClient(pool, (client) => client.query(`
      INSERT INTO public.subscription_plans
        (name,price,trial_days,features,limits,audience,active)
      VALUES ('Existing salon',1200,14,'["legacy"]'::jsonb,'{"members":2}'::jsonb,'salon',true)
    `));
    const before = await withClient(pool, (client) => client.query(
      "SELECT name,price,trial_days,features,limits,audience,active FROM public.subscription_plans WHERE name='Existing salon'",
    ).then((result) => result.rows[0]));
    const result = await withClient(pool, (client) => applyMigrations(client, { expectedTargetIdentity: expectedDisposableTarget(pool) }));
    assert.deepEqual(result.applied, ["000002", "000003"]);
    const after = await withClient(pool, (client) => client.query(
      "SELECT name,price,trial_days,features,limits,audience,active FROM public.subscription_plans WHERE name='Existing salon'",
    ).then((result) => result.rows[0]));
    assert.deepEqual(after, before);
  });
});

test("existing canonical schema without ledger rejects before creating ledger", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    const migrations = await loadMigrations();
    await withClient(pool, async (client) => {
      await client.query(migrations[0]!.body);
    });
    await assert.rejects(
      () => withClient(pool, (client) => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) })),
      /existing schema without a migration ledger/u,
    );
    await assertNoLedger(pool);
  });
});

test("unsupported user rows fail before any ledger or reference write", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await baseline(pool);
    await withClient(pool, (client) => client.query(`
      INSERT INTO public.users (first_name,last_name,email,password_hash,role)
      VALUES ('Unsupported','Fixture','unsupported@example.test','not-a-real-secret','CUSTOMER')
    `));
    const before = await state(pool);
    await assert.rejects(
      () => withClient(pool, (client) => applyMigrations(client, { expectedTargetIdentity: expectedDisposableTarget(pool) })),
      /SUPPORTED_STARTUP_(?:UNSUPPORTED_DATA:users|CLEANUP_CANDIDATES_REQUIRE_PROVENANCE)/u,
    );
    assert.deepEqual(await state(pool), before);
    const rows = await withClient(pool, (client) => readLedger(client));
    assert.deepEqual(rows.map((row) => row.id), ["000001"]);
  });
});

test("category conflicts are rejected without overwriting the existing category", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await baseline(pool);
    await withClient(pool, (client) => client.query(`
      INSERT INTO public.beauty_job_categories
        (slug,name,subtype_labels,enabled,feature_flag)
      VALUES ('frizeri','Conflicting category','[]'::jsonb,false,NULL)
    `));
    const before = await withClient(pool, (client) => client.query(
      "SELECT name,subtype_labels,enabled,feature_flag FROM public.beauty_job_categories WHERE slug='frizeri'",
    ).then((result) => result.rows[0]));
    await assert.rejects(
      () => withClient(pool, (client) => applyMigrations(client, { expectedTargetIdentity: expectedDisposableTarget(pool) })),
      /SUPPORTED_STARTUP_CATEGORY_PAYLOAD_CONFLICT/u,
    );
    const after = await withClient(pool, (client) => client.query(
      "SELECT name,subtype_labels,enabled,feature_flag FROM public.beauty_job_categories WHERE slug='frizeri'",
    ).then((result) => result.rows[0]));
    assert.deepEqual(after, before);
    assert.deepEqual((await withClient(pool, (client) => readLedger(client))).map((row) => row.id), ["000001"]);
  });
});

test("fallback payload and historical plan relationships are fail-closed", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await baseline(pool);
    await withClient(pool, (client) => client.query(`
      INSERT INTO public.subscription_plans
        (name,price,trial_days,features,limits,audience,course_limit,vat_included,price_copy,active)
      VALUES ('Education Start',100,0,'["custom"]'::jsonb,'{"courses":99}'::jsonb,'education',99,false,'custom',true)
    `));
    const before = await state(pool);
    await assert.rejects(
      () => withClient(pool, (client) => applyMigrations(client, { expectedTargetIdentity: expectedDisposableTarget(pool) })),
      /SUPPORTED_STARTUP_FALLBACK_PAYLOAD_CONFLICT:Education Start/u,
    );
    assert.deepEqual(await state(pool), before);
  });
});

test("both empty and populated education snapshots with a live relationship reject unchanged", { skip }, async () => {
  for (const snapshots of [false, true]) {
    await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
      await baseline(pool);
      await insertEducationSubscriptionFixture(pool, snapshots);
      const before = await state(pool);
      await assert.rejects(
        () => withClient(pool, (client) => applyMigrations(client, { expectedTargetIdentity: expectedDisposableTarget(pool) })),
        /SUPPORTED_STARTUP_(?:CLEANUP_CANDIDATES_REQUIRE_PROVENANCE|UNSUPPORTED_DATA:users|PLAN_RELATIONSHIPS_REQUIRE_RECONCILIATION|HISTORICAL|RELATION)/u,
      );
      assert.deepEqual(await state(pool), before);
      assert.deepEqual((await withClient(pool, (client) => readLedger(client))).map((row) => row.id), ["000001"]);
      await withClient(pool, async (client) => {
        const row = await client.query(`
          SELECT current_price_snapshot,current_course_limit_snapshot
          FROM public.education_center_subscriptions
        `);
        assert.deepEqual(row.rows, snapshots ? [{ current_price_snapshot: 0, current_course_limit_snapshot: 5 }]
          : [{ current_price_snapshot: null, current_course_limit_snapshot: null }]);
      });
    });
  }
});

test("adoption creates only the 000001 baseline row; it never adopts 000002", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await withClient(pool, async (client) => {
      const migrations = await loadMigrations();
      await client.query(migrations[0]!.body);
      const result = await adoptBaseline(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) });
      assert.deepEqual(result.adopted, ["000001"]);
      assert.deepEqual((await readLedger(client)).map((row) => row.id), ["000001"]);
    });
  });
});

test("concurrent default applies produce one supported migration and no duplicate fallback rows", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await baseline(pool);
    const results = await Promise.all([
      withClient(pool, (client) => applyMigrations(client, { expectedTargetIdentity: expectedDisposableTarget(pool) })),
      withClient(pool, (client) => applyMigrations(client, { expectedTargetIdentity: expectedDisposableTarget(pool) })),
    ]);
    assert.equal(results.filter((result) => result.applied.includes("000002")).length, 1);
    await withClient(pool, async (client) => {
      assert.deepEqual((await client.query(
        "SELECT name,count(*)::integer AS count FROM public.subscription_plans WHERE audience='education' GROUP BY name ORDER BY name",
      )).rows, [
        { name: "Education Academy", count: 1 },
        { name: "Education Growth", count: 1 },
        { name: "Education Start", count: 1 },
      ]);
    });
  });
});

test("a preexisting ADOPTED 000002 row is rejected rather than treated as data evidence", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await baseline(pool);
    const migrations = await loadMigrations();
    await withClient(pool, async (client) => {
      await ensureLedger(client);
      await client.query(`
        INSERT INTO public.lumera_migration_ledger
          (migration_id,checksum,mode,state,finished_at)
        VALUES ($1,$2,$3,'ADOPTED',clock_timestamp())
      `, [migrations[1]!.id, migrations[1]!.checksum, migrations[1]!.mode]);
    });
    const beforeData = await snapshotComparison(pool);
    const beforeLedger = await withClient(pool, (client) => readLedger(client));
    await assert.rejects(
      () => withClient(pool, (client) => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) })),
      /LEDGER_DATA_MIGRATION_ADOPTED:000002/u,
    );
    assert.deepEqual(await snapshotComparison(pool), beforeData);
    assert.deepEqual(await withClient(pool, (client) => readLedger(client)), beforeLedger);
    await assert.rejects(
      () => withClient(pool, (client) => adoptBaseline(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) })),
      /LEDGER_DATA_MIGRATION_ADOPTED:000002/u,
    );
    assert.deepEqual(await snapshotComparison(pool), beforeData);
    assert.deepEqual(await withClient(pool, (client) => readLedger(client)), beforeLedger);
  });
});

test("paired original explicit data steps and 000002 agree on admitted reference/fallback rows", { skip }, async () => {
  let original: Record<string, unknown[]>;
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await baseline(pool);
    await executeOriginalSupportedSql(pool);
    original = await snapshotComparison(pool);
  });
  let replacement: Record<string, unknown[]>;
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await baseline(pool);
    await withClient(pool, (client) => applyMigrations(client, { expectedTargetIdentity: expectedDisposableTarget(pool) }));
    replacement = await snapshotComparison(pool);
  });
  assert.deepEqual(normalizeComparison(replacement!), normalizeComparison(original!));
});

test("legitimate existing reference/configuration rows are preserved byte-for-byte by both oracles", { skip }, async () => {
  let originalBefore: Record<string, unknown>[];
  let originalAfter: Record<string, unknown>[];
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await baseline(pool);
    await insertLegitimateExistingConfiguration(pool);
    originalBefore = await existingConfiguration(pool);
    await executeOriginalSupportedSql(pool);
    originalAfter = await existingConfiguration(pool);
  });
  assert.deepEqual(originalAfter!, originalBefore!);

  let replacementBefore: Record<string, unknown>[];
  let replacementAfter: Record<string, unknown>[];
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await baseline(pool);
    await insertLegitimateExistingConfiguration(pool);
    replacementBefore = await existingConfiguration(pool);
    await withClient(pool, (client) => applyMigrations(client, { expectedTargetIdentity: expectedDisposableTarget(pool) }));
    replacementAfter = await existingConfiguration(pool);
  });
  assert.deepEqual(replacementAfter!, replacementBefore!);
  assert.deepEqual(normalizeExistingConfiguration(replacementAfter!), normalizeExistingConfiguration(originalAfter!));
});

test("the converged voucher trigger still rejects mutation of immutable snapshot fields", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await withClient(pool, (client) => applyMigrations(client, { expectedTargetIdentity: expectedDisposableTarget(pool) }));
    const client = await pool.connect();
    try {
      const user = "00000000-0000-4000-8000-0000000000d1";
      const center = "00000000-0000-4000-8000-0000000000d2";
      const course = "00000000-0000-4000-8000-0000000000d3";
      const voucher = "00000000-0000-4000-8000-0000000000d4";
      await client.query("BEGIN");
      await client.query(`
        INSERT INTO public.users (id,first_name,last_name,email,password_hash,role)
        VALUES ($1,'Trigger','Tester','trigger@example.test','test-hash','CUSTOMER')
      `, [user]);
      await client.query(`
        INSERT INTO public.education_centers (id,owner_id,name,city,description,image_url)
        VALUES ($1,$2,'Trigger center','Test city','Trigger fixture','/trigger.png')
      `, [center, user]);
      await client.query(`
        INSERT INTO public.courses (id,center_id,title,category,format,price,duration,image_url)
        VALUES ($1,$2,'Trigger course','Testing','online',100,'1 day','/course.png')
      `, [course, center]);
      await client.query(`
        INSERT INTO public.education_gift_vouchers
          (id,course_id,center_id,purchaser_id,recipient_email,course_title_snapshot,
           course_image_url_snapshot,amount_snapshot,code_hash,code_last4,payment_reference)
        VALUES ($1,$2,$3,$4,'recipient@example.test','Trigger course','/course.png',
                100,'trigger-hash','1234','TRIGGER-1')
      `, [voucher, course, center, user]);
      await assert.rejects(
        () => client.query(
          "UPDATE public.education_gift_vouchers SET amount_snapshot=101 WHERE id=$1",
          [voucher],
        ),
        /Education gift voucher purchase snapshot is immutable/u,
      );
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });
});

test("backend termination after the outer transaction starts leaves no partial 000002 and retry applies it", { skip }, async () => {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    await baseline(pool);
    const interrupted = await pool.connect();
    interrupted.on("error", () => undefined);
    const pid = (await interrupted.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
    let terminated = false;
    try {
      await assert.rejects(() => applyMigrations({
        query: async (sql: string, params?: unknown[]) => {
          if (sql === "COMMIT" && !terminated) {
            terminated = true;
            await pool.query("SELECT pg_terminate_backend($1)", [pid]);
          }
          return interrupted.query(sql, params);
        },
      }, { expectedTargetIdentity: expectedDisposableTarget(pool) }));
    } finally {
      interrupted.release(true);
    }
    assert.equal(terminated, true);
    await withClient(pool, async (client) => {
      assert.equal(await value(client, "SELECT count(*)::integer FROM public.subscription_plans WHERE audience='education'"), 0);
      const result = await applyMigrations(client, { expectedTargetIdentity: expectedDisposableTarget(pool) });
      assert.deepEqual(result.applied, ["000002", "000003"]);
      assert.deepEqual((await readLedger(client)).map((row) => [row.id, row.state]), [
        ["000001", "APPLIED"], ["000002", "APPLIED"], ["000003", "APPLIED"],
      ]);
    });
  });
});