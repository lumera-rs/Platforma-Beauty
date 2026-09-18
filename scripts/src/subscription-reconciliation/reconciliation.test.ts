import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import pg from "pg";
import { explicitAdminUrlFromArgs, withOwnedDisposableDatabase } from "../startup-equivalence/fixtures";
import { applyStartupData } from "../startup-data/apply";
import { createPlanFixture, canonical, snapshot, type Pool } from "./fixture";
import { inspectPlanReconciliation } from "./inspect";
import { OPERATION_NAMES, originalPlanOperations, STARTUP_SOURCE_SHA256 } from "./source";

const adminUrl = explicitAdminUrlFromArgs();
const skip = adminUrl ? undefined : "Pass --admin-url with the owned loopback test cluster";
const reportDir = "/tmp/lumera-plan-history-results";

async function fixture(callback: (pool: Pool) => Promise<void>): Promise<void> {
  await withOwnedDisposableDatabase(adminUrl!, async ({ pool }) => {
    pool.on("error", () => undefined);
    await canonical(pool);
    await callback(pool);
  });
}

async function original(pool: Pool): Promise<void> {
  for (const operation of originalPlanOperations()) await pool.query(operation.sql);
}

/** Test-only replay wrapper; mirrors the two locks held by the real startup
 * owner, but does not enable or authorize a replacement migration. */
async function originalWithStartupLocks(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('lumera:phase4:migrations'))");
    await client.query("SELECT pg_advisory_xact_lock(1111949377)");
    for (const operation of originalPlanOperations()) await client.query(operation.sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function report(name: string, value: unknown): Promise<void> {
  await mkdir(reportDir, { recursive: true });
  await writeFile(`${reportDir}/${name}.json`, JSON.stringify(value, null, 2));
}

test("historical extractor is source-pinned and returns nine ordered DML operations", { skip }, () => {
  const operations = originalPlanOperations();
  const source = readFileSync(fileURLToPath(new URL("../../../artifacts/api-server/src/lib/business-growth-schema.ts", import.meta.url)), "utf8");
  assert.equal(createHash("sha256").update(source).digest("hex"), STARTUP_SOURCE_SHA256);
  assert.deepEqual(operations.map((operation) => operation.name), [...OPERATION_NAMES]);
  assert.ok(operations[0]!.sql.includes("Education legacy"));
  assert.ok(operations.at(-1)!.sql.includes("current_price_snapshot"));
});

test("read-only inspection detects shared ownership and preserves every row", { skip }, async () => {
  await fixture(async (pool) => {
    await createPlanFixture(pool);
    const before = await snapshot(pool);
    const result = await inspectPlanReconciliation(pool as never);
    const after = await snapshot(pool);
    assert.equal(result.status, "BLOCKED_PENDING_CONTRACT_ACCEPTANCE");
    assert.equal(result.historicalWritesEnabled, false);
    assert.ok(result.findings.some((finding) => finding.code === "SHARED_PLAN_SPLIT_REQUIRES_APPROVED_MAPPING"));
    assert.ok(result.findings.some((finding) => finding.code === "PRESERVE_HISTORICAL_PAYMENT_PLAN_ID"));
    assert.ok(result.foreignKeys.length >= 4);
    assert.deepEqual(after, before);
    await report("inspection-shared-synthetic", result);
  });
});

test("original shared-plan replay clones and relinks education only, preserving salon and tenant IDs", { skip }, async () => {
  await fixture(async (pool) => {
    const ids = await createPlanFixture(pool);
    await original(pool);
    const rows = (await pool.query(`SELECT s.plan_id AS salon_plan, e.plan_id AS education_plan,
      e.pending_plan_id, p.name, p.price, p.audience
      FROM public.subscriptions s
      JOIN public.education_center_subscriptions e ON e.center_id=$1
      JOIN public.subscription_plans p ON p.id=e.plan_id
      WHERE s.salon_id=$2`, [ids.centerA, ids.salonA])).rows[0]!;
    assert.equal(rows.salon_plan, ids.sharedPlan);
    assert.notEqual(rows.education_plan, ids.sharedPlan);
    assert.equal(rows.pending_plan_id, ids.pendingPlan);
    assert.equal(rows.audience, "education");
    const ownership = await pool.query(`SELECT s.salon_id,e.center_id
      FROM public.subscriptions s CROSS JOIN public.education_center_subscriptions e
      WHERE s.salon_id=$1 AND e.center_id=$2`, [ids.salonA, ids.centerA]);
    assert.deepEqual(ownership.rows[0], { salon_id: ids.salonA, center_id: ids.centerA });
    const payment = await pool.query("SELECT plan_id_snapshot FROM public.education_payment_obligations");
    assert.equal(payment.rows[0]!.plan_id_snapshot, ids.sharedPlan);
  });
});

test("unrelated legacy-name collision causes original to relink education to the wrong plan", { skip }, async () => {
  await fixture(async (pool) => {
    const ids = await createPlanFixture(pool);
    await pool.query(`INSERT INTO public.subscription_plans
      (name,price,audience,active) VALUES ($1,9999,'education',true)`, [`Education legacy ${ids.sharedPlan}`]);
    await original(pool);
    const education = (await pool.query(`SELECT e.plan_id,p.price
      FROM public.education_center_subscriptions e JOIN public.subscription_plans p ON p.id=e.plan_id
      WHERE e.center_id=$1`, [ids.centerA])).rows[0]!;
    assert.equal(education.price, 9999);
    await report("inspection-name-collision", { sharedPlan: ids.sharedPlan, wrongPlan: education.plan_id });
  });
});

test("canonical unique clone names reject duplicate historical-name rows", { skip }, async () => {
  await fixture(async (pool) => {
    const ids = await createPlanFixture(pool);
    await pool.query("INSERT INTO public.subscription_plans (name,price) VALUES ($1,1)", [
      `Education legacy ${ids.sharedPlan}`,
    ]);
    await assert.rejects(
      () => pool.query("INSERT INTO public.subscription_plans (name,price) VALUES ($1,1)", [`Education legacy ${ids.sharedPlan}`]),
      /subscription_plans_name_unique|duplicate key value/u,
    );
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM public.subscription_plans WHERE name=$1", [
      `Education legacy ${ids.sharedPlan}`,
    ])).rows[0]!.count, 1);
  });
});

