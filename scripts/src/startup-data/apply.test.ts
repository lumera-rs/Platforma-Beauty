import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";
import pg from "pg";
import ts from "typescript";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import { explicitAdminUrlFromArgs, withOwnedDisposableDatabase } from "../startup-equivalence/fixtures";
import { loadMigrations } from "../migrations/files";
import { applyStartupData, loadDataStep, type DataStep } from "./apply";
import { DATA_STEP_CHECKSUMS } from "./manifest";

assertDestructiveTestRuntimeAllowed(process.env, "Startup data application tests");
const adminUrl = explicitAdminUrlFromArgs();
const skip = adminUrl ? undefined : "Pass --admin-url=postgres://<owner>@127.0.0.1:<non-5432-port>/<db>";
const sourcePath = fileURLToPath(new URL("../../../artifacts/api-server/src/lib/business-growth-schema.ts", import.meta.url));

type Pool = pg.Pool;
type Queryable = Pick<Pool, "query">;

async function canonical(pool: Pool): Promise<void> {
  const [migration] = await loadMigrations();
  assert.equal(migration?.id, "000001");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(migration!.body);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function fixture(callback: (pool: Pool) => Promise<void>): Promise<void> {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    pool.on("error", () => undefined);
    await canonical(pool);
    await callback(pool);
  });
}

async function step(pool: Pool, id: DataStep): Promise<void> {
  const client = await pool.connect();
  try {
    await applyStartupData(client, id);
  } finally {
    client.release();
  }
}

async function rows(pool: Queryable, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await pool.query(sql, params)).rows as Record<string, unknown>[];
}

async function scalar(pool: Queryable, sql: string, params: unknown[] = []): Promise<unknown> {
  const result = await pool.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

const referenceTables = [
  "suppliers", "beauty_job_platform_settings", "beauty_job_categories",
  "shop_settings", "b2c_display_settings", "aftercare_settings",
  "education_placement_settings", "education_b2b_discount_settings",
] as const;

async function snapshotTables(pool: Queryable, tables: readonly string[] = referenceTables): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const table of tables) {
    result[table] = (await pool.query(
      `SELECT to_jsonb(t) AS row FROM public."${table}" t ORDER BY to_jsonb(t)::text`,
    )).rows.map((row) => row.row);
  }
  return result;
}

function independentlyGeneratedEquivalent(table: string, value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  if (table !== "suppliers" && table !== "education_b2b_discount_settings") delete result["id"];
  for (const key of ["created_at", "updated_at", "completed_at"]) delete result[key];
  return result;
}

function normalizeSnapshot(snapshot: Record<string, unknown[]>): Record<string, unknown[]> {
  return Object.fromEntries(Object.entries(snapshot).map(([table, values]) => [
    table,
    values.map((value) => independentlyGeneratedEquivalent(table, value as Record<string, unknown>))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  ]));
}

async function sourceOperationsInLines(start: number, end: number, predicate: RegExp): Promise<string[]> {
  const source = readFileSync(sourcePath, "utf8");
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const matches: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      const text = node.getText(file).slice(1, -1).replaceAll("${s}", "public");
      if (line >= start && line <= end && predicate.test(text)) matches.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return matches;
}

async function executeOriginalReference(pool: Pool): Promise<void> {
  const operations = [
    ...referenceTables.flatMap((table) => sourceLiteralsFor(table)),
  ];
  assert.equal(new Set(operations).size, 8);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const operation of operations) await client.query(operation);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function executeOriginalEducationPlanOperations(pool: Pool): Promise<void> {
  const operations = await sourceOperationsInLines(
    4605, 4640, /\b(?:INSERT|UPDATE)\s+/iu,
  );
  assert.ok(operations.length >= 5, `Expected bounded subscription reconciliation operations, got ${operations.length}`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const operation of operations) await client.query(operation);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function createTenantRelations(pool: Pool): Promise<{ readonly categoryIds: readonly string[] }> {
  const users = [
    "00000000-0000-4000-8000-0000000000a1",
    "00000000-0000-4000-8000-0000000000b2",
  ];
  await pool.query(`INSERT INTO public.users (id,first_name,last_name,email,password_hash,role)
    VALUES ($1,'Tenant','A','tenant-a@example.test','test-hash','CUSTOMER'),
           ($2,'Tenant','B','tenant-b@example.test','test-hash','CUSTOMER')`, users);
  const salons = [
    "00000000-0000-4000-8000-0000000000c3",
    "00000000-0000-4000-8000-0000000000d4",
  ];
  await pool.query(`INSERT INTO public.salons
    (id,owner_id,name,slug,city,municipality,address,phone,email,short_description,description,image_url)
    VALUES ($1,$3,'Tenant A','tenant-a-salon','Beograd','Beograd','A 1','+3811','a@example.test','A','A',''),
           ($2,$4,'Tenant B','tenant-b-salon','Novi Sad','Novi Sad','B 1','+3812','b@example.test','B','B','')`,
    [...salons, ...users]);
  const categories = await rows(pool, `INSERT INTO public.beauty_job_categories
    (slug,name,subtype_labels,enabled) VALUES
    ('tenant-a-category','Tenant A','[]',true),('tenant-b-category','Tenant B','[]',true)
    RETURNING id::text,slug`);
  await pool.query(`INSERT INTO public.beauty_job_listings
    (category_id,salon_id,posted_by_type,type,title,description,city,region,expires_at)
    VALUES ($1,$3,'salon','job','A','A','Belgrade','BG',now()+interval '1 day'),
           ($2,$4,'salon','job','B','B','Novi Sad','NS',now()+interval '1 day')`,
    [categories[0]!.id, categories[1]!.id, ...salons]);
  const suppliers = [
    "00000000-0000-4000-8000-0000000000e5",
    "00000000-0000-4000-8000-0000000000f6",
  ];
  await pool.query(`INSERT INTO public.suppliers (id,name,slug,scope)
    VALUES ($1,'Tenant A','tenant-a','BOTH'),($2,'Tenant B','tenant-b','BOTH')`, suppliers);
  await pool.query(`INSERT INTO public.product_categories (supplier_id,name,slug)
    VALUES ($1,'Tenant A product','tenant-a-product'),($2,'Tenant B product','tenant-b-product')`, suppliers);
  return { categoryIds: categories.map((category) => String(category.id)) };
}

function sourceLiteralsFor(table: string): string[] {
  const source = readFileSync(sourcePath, "utf8");
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const matches: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.getText(file).slice(1, -1).replaceAll("${s}", "public");
      if (/\bINSERT\s+INTO\s+public\./iu.test(text) && text.includes(`public.${table}`)) matches.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return matches;
}

test("data-step hashes and source literals are pinned without importing startup owners", { skip }, async () => {
  assert.deepEqual(Object.keys(DATA_STEP_CHECKSUMS).sort(), [
    "000001_startup_reference_data",
    "000002_education_fallback_plans",
  ]);
  for (const [id, checksum] of Object.entries(DATA_STEP_CHECKSUMS)) {
    const content = await loadDataStep(id as DataStep);
    assert.equal(createHash("sha256").update(content).digest("hex"), checksum);
  }
  const source = readFileSync(sourcePath, "utf8");
  const expected = [
    "suppliers", "beauty_job_platform_settings", "beauty_job_categories",
    "shop_settings", "b2c_display_settings", "aftercare_settings",
    "education_placement_settings", "education_b2b_discount_settings",
  ];
  for (const table of expected) {
    const literals = sourceLiteralsFor(table);
    assert.equal(literals.length, 1, table);
    assert.match(literals[0]!, /INSERT\s+INTO\s+public\./iu);
  }
  const planLiterals = sourceLiteralsFor("subscription_plans");
  assert.ok(planLiterals.some((literal) => /Education Start/iu.test(literal)));
  assert.ok(planLiterals.some((literal) => /Education Academy/iu.test(literal)));
  assert.match(source, /UPDATE\s+\$\{s\}\.subscription_plans/iu);
});

test("fresh reference step reproduces exact fixed and default business fields", { skip }, async () => {
  await fixture(async (pool) => {
    await step(pool, "000001_startup_reference_data");
    assert.deepEqual(await rows(pool, "SELECT id::text,name,slug,scope,active FROM public.suppliers"), [{
      id: "9b5970ea-0a8c-5e60-9d32-2a09f0890560", name: "LUMERA Legacy Catalog",
      slug: "lumera-legacy", scope: "BOTH", active: true,
    }]);
    assert.deepEqual(await rows(pool, "SELECT listing_expiry_days,hourly_posting_limit FROM public.beauty_job_platform_settings"), [
      { listing_expiry_days: 30, hourly_posting_limit: 5 },
    ]);
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.beauty_job_categories"), 17);
    assert.deepEqual(await rows(pool, "SELECT slug FROM public.beauty_job_categories ORDER BY slug")
      .then((items) => items.map((item) => item.slug)), [
      "barberi", "estetika-anti-aging", "estetika-masaza", "freelance-angazmani",
      "frizeri", "iznajmljivanje-opreme", "iznajmljivanje-prostora-stolice",
      "kozmeticari", "kozmetika", "lash-brow", "make-up", "masaza-terapeuti",
      "nokti", "pmu", "pomocno-osoblje", "sminkeri", "tattoo-piercing",
    ]);
    assert.deepEqual(await rows(pool, "SELECT show_loyalty_points,points_per_100_rsd,low_stock_threshold,default_delivery_business_days FROM public.shop_settings"), [
      { show_loyalty_points: true, points_per_100_rsd: 1, low_stock_threshold: 5, default_delivery_business_days: 3 },
    ]);
    assert.deepEqual(await rows(pool, "SELECT page_size,show_out_of_stock,recently_viewed_enabled,recently_viewed_max,version FROM public.b2c_display_settings"), [
      { page_size: 24, show_out_of_stock: true, recently_viewed_enabled: true, recently_viewed_max: 12, version: 1 },
    ]);
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.aftercare_settings WHERE version=1 AND is_current"), 1);
    assert.deepEqual(await rows(pool, "SELECT kind,scope,price,slot_count,duration_days FROM public.education_placement_settings"), [
      { kind: "featured_salon", scope: "home", price: 5000, slot_count: 12, duration_days: 30 },
    ]);
    assert.deepEqual(await rows(pool, "SELECT id,version FROM public.education_b2b_discount_settings"), [{ id: true, version: 1 }]);
    assert.equal(await scalar(pool, "SELECT to_regclass('public.lumera_migration_ledger')"), null);
  });
});

test("original eight reference SQL and explicit step match every business field", { skip }, async () => {
  let original: Record<string, unknown[]>;
  let replacement: Record<string, unknown[]>;
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    pool.on("error", () => undefined);
    await canonical(pool);
    await executeOriginalReference(pool);
    original = await snapshotTables(pool);
  });
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    pool.on("error", () => undefined);
    await canonical(pool);
    await step(pool, "000001_startup_reference_data");
    replacement = await snapshotTables(pool);
  });
  assert.deepEqual(normalizeSnapshot(replacement!), normalizeSnapshot(original!));
  assert.equal((replacement!.suppliers as unknown[]).length, (original!.suppliers as unknown[]).length);
  assert.equal((replacement!.education_b2b_discount_settings as unknown[]).length, 1);
});