test("original snapshot fill preserves existing values, infers missing active values, and leaves inactive nulls", { skip }, async () => {
  await fixture(async (pool) => {
    const ids = await createPlanFixture(pool);
    await pool.query(`UPDATE public.education_center_subscriptions
      SET current_price_snapshot=777,current_course_limit_snapshot=66 WHERE center_id=$1`, [ids.centerA]);
    await original(pool);
    const rows = (await pool.query(`SELECT center_id,status,current_price_snapshot,current_course_limit_snapshot
      FROM public.education_center_subscriptions ORDER BY center_id`)).rows;
    const active = rows.find((row) => row.center_id === ids.centerA)!;
    const inactive = rows.find((row) => row.center_id === ids.centerB)!;
    assert.deepEqual([active.current_price_snapshot, active.current_course_limit_snapshot], [777, 66]);
    assert.deepEqual([inactive.current_price_snapshot, inactive.current_course_limit_snapshot], [null, null]);
  });
});

test("original ranked tier inference is price/UUID dependent and a fourth null tier remains unresolved", { skip }, async () => {
  await fixture(async (pool) => {
    await pool.query("DELETE FROM public.education_center_subscriptions");
    await pool.query("DELETE FROM public.subscriptions");
    for (const [name, price] of [["Tier 1", 100], ["Tier 2", 200], ["Tier 3", 300], ["Tier 4", 400]]) {
      await pool.query(`INSERT INTO public.subscription_plans
        (name,price,audience,limits,course_limit) VALUES ($1,$2,'education','{}',NULL)`, [name, price]);
    }
    await original(pool);
    const rows = (await pool.query(`SELECT name,course_limit,limits->>'courses' AS courses
      FROM public.subscription_plans WHERE name LIKE 'Tier %' ORDER BY price`)).rows;
    assert.deepEqual(rows.map((row) => [row.course_limit, row.courses]), [[5, "5"], [15, "15"], [30, "30"], [null, null]]);
  });
});

test("original normalization overwrites custom named-tier terms and rewrites education limits", { skip }, async () => {
  await fixture(async (pool) => {
    await pool.query(`INSERT INTO public.subscription_plans
      (name,price,audience,course_limit,limits,trial_days,vat_included,price_copy,active)
      VALUES ('Education Start',500,'education',5,'{"courses":99}',2,false,'Custom',true)`);
    await original(pool);
    const row = (await pool.query("SELECT trial_days,vat_included,price_copy,active,limits FROM public.subscription_plans WHERE name='Education Start'")).rows[0]!;
    assert.deepEqual(row, { trial_days: 30, vat_included: true, price_copy: "Cena uključuje PDV.", active: true, limits: { courses: 5 } });
  });
});