test("reference step repeats without overwriting custom singleton or supplier data", { skip }, async () => {
  await fixture(async (pool) => {
    await step(pool, "000001_startup_reference_data");
    await pool.query("UPDATE public.suppliers SET name='Tenant A catalog' WHERE slug='lumera-legacy'");
    await pool.query("UPDATE public.shop_settings SET points_per_100_rsd=77");
    await pool.query("UPDATE public.b2c_display_settings SET page_size=88");
    await pool.query("UPDATE public.aftercare_settings SET version=42");
    await pool.query("UPDATE public.education_placement_settings SET price=9001");
    await pool.query("UPDATE public.education_b2b_discount_settings SET version=9");
    await createTenantRelations(pool);
    const before = await snapshotTables(pool);
    await step(pool, "000001_startup_reference_data");
    assert.deepEqual(await snapshotTables(pool), before);
  });
});

test("matching partial category preserves its complete row while adding the other sixteen", { skip }, async () => {
  await fixture(async (pool) => {
    const row = await rows(pool, `INSERT INTO public.beauty_job_categories
      (id,slug,name,subtype_labels,enabled,feature_flag,created_at,updated_at)
      VALUES ('00000000-0000-4000-8000-000000000011','frizeri','Frizeri',
        '["Ženski frizer", "Muški frizer", "Kolorista"]',true,NULL,
        '2020-01-01+00','2020-01-02+00') RETURNING to_jsonb(beauty_job_categories) AS row`);
    await step(pool, "000001_startup_reference_data");
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.beauty_job_categories"), 17);
    assert.deepEqual((await rows(pool, "SELECT to_jsonb(t) AS row FROM public.beauty_job_categories t WHERE slug='frizeri'"))[0], row[0]);
  });
});

test("category payload conflict aborts all writes and preserves the conflicting row", { skip }, async () => {
  await fixture(async (pool) => {
    await pool.query(`INSERT INTO public.beauty_job_categories
      (slug,name,subtype_labels,enabled,feature_flag) VALUES
      ('frizeri','Tenant-owned label','["custom"]',false,'tenant_a')`);
    await assert.rejects(() => step(pool, "000001_startup_reference_data"), /STARTUP_DATA_CATEGORY_PAYLOAD_CONFLICT/u);
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.beauty_job_categories"), 1);
    assert.deepEqual(await rows(pool, "SELECT slug,name,subtype_labels,enabled,feature_flag FROM public.beauty_job_categories"), [
      { slug: "frizeri", name: "Tenant-owned label", subtype_labels: ["custom"], enabled: false, feature_flag: "tenant_a" },
    ]);
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.suppliers"), 0);
  });
});

test("independent supplier and category foreign-key records survive the step", { skip }, async () => {
  await fixture(async (pool) => {
    await step(pool, "000001_startup_reference_data");
    await createTenantRelations(pool);
    const before = await snapshotTables(pool);
    await step(pool, "000001_startup_reference_data");
    assert.deepEqual(await snapshotTables(pool), before);
    assert.deepEqual(await rows(pool, "SELECT c.slug,l.title FROM public.beauty_job_listings l JOIN public.beauty_job_categories c ON c.id=l.category_id ORDER BY l.title"), [
      { slug: "tenant-a-category", title: "A" }, { slug: "tenant-b-category", title: "B" },
    ]);
  });
});

test("supplier identity collision refuses without partial writes", { skip }, async () => {
  await fixture(async (pool) => {
    await pool.query("INSERT INTO public.suppliers (id,name,slug,scope) VALUES (gen_random_uuid(),'Other','lumera-legacy','BOTH')");
    await assert.rejects(() => step(pool, "000001_startup_reference_data"), /STARTUP_DATA_SUPPLIER_IDENTITY_CONFLICT/u);
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.suppliers"), 1);
  });
});

test("fallback plans support empty and exact partial unreferenced state only", { skip }, async () => {
  await fixture(async (pool) => {
    await step(pool, "000002_education_fallback_plans");
    assert.deepEqual(await rows(pool, "SELECT name,price,trial_days,features,limits,audience,course_limit,vat_included,price_copy,active FROM public.subscription_plans ORDER BY course_limit"), [
      { name: "Education Start", price: 0, trial_days: 30, features: [], limits: { courses: 5 }, audience: "education", course_limit: 5, vat_included: true, price_copy: "Cena uključuje PDV.", active: false },
      { name: "Education Growth", price: 0, trial_days: 30, features: [], limits: { courses: 15 }, audience: "education", course_limit: 15, vat_included: true, price_copy: "Cena uključuje PDV.", active: false },
      { name: "Education Academy", price: 0, trial_days: 30, features: [], limits: { courses: 30 }, audience: "education", course_limit: 30, vat_included: true, price_copy: "Cena uključuje PDV.", active: false },
    ]);
  });
  await fixture(async (pool) => {
    await pool.query(`INSERT INTO public.subscription_plans
      (name,price,trial_days,features,limits,audience,course_limit,vat_included,price_copy,active)
      VALUES ('Education Start',0,30,'[]','{"courses":5}','education',5,true,'Cena uključuje PDV.',false)`);
    await step(pool, "000002_education_fallback_plans");
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.subscription_plans"), 3);
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.subscription_plans WHERE course_limit=15"), 1);
  });
});

test("bounded original education-plan reconciliation matches fallback step on empty and exact partial fixtures", { skip }, async () => {
  for (const partial of [false, true]) {
    let original: Record<string, unknown[]>;
    let replacement: Record<string, unknown[]>;
    await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
      pool.on("error", () => undefined);
      await canonical(pool);
      if (partial) await pool.query(`INSERT INTO public.subscription_plans
        (name,price,trial_days,features,limits,audience,course_limit,vat_included,price_copy,active)
        VALUES ('Education Start',0,30,'[]','{"courses":5}','education',5,true,'Cena uključuje PDV.',false)`);
      await executeOriginalEducationPlanOperations(pool);
      original = await snapshotTables(pool, ["subscription_plans"]);
    });
    await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
      pool.on("error", () => undefined);
      await canonical(pool);
      if (partial) await pool.query(`INSERT INTO public.subscription_plans
        (name,price,trial_days,features,limits,audience,course_limit,vat_included,price_copy,active)
        VALUES ('Education Start',0,30,'[]','{"courses":5}','education',5,true,'Cena uključuje PDV.',false)`);
      await step(pool, "000002_education_fallback_plans");
      replacement = await snapshotTables(pool, ["subscription_plans"]);
    });
    assert.deepEqual(normalizeSnapshot(replacement!), normalizeSnapshot(original!));
  }
});