test("organic scalar-limits failure leaves autocommit prefix but rolls back in transaction", { skip }, async () => {
  await fixture(async (pool) => {
    const ids = await createPlanFixture(pool);
    await pool.query("UPDATE public.subscription_plans SET limits='5'::jsonb,course_limit=5 WHERE id=$1", [ids.educationPlan]);
    const before = await snapshot(pool);
    const operations = originalPlanOperations();
    for (const operation of operations.slice(0, 7)) await pool.query(operation.sql);
    await assert.rejects(() => pool.query(operations[7]!.sql), /cannot set path in scalar|jsonb_set/u);
    const afterAutocommit = await snapshot(pool);
    assert.notDeepEqual(afterAutocommit, before, "autocommit source replay retains its successful prefix");
  });
  await fixture(async (pool) => {
    const ids = await createPlanFixture(pool);
    await pool.query("UPDATE public.subscription_plans SET limits='5'::jsonb,course_limit=5 WHERE id=$1", [ids.educationPlan]);
    const before = await snapshot(pool);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const operations = originalPlanOperations();
      for (const operation of operations.slice(0, 7)) await client.query(operation.sql);
      await assert.rejects(() => client.query(operations[7]!.sql), /cannot set path in scalar|jsonb_set/u);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    assert.deepEqual(await snapshot(pool), before, "the same source statements roll back as one transaction");
  });
});

test("canonical foreign keys cover current, pending, salon, and payment historical plan references", { skip }, async () => {
  await fixture(async (pool) => {
    const rows = (await pool.query(`SELECT c.relname AS table_name,con.conname,pg_get_constraintdef(con.oid,true) AS definition
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
      WHERE con.contype='f' AND con.confrelid='public.subscription_plans'::regclass
      ORDER BY c.relname,con.conname`)).rows;
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((row) => row.table_name), [
      "education_center_subscriptions", "education_center_subscriptions",
      "education_payment_obligations", "subscriptions",
    ]);
    assert.ok(rows.some((row) => String(row.definition).includes("ON DELETE RESTRICT")));
  });
});

test("fallback data step remains fail-closed when historical relationships exist", { skip }, async () => {
  await fixture(async (pool) => {
    const ids = await createPlanFixture(pool);
    const client = await pool.connect();
    try {
      await assert.rejects(() => applyStartupData(client as never, "000002_education_fallback_plans"), /REQUIRE_RECONCILIATION/u);
    } finally {
      client.release();
    }
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM public.subscription_plans")).rows[0]!.count, 4);
    assert.ok(ids.sharedPlan);
  });
});

test("startup lock wrapper serializes concurrent original replays without duplicate clones", { skip }, async () => {
  await fixture(async (pool) => {
    const ids = await createPlanFixture(pool);
    await Promise.all([originalWithStartupLocks(pool), originalWithStartupLocks(pool)]);
    const clones = (await pool.query("SELECT id FROM public.subscription_plans WHERE name=$1", [
      `Education legacy ${ids.sharedPlan}`,
    ])).rows;
    assert.equal(clones.length, 1);
    const links = (await pool.query(`SELECT s.salon_id,e.center_id,s.plan_id AS salon_plan,e.plan_id AS education_plan
      FROM public.subscriptions s CROSS JOIN public.education_center_subscriptions e
      WHERE s.salon_id=$1 AND e.center_id=$2`, [ids.salonA, ids.centerA])).rows[0]!;
    assert.equal(links.salon_plan, ids.sharedPlan);
    assert.notEqual(links.education_plan, ids.sharedPlan);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM public.education_payment_obligations")).rows[0]!.count, 1);
  });
});

test("concurrent read-only inspectors remain blocked and do not mutate fixtures", { skip }, async () => {
  await fixture(async (pool) => {
    await createPlanFixture(pool);
    const before = await snapshot(pool);
    const reports = await Promise.all([
      inspectPlanReconciliation(pool as never),
      inspectPlanReconciliation(pool as never),
    ]);
    assert.deepEqual(reports.map((result) => result.status), [
      "BLOCKED_PENDING_CONTRACT_ACCEPTANCE", "BLOCKED_PENDING_CONTRACT_ACCEPTANCE",
    ]);
    assert.deepEqual(await snapshot(pool), before);
  });
});