test("any custom, nullable-tier, duplicate, or related plan blocks and preserves rows", { skip }, async () => {
  for (const sql of [
    `INSERT INTO public.subscription_plans (name,price,course_limit,audience) VALUES ('Custom',123,NULL,'salon')`,
    `INSERT INTO public.subscription_plans (name,price,course_limit,audience) VALUES ('Non-education Tier',123,30,'salon')`,
    `INSERT INTO public.subscription_plans (name,price,course_limit,audience) VALUES ('Custom Tier',123,5,'education')`,
    `INSERT INTO public.subscription_plans (name,price,course_limit,audience) VALUES ('Education Start',99,5,'education')`,
  ]) {
    await fixture(async (pool) => {
      await pool.query(sql);
      const before = await rows(pool, "SELECT id::text,name,price,course_limit,audience FROM public.subscription_plans");
      await assert.rejects(() => step(pool, "000002_education_fallback_plans"), /STARTUP_DATA_EXISTING_PLANS_REQUIRE_RECONCILIATION/u);
      assert.deepEqual(await rows(pool, "SELECT id::text,name,price,course_limit,audience FROM public.subscription_plans"), before);
    });
  }
  await fixture(async (pool) => {
    const plan = await rows(pool, "INSERT INTO public.subscription_plans (name,price,audience) VALUES ('Referenced',10,'salon') RETURNING id::text");
    await pool.query(`INSERT INTO public.users (id,first_name,last_name,email,password_hash,role)
      VALUES ('00000000-0000-4000-8000-0000000000aa','Relation','Owner','relation@example.test','test','CUSTOMER')`);
    await pool.query(`INSERT INTO public.salons
      (id,owner_id,name,slug,city,municipality,address,phone,email,short_description,description,image_url)
      VALUES ('00000000-0000-4000-8000-0000000000bb','00000000-0000-4000-8000-0000000000aa',
        'Relation','relation-salon','Belgrade','Belgrade','R 1','+3813','r@example.test','R','R','')`);
    await pool.query("INSERT INTO public.subscriptions (salon_id,plan_id,status,due_amount) VALUES ('00000000-0000-4000-8000-0000000000bb',$1,'trial',0)", [plan[0]!.id]);
    const before = await rows(pool, "SELECT count(*)::int AS count FROM public.subscriptions");
    await assert.rejects(() => step(pool, "000002_education_fallback_plans"), /STARTUP_DATA_PLAN_RELATIONSHIPS_REQUIRE_RECONCILIATION/u);
    assert.deepEqual(await rows(pool, "SELECT count(*)::int AS count FROM public.subscriptions"), before);
  });
});

test("contract drift and missing table fail closed before data writes", { skip }, async () => {
  await fixture(async (pool) => {
    await pool.query("ALTER TABLE public.shop_settings ALTER COLUMN points_per_100_rsd SET DEFAULT 2");
    await assert.rejects(() => step(pool, "000001_startup_reference_data"), /STARTUP_DATA_UNSUPPORTED_TABLE_CONTRACT/u);
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.suppliers"), 0);
  });
  await fixture(async (pool) => {
    await pool.query("DROP TABLE public.shop_settings CASCADE");
    await assert.rejects(() => step(pool, "000001_startup_reference_data"));
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.suppliers"), 0);
  });
});

test("parallel reference replays serialize and never duplicate rows or ledger", { skip }, async () => {
  await fixture(async (pool) => {
    const results = await Promise.all([
      step(pool, "000001_startup_reference_data"),
      step(pool, "000001_startup_reference_data"),
    ]);
    assert.equal(results.length, 2);
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.suppliers"), 1);
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.beauty_job_categories"), 17);
    assert.equal(await scalar(pool, "SELECT to_regclass('public.lumera_migration_ledger')"), null);
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.business_growth_schema_rollout"), 0);
    assert.equal(await scalar(pool, "SELECT count(*)::int FROM public.education_salon_cleanup_reports"), 0);
  });
});