import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import { checkProductionRequestDependencyBoundary } from "../production-request-dependency-boundary";
import {
  readPostgresFingerprintCompatibility,
  readPostgresSnapshot,
} from "../schema-drift/catalog";
import { fingerprintSnapshot } from "../schema-drift/fingerprint";
import { beginFingerprintTransaction } from "../schema-drift/fingerprint-transaction";
import { ownershipExceptions } from "../schema-drift/ownership";
import { readOnlyQueryLayer } from "../schema-drift/read-only-query";
import { adoptBaseline, applyMigrations, migrationStatus } from "./runner";
import { registerDisposableTarget, expectedDisposableTarget } from "./disposable-target-fixture";
import { loadMigration, loadMigrations } from "./files";
import { ensureLedger, readLedger } from "./ledger";
import { preflightBaselineAdoption } from "./preflight";
import type { LoadedMigration } from "./types";
import { inspectDatabaseMigrationReady, migrationReadinessContract } from "@workspace/db/migration-runtime";

assertDestructiveTestRuntimeAllowed(process.env, "Migrations integration tests");
const unitOnly = process.env.LUMERA_PHASE4_UNIT_ONLY === "1";
const disposableUrl = process.env.LUMERA_PHASE4_DISPOSABLE_DATABASE_URL;
if (!unitOnly && (!disposableUrl || process.env.LUMERA_PHASE4_DISPOSABLE_DB !== "1")) {
  throw new Error(
    "Phase 4 integration tests require LUMERA_PHASE4_DISPOSABLE_DATABASE_URL and "
    + "LUMERA_PHASE4_DISPOSABLE_DB=1; set LUMERA_PHASE4_UNIT_ONLY=1 for unit-only runs",
  );
}

const skip = unitOnly ? { skip: "unit-only run" } : undefined;

function migration(id: string, mode: "transactional" | "nontransactional", body: string): LoadedMigration {
  return {
    id,
    directory: `${id}_integration_case`,
    checksum: `${id}${"0".repeat(64 - id.length)}`,
    mode,
    description: `Integration ${id}`,
    structuralFingerprint: "",
    physicalFingerprint: "",
    fingerprintVersion: 4,
    formatVersion: 2,
    postgresMajor: 16,
    postgresVersionNum: 160010,
    normalizedObjectCount: 0,
    enumCount: 0,
    triggerCount: 0,
    functionCount: 0,
    sql: body,
    body,
    preconditions: [],
    postconditions: [],
    recovery: "integration recovery",
  };
}

async function withDatabase<T>(callback: (pool: pg.Pool) => Promise<T>): Promise<T> {
  const admin = new pg.Pool({ connectionString: disposableUrl!, max: 2 });
  const name = `lumera_phase4_${process.pid}_${randomBytes(5).toString("hex")}`;
  const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  let child: pg.Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE ${quote(name)}`);
    const childUrl = new URL(disposableUrl!);
    childUrl.pathname = `/${name}`;
    child = new pg.Pool({ connectionString: childUrl.toString(), max: 4 });
    await registerDisposableTarget(admin, child, name);
    return await callback(child);
  } finally {
    try {
      await child?.end();
    } finally {
      try {
        // Ordinary DROP avoids forcibly terminating clients still disconnecting.
        // It does not wait for connections to close; any remaining sessions cause a visible cleanup failure.
        await admin.query(`DROP DATABASE IF EXISTS ${quote(name)}`);
      } finally {
        await admin.end();
      }
    }
  }
}

async function withClient<T>(pool: pg.Pool, callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

async function fingerprint(pool: pg.Pool): Promise<{
  structuralFingerprint: string;
  physicalFingerprint: string;
}> {
  return withClient(pool, async (client) => {
    await beginFingerprintTransaction(client);
    try {
      const readOnly = readOnlyQueryLayer(client);
      const result = fingerprintSnapshot(
        await readPostgresSnapshot(readOnly),
        ownershipExceptions,
        await readPostgresFingerprintCompatibility(readOnly),
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

async function executeCanonicalBody(pool: pg.Pool): Promise<void> {
  const [canonical] = await loadMigrations();
  await withClient(pool, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(canonical!.body);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

async function ledgerReceipts(pool: pg.Pool): Promise<unknown[]> {
  // JSON retains PostgreSQL timestamp precision, unlike JS Date conversion.
  return (await pool.query(
    "SELECT to_jsonb(receipt) AS receipt FROM public.lumera_migration_ledger receipt ORDER BY migration_id",
  )).rows;
}

async function expectUnchangedRefusal(
  pool: pg.Pool,
  operation: () => Promise<unknown>,
  message: string,
  hasLedger = false,
): Promise<void> {
  const beforeCatalog = await fingerprint(pool);
  const beforeReceipts = hasLedger ? await ledgerReceipts(pool) : undefined;
  await assert.rejects(operation, { message });
  assert.deepEqual(await fingerprint(pool), beforeCatalog, "Refusal must not mutate the catalog.");
  if (hasLedger) {
    assert.deepEqual(await ledgerReceipts(pool), beforeReceipts, "Refusal must not mutate any receipt field.");
  } else {
    assert.equal((await pool.query(
      "SELECT to_regclass('public.lumera_migration_ledger') AS ledger",
    )).rows[0]?.ledger, null, "Refusal must not create a ledger.");
  }
}

const canonicalAdoptionRefusal = "Supported baseline adoption requires the exact canonical baseline fingerprint";

test("fresh apply and rerun are a no-op", skip, async () => {
  await withDatabase(async (pool) => {
    const migrations = await loadMigrations();
    assert.deepEqual(migrations.map(({ id }) => id), ["000001", "000002", "000003", "000004"]);
    const first = await withClient(pool, (client) => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    assert.deepEqual(first.applied, ["000001", "000002", "000003", "000004"]);
    assert.deepEqual(first.skipped, []);
    const beforeReceipts = await ledgerReceipts(pool);
    const beforeCatalog = await fingerprint(pool);
    assert.equal(beforeCatalog.structuralFingerprint, migrationReadinessContract.headStructuralFingerprint);
    assert.equal(beforeCatalog.physicalFingerprint, migrationReadinessContract.headPhysicalFingerprint);
    assert.equal((await withClient(pool, client => inspectDatabaseMigrationReady(client))).ready, true);
    const second = await withClient(pool, (client) => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.skipped, ["000001", "000002", "000003", "000004"]);
    assert.deepEqual(await ledgerReceipts(pool), beforeReceipts);
    assert.deepEqual(await fingerprint(pool), beforeCatalog);
    assert.deepEqual((await withClient(pool, (client) => migrationStatus(client, migrations)))
      .map(({ id, state }) => ({ id, state })), [
         { id: "000001", state: "APPLIED" }, { id: "000002", state: "APPLIED" }, { id: "000003", state: "APPLIED" }, { id: "000004", state: "APPLIED" },
      ]);
  });
  await withDatabase(async (pool) => {
    const migrations = await loadMigrations();
    const previous = migrations.filter(migration => migration.id < "000003");
    await withClient(pool, client => applyMigrations(client, { migrations: previous, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    assert.equal((await withClient(pool, client => inspectDatabaseMigrationReady(client))).ready, false);
    // An ordinary tenant row must not re-trigger 000002's initial-state gate.
    await pool.query(`INSERT INTO public.users
      (id,first_name,last_name,email,password_hash,role)
      VALUES ('10000000-0000-4000-8000-000000000003','Address','Owner','address-owner@disposable.invalid','x','CUSTOMER')`);
    const before = await fingerprint(pool);
    const receipts = await ledgerReceipts(pool);
    const failing = migrations.map(migration => migration.id === "000003"
      ? { ...migration, postconditions: ["SELECT false"] } : migration);
    await assert.rejects(
      () => withClient(pool, client => applyMigrations(client, { migrations: failing, expectedTargetIdentity: expectedDisposableTarget(pool) })),
      /postcondition failed/u,
    );
    assert.deepEqual(await fingerprint(pool), before, "failed postcondition must roll back all four columns");
    assert.deepEqual(await ledgerReceipts(pool), receipts, "failed transaction must not leave a receipt");
    const result = await withClient(pool, client => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    assert.deepEqual(result, { applied: ["000003", "000004"], skipped: ["000001", "000002"] });
    assert.equal((await pool.query("SELECT count(*)::integer AS count FROM public.users WHERE email='address-owner@disposable.invalid'")).rows[0].count, 1);
    const columns = await pool.query(`SELECT column_name, udt_schema, udt_name, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema='public' AND table_name='salons'
      AND column_name IN ('entrance_directions','intercom','floor','apartment') ORDER BY column_name`);
    assert.deepEqual(columns.rows, ["apartment", "entrance_directions", "floor", "intercom"].map(column_name => ({
      column_name, udt_schema: "pg_catalog", udt_name: "text", is_nullable: "YES", column_default: null,
    })));
    assert.equal((await withClient(pool, client => inspectDatabaseMigrationReady(client))).ready, true);
  });
  await withDatabase(async (pool) => {
    const migrations = await loadMigrations();
    const previous = migrations.filter(migration => migration.id < "000004");
    await withClient(pool, client => applyMigrations(client, { migrations: previous, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    assert.equal((await withClient(pool, client => inspectDatabaseMigrationReady(client))).ready, false);
    await pool.query(`INSERT INTO public.users
      (id,first_name,last_name,email,password_hash,role)
      VALUES ('10000000-0000-4000-8000-000000000004','Job','Owner','job-owner@disposable.invalid','x','CUSTOMER')`);
    await pool.query(`INSERT INTO public.beauty_job_categories (id,slug,name)
      VALUES ('20000000-0000-4000-8000-000000000004','publication-proof','Publication proof')`);
    await pool.query(`INSERT INTO public.beauty_job_listings
      (category_id,user_id,posted_by_type,type,title,description,city,region,moderation_status,expires_at)
      VALUES ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004',
      'user','job','Legacy listing','Legacy description','Nis','Nis','approved',now()+interval '10 days')`);
    const before = await fingerprint(pool);
    const receipts = await ledgerReceipts(pool);
    const failing = migrations.map(migration => migration.id === "000004"
      ? { ...migration, postconditions: ["SELECT false"] } : migration);
    await assert.rejects(
      () => withClient(pool, client => applyMigrations(client, { migrations: failing, expectedTargetIdentity: expectedDisposableTarget(pool) })),
      /postcondition failed/u,
    );
    assert.deepEqual(await fingerprint(pool), before, "failed job publication migration rolls back its column");
    assert.deepEqual(await ledgerReceipts(pool), receipts, "failed transaction leaves no publication receipt");
    const result = await withClient(pool, client => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    assert.deepEqual(result, { applied: ["000004"], skipped: ["000001", "000002", "000003"] });
    const columns = await pool.query(`SELECT column_name, udt_schema, udt_name, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema='public' AND table_name='beauty_job_listings'
      AND column_name='first_published_at'`);
    assert.deepEqual(columns.rows, [{
      column_name: "first_published_at", udt_schema: "pg_catalog", udt_name: "timestamptz", is_nullable: "YES", column_default: null,
    }]);
    assert.deepEqual((await pool.query("SELECT first_published_at FROM public.beauty_job_listings")).rows,
      [{ first_published_at: null }], "existing public listings are not backfilled");
    assert.equal((await withClient(pool, client => inspectDatabaseMigrationReady(client))).ready, true);
  });
});

test("exact adoption and second adoption are idempotent", skip, async () => {
  await withDatabase(async (pool) => {
    await executeCanonicalBody(pool);
    const migrations = await loadMigrations();
    const baselineCatalog = await fingerprint(pool);
    const first = await withClient(pool, (client) => adoptBaseline(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    assert.deepEqual(first.adopted, ["000001"]);
    const adoptedCatalog = await fingerprint(pool);
    // Ledger creation adds an excluded bookkeeping entry, not application schema.
    assert.equal(adoptedCatalog.structuralFingerprint, baselineCatalog.structuralFingerprint);
    assert.equal(adoptedCatalog.physicalFingerprint, baselineCatalog.physicalFingerprint);
    const beforeReceipts = await ledgerReceipts(pool);
    assert.equal(beforeReceipts.length, 1, "Baseline adoption must not manufacture a data-migration receipt.");
    const second = await withClient(pool, (client) => adoptBaseline(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    assert.deepEqual(second.adopted, []);
    assert.deepEqual(await ledgerReceipts(pool), beforeReceipts);
    assert.deepEqual(await fingerprint(pool), adoptedCatalog);
    assert.deepEqual((await withClient(pool, (client) => migrationStatus(client, migrations)))
      .map(({ id, state }) => ({ id, state })), [
         { id: "000001", state: "ADOPTED" }, { id: "000002", state: "PENDING" }, { id: "000003", state: "PENDING" }, { id: "000004", state: "PENDING" },
      ]);
    // Explicit B1 adoption and data execution are separate operations.
    const applied = await withClient(pool, (client) => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    assert.deepEqual(applied.applied, ["000002", "000003", "000004"]);
    assert.deepEqual(applied.skipped, ["000001"]);
    assert.deepEqual((await withClient(pool, (client) => migrationStatus(client, migrations)))
      .map(({ id, state }) => ({ id, state })), [
         { id: "000001", state: "ADOPTED" }, { id: "000002", state: "APPLIED" }, { id: "000003", state: "APPLIED" }, { id: "000004", state: "APPLIED" },
      ]);
  });
});

test("baseline adoption refuses when its standalone routine is missing", skip, async () => {
  await withDatabase(async (pool) => {
    await executeCanonicalBody(pool);
    const migrations = await loadMigrations();
    const before = await fingerprint(pool);
    await withClient(pool, (client) => client.query(
      "DROP FUNCTION public.prevent_incomplete_commercial_snapshot_insert()",
    ));
    const after = await fingerprint(pool);
    assert.notDeepEqual(after, before);
    await expectUnchangedRefusal(
      pool,
      () => withClient(pool, (client) => adoptBaseline(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) })),
      canonicalAdoptionRefusal,
    );
    await withClient(pool, async (client) => {
      const ledger = await client.query(
        "SELECT to_regclass('public.lumera_migration_ledger') AS ledger",
      );
      assert.equal(ledger.rows[0]?.["ledger"], null);
    });
  });
});

test("baseline adoption refuses an added standalone routine", skip, async () => {
  await withDatabase(async (pool) => {
    await executeCanonicalBody(pool);
    const migrations = await loadMigrations();
    const baseline = await fingerprint(pool);
    await withClient(pool, (client) => client.query(`
      CREATE FUNCTION public.phase4_standalone_routine() RETURNS integer
      LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$`));
    const added = await fingerprint(pool);
    assert.notDeepEqual(added, baseline);
    await expectUnchangedRefusal(
      pool,
      () => withClient(pool, (client) => adoptBaseline(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) })),
      canonicalAdoptionRefusal,
    );
    await withClient(pool, async (client) => {
      const ledger = await client.query(
        "SELECT to_regclass('public.lumera_migration_ledger') AS ledger",
      );
      assert.equal(ledger.rows[0]?.["ledger"], null);
    });
  });
});

test("baseline adoption refuses a mutated baseline standalone routine", skip, async () => {
  await withDatabase(async (pool) => {
    await executeCanonicalBody(pool);
    const migrations = await loadMigrations();
    const baseline = await fingerprint(pool);
    await withClient(pool, (client) => client.query(`
      CREATE OR REPLACE FUNCTION public.prevent_incomplete_commercial_snapshot_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RETURN NEW;
      END $$`));
    const mutated = await fingerprint(pool);
    assert.notDeepEqual(mutated, baseline);
    await expectUnchangedRefusal(
      pool,
      () => withClient(pool, (client) => adoptBaseline(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) })),
      canonicalAdoptionRefusal,
    );
    await withClient(pool, async (client) => {
      const ledger = await client.query(
        "SELECT to_regclass('public.lumera_migration_ledger') AS ledger",
      );
      assert.equal(ledger.rows[0]?.["ledger"], null);
    });
  });
});

test("adoption mismatch leaves zero adopted state", skip, async () => {
  await withDatabase(async (pool) => {
    const migrations = await loadMigrations();
    await expectUnchangedRefusal(
      pool,
      () => withClient(pool, (client) => adoptBaseline(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) })),
      canonicalAdoptionRefusal,
    );
    await withClient(pool, async (client) => {
      const row = await client.query(
        "SELECT to_regclass('public.lumera_migration_ledger') AS ledger",
      );
      assert.equal(row.rows[0]?.["ledger"], null);
    });
  });
});

test("manifest tamper is rejected before any SQL is sent", skip, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumera-phase4-"));
  try {
    const source = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../lib/db/migrations/000001_canonical_schema/migration.sql",
    );
    const target = path.join(root, "000001_canonical_schema", "migration.sql");
    await mkdir(path.dirname(target), { recursive: true });
    const bytes = await readFile(source);
    bytes[bytes.length - 1] = bytes[bytes.length - 1] === 0x0a ? 0x20 : 0x0a;
    await writeFile(target, bytes);
    await assert.rejects(() => loadMigrations(root), /checksum mismatch/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ledger checksum mismatch and unknown future migration fail closed", skip, async () => {
  await withDatabase(async (pool) => {
    const migrations = [
      migration("000001", "transactional", "CREATE TABLE phase4_completed_marker (id integer)"),
      migration("000002", "transactional", "CREATE TABLE phase4_never_run (id integer)"),
    ];
    await withClient(pool, async (client) => {
      await client.query(migrations[0]!.body);
      await ensureLedger(client);
      await client.query(
        `INSERT INTO public.lumera_migration_ledger
          (migration_id, checksum, mode, state, started_at, finished_at)
         VALUES ($1, $2, $3, $4, statement_timestamp(), statement_timestamp())`,
        ["000001", "tampered", "transactional", "APPLIED"],
      );
    });
    const refuse = async (reason: string): Promise<void> => {
      await expectUnchangedRefusal(
        pool,
        () => withClient(pool, (client) => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) })),
        `Unsupported migration ledger: ${reason}`,
        true,
      );
      assert.equal((await pool.query(
        "SELECT to_regclass('public.phase4_never_run') AS marker",
      )).rows[0]?.marker, null, "Invalid receipts must block pending SQL.");
    };
    await refuse("LEDGER_CHECKSUM_MISMATCH:000001");
    // Isolate timestamp validation instead of letting it mask checksum/future checks.
    await pool.query(
      "UPDATE public.lumera_migration_ledger SET checksum = $2, finished_at = NULL WHERE migration_id = $1",
      ["000001", migrations[0]!.checksum],
    );
    await refuse("LEDGER_MISSING_FINISHED_AT:000001");
    await withClient(pool, async (client) => {
      await client.query(
        "UPDATE public.lumera_migration_ledger SET finished_at = clock_timestamp() WHERE migration_id = $1",
        ["000001"],
      );
      await client.query(
        `INSERT INTO public.lumera_migration_ledger
          (migration_id, checksum, mode, state, started_at, finished_at)
         VALUES ($1, $2, $3, $4, statement_timestamp(), statement_timestamp())`,
        ["999999", "f".repeat(64), "transactional", "APPLIED"],
      );
    });
    await refuse("LEDGER_UNKNOWN_MIGRATION:999999");
  });
});

test("concurrent runners serialize without double application", skip, async () => {
  await withDatabase(async (pool) => {
    const migrations = [migration("000001", "transactional",
      "CREATE TABLE phase4_concurrent_marker (id integer); SELECT pg_sleep(0.2)")];
    const first = withClient(pool, (client) => applyMigrations(client, {
      expectedTargetIdentity: expectedDisposableTarget(pool),
      migrations, lockTimeoutMs: 10_000, lockPollMs: 20,
    }));
    const second = withClient(pool, (client) => applyMigrations(client, {
      expectedTargetIdentity: expectedDisposableTarget(pool),
      migrations, lockTimeoutMs: 10_000, lockPollMs: 20,
    }));
    const results = await Promise.all([first, second]);
    assert.equal(results.filter((result) => result.applied.length === 1).length, 1);
    assert.equal(results.filter((result) => result.skipped.length === 1).length, 1);
  });
});

test("transactional rollback leaves no partial object or APPLIED state", skip, async () => {
  await withDatabase(async (pool) => {
    const migrations = [migration("000001", "transactional",
      "CREATE TABLE phase4_partial_object (id integer); SELECT 1 / 0")];
    await assert.rejects(
      () => withClient(pool, (client) => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) })),
      /division by zero/u,
    );
    await withClient(pool, async (client) => {
      const object = await client.query("SELECT to_regclass('public.phase4_partial_object') AS object");
      assert.equal(object.rows[0]?.["object"], null);
      const rows = await readLedger(client);
      assert.equal(rows[0]?.state, "FAILED");
    });
  });
});

test("preexisting nontransactional APPLYING halts without rerun", skip, async () => {
  await withDatabase(async (pool) => {
    const migrations = [migration("000001", "nontransactional", "CREATE TABLE phase4_nontransactional_marker (id integer)")];
    await withClient(pool, async (client) => {
      await ensureLedger(client);
      await client.query(
        "INSERT INTO public.lumera_migration_ledger (migration_id, checksum, mode, state) VALUES ($1, $2, $3, $4)",
        [migrations[0]!.id, migrations[0]!.checksum, "nontransactional", "APPLYING"],
      );
    });
    // Phase 5 refuses incomplete receipts before any retry or migration SQL.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expectUnchangedRefusal(
        pool,
        () => withClient(pool, (client) => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) })),
        "Unsupported migration ledger: LEDGER_INCOMPLETE:000001",
        true,
      );
    }
    await withClient(pool, async (client) => {
      const object = await client.query("SELECT to_regclass('public.phase4_nontransactional_marker') AS object");
      assert.equal(object.rows[0]?.["object"], null);
      assert.equal((await readLedger(client))[0]?.state, "APPLYING");
    });
  });
});

test("fresh and adopted databases have equivalent structural and physical fingerprints", skip, async () => {
  let fresh: { structuralFingerprint: string; physicalFingerprint: string } | undefined;
  let adopted: { structuralFingerprint: string; physicalFingerprint: string } | undefined;
  await withDatabase(async (pool) => {
    const migrations = await loadMigrations();
    await withClient(pool, (client) => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    fresh = await fingerprint(pool);
  });
  await withDatabase(async (pool) => {
    const migrations = await loadMigrations();
    await executeCanonicalBody(pool);
    await withClient(pool, (client) => adoptBaseline(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    // Adoption itself is baseline-only; compare catalogs at the same HEAD
    // only after the adopted path has applied all remaining migrations.
    await withClient(pool, (client) => applyMigrations(client, { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) }));
    adopted = await fingerprint(pool);
  });
  assert.deepEqual(adopted, fresh);
});

test("status is read-only", skip, async () => {
  await withDatabase(async (pool) => {
    const migrations = await loadMigrations();
    const beforeCatalog = await fingerprint(pool);
    await withClient(pool, async (client) => {
      assert.deepEqual((await migrationStatus(client, migrations))
        .map(({ id, state }) => ({ id, state })), [
          { id: "000001", state: "PENDING" }, { id: "000002", state: "PENDING" }, { id: "000003", state: "PENDING" }, { id: "000004", state: "PENDING" },
        ]);
      const relation = await client.query(
        "SELECT to_regclass('public.lumera_migration_ledger') AS ledger",
      );
      assert.equal(relation.rows[0]?.["ledger"], null);
    });
    assert.deepEqual(await fingerprint(pool), beforeCatalog);
  });
});

test("Phase 5A preflight is READY for exact baseline and creates no object or ledger", skip, async () => {
  await withDatabase(async (pool) => {
    await executeCanonicalBody(pool);
    const migrations = await loadMigrations();
    const before = await pool.query(
      "SELECT count(*)::int AS count FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace",
    );
    const report = await withClient(pool, (client) => preflightBaselineAdoption(client, migrations));
    const after = await pool.query(
      "SELECT count(*)::int AS count FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace",
    );
    assert.equal(report.readiness, "READY");
    assert.equal(report.structuralFingerprint, "MATCH");
    assert.equal(report.physicalFingerprint, "MATCH");
    assert.equal(report.ledger.existence, "MISSING");
    assert.equal(after.rows[0]?.["count"], before.rows[0]?.["count"]);
    assert.equal(
      (await pool.query("SELECT to_regclass('public.lumera_migration_ledger') AS ledger"))
        .rows[0]?.["ledger"],
      null,
    );
  });
});

test("Phase 5A preflight recognizes the real canonical ADOPTED ledger", skip, async () => {
  await withDatabase(async (pool) => {
    await executeCanonicalBody(pool);
    const migrations = await loadMigrations();
    const baseline = migrations[0]!;
    await withClient(pool, async (client) => {
      await ensureLedger(client);
      await client.query(`INSERT INTO public.lumera_migration_ledger
        (migration_id,checksum,mode,state,started_at,finished_at,error)
        VALUES ($1,$2,$3,'ADOPTED',clock_timestamp(),clock_timestamp(),NULL)`,
      [baseline.id, baseline.checksum, baseline.mode]);
    });
    const report = await withClient(pool, (client) => preflightBaselineAdoption(client, migrations));
    assert.equal(report.readiness, "ALREADY_INITIALIZED");
    assert.equal(report.ledger.state, "VALID");
    assert.ok(!report.blockers.includes("LEDGER_UNREADABLE"));
  });
});

test("Phase 5A preflight classifies an empty real ledger as inconsistent", skip, async () => {
  await withDatabase(async (pool) => {
    await executeCanonicalBody(pool);
    const migrations = await loadMigrations();
    await withClient(pool, (client) => ensureLedger(client));
    const report = await withClient(pool, (client) => preflightBaselineAdoption(client, migrations));
    assert.equal(report.readiness, "NOT_READY");
    assert.ok(report.blockers.includes("LEDGER_INCONSISTENT"));
    assert.ok(!report.blockers.includes("LEDGER_UNREADABLE"));
  });
});

test("Phase 5A ledger exclusion preserves only the exact canonical identity", skip, async () => {
  await withDatabase(async (pool) => {
    await executeCanonicalBody(pool);
    const baseline = await fingerprint(pool);
    await withClient(pool, (client) => ensureLedger(client));
    const withLedger = await fingerprint(pool);
    assert.equal(withLedger.structuralFingerprint, baseline.structuralFingerprint);
    assert.equal(withLedger.physicalFingerprint, baseline.physicalFingerprint);

    for (const sql of [
      "CREATE TABLE public.unrelated_phase5a_table (id integer)",
      "CREATE FUNCTION public.unrelated_phase5a_function() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
      "CREATE TABLE public.lumera_migration_ledgers (id integer)",
      "CREATE SCHEMA phase5a_other; CREATE TABLE phase5a_other.lumera_migration_ledger (id integer)",
    ]) {
      const database = await withDatabase(async (isolated) => {
        await executeCanonicalBody(isolated);
        await isolated.query(sql);
        return fingerprint(isolated);
      });
      assert.notDeepEqual(database, baseline, sql);
    }
  });
});

test("Phase 5A transaction is PostgreSQL-enforced repeatable-read read-only", skip, async () => {
  await withDatabase(async (pool) => {
    await withClient(pool, async (client) => {
      await beginFingerprintTransaction(client);
      const isolation = await client.query(
        "SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only",
      );
      assert.equal(isolation.rows[0]?.["isolation"], "repeatable read");
      assert.equal(isolation.rows[0]?.["read_only"], "on");
      await assert.rejects(
        () => client.query("CREATE TABLE phase5a_write_must_fail (id integer)"),
        (error: unknown) => (error as { code?: string }).code === "25006",
      );
      await client.query("ROLLBACK");
    });
    assert.equal(
      (await pool.query("SELECT to_regclass('public.phase5a_write_must_fail') AS object")).rows[0]?.["object"],
      null,
    );
  });
});

test("Phase 5A preflight blocks routine and trigger drift", skip, async () => {
  await withDatabase(async (pool) => {
    await executeCanonicalBody(pool);
    const migrations = await loadMigrations();
    await pool.query(`CREATE OR REPLACE FUNCTION public.prevent_incomplete_commercial_snapshot_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`);
    const routine = await withClient(pool, (client) => preflightBaselineAdoption(client, migrations));
    assert.equal(routine.readiness, "NOT_READY");
    assert.ok(routine.blockers.includes("STRUCTURAL_MISMATCH"));
    await pool.query("ALTER TRIGGER products_supplier_ownership ON public.products RENAME TO zz_products_supplier_ownership");
    const trigger = await withClient(pool, (client) => preflightBaselineAdoption(client, migrations));
    assert.equal(trigger.readiness, "NOT_READY");
    assert.ok(trigger.blockers.includes("TRIGGER_COUNT_MISMATCH") === false);
    assert.ok(trigger.blockers.includes("STRUCTURAL_MISMATCH"));
  });
});

for (const unsafe of [
  { title: "unknown migration", id: "999999", checksum: "x".repeat(64), state: "ADOPTED", error: null, code: "UNKNOWN_MIGRATION:999999" },
  { title: "failed migration", id: "000001", checksum: "BASELINE", state: "FAILED", error: "test", code: "FAILED_MIGRATION:000001" },
  { title: "applying migration", id: "000001", checksum: "BASELINE", state: "APPLYING", error: null, code: "APPLYING_MIGRATION:000001" },
  { title: "checksum mismatch", id: "000001", checksum: "x".repeat(64), state: "ADOPTED", error: null, code: "CHECKSUM_MISMATCH:000001" },
] as const) {
  test(`Phase 5A preflight blocks ${unsafe.title} without repair`, skip, async () => {
    await withDatabase(async (pool) => {
    await executeCanonicalBody(pool);
    const migrations = await loadMigrations();
    const baseline = migrations[0]!;
    await withClient(pool, (client) => ensureLedger(client));
      await pool.query(
        `INSERT INTO public.lumera_migration_ledger
          (migration_id,checksum,mode,state,error) VALUES ($1,$2,$3,$4,$5)`,
        [
          unsafe.id,
          unsafe.checksum === "BASELINE" ? baseline.checksum : unsafe.checksum,
          baseline.mode,
          unsafe.state,
          unsafe.error,
        ],
      );
      const report = await withClient(pool, (client) => preflightBaselineAdoption(client, migrations));
      assert.equal(report.readiness, "NOT_READY");
      assert.ok(report.blockers.includes(unsafe.code));
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM public.lumera_migration_ledger"))
        .rows[0]?.["count"], 1);
    });
  });
}

test("Phase 5A preflight rejects every malformed ledger shape", skip, async (context) => {
  const canonical = `(
      migration_id text PRIMARY KEY,
      checksum text NOT NULL,
      mode text NOT NULL CHECK (mode IN ('transactional', 'nontransactional')),
      state text NOT NULL CHECK (state IN ('APPLYING', 'APPLIED', 'FAILED', 'ADOPTED')),
      started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      finished_at timestamptz,
      error text
    )`;
  const cases = [
      { title: "extra column", sql: canonical.replace(/\)$/, ", extra text)") },
      { title: "missing column", sql: canonical.replace(/,\s*error text\s*\)$/, ")") },
      { title: "wrong data type", sql: canonical.replace("checksum text NOT NULL", "checksum varchar NOT NULL") },
      { title: "wrong nullability", sql: canonical.replace("checksum text NOT NULL", "checksum text") },
      { title: "wrong default", sql: canonical.replace("DEFAULT clock_timestamp()", "DEFAULT now()") },
      { title: "missing primary key", sql: canonical.replace(" PRIMARY KEY", "") },
      { title: "wrong primary key", sql: canonical.replace("migration_id text PRIMARY KEY", "migration_id text, PRIMARY KEY (checksum)") },
      { title: "weakened mode check", sql: canonical.replace("mode IN ('transactional', 'nontransactional')", "mode IN ('transactional', 'nontransactional') OR true") },
      { title: "weakened state check", sql: canonical.replace("state IN ('APPLYING', 'APPLIED', 'FAILED', 'ADOPTED')", "state IN ('APPLYING', 'APPLIED', 'FAILED', 'ADOPTED') OR true") },
      { title: "extra allowed state", sql: canonical.replace("'ADOPTED')", "'ADOPTED', 'OTHER')") },
      { title: "view", sql: `VIEW public.lumera_migration_ledger AS SELECT
          ''::text migration_id, ''::text checksum, ''::text mode, ''::text state,
          clock_timestamp() started_at, NULL::timestamptz finished_at, NULL::text error` },
    ];
  for (const malformed of cases) {
    await context.test(malformed.title, async () => {
      await withDatabase(async (pool) => {
        await executeCanonicalBody(pool);
        const migrations = await loadMigrations();
        await pool.query(`CREATE ${malformed.sql.startsWith("VIEW") ? malformed.sql : `TABLE public.lumera_migration_ledger ${malformed.sql}`}`);
        const report = await withClient(pool, (client) => preflightBaselineAdoption(client, migrations));
        assert.equal(report.readiness, "NOT_READY");
        assert.equal(report.ledger.state, "BLOCKED");
        assert.ok(report.blockers.includes("LEDGER_UNREADABLE"));
      });
    });
  }
});

test("Phase 5A preflight blocks unsupported version contract and missing extension", skip, async () => {
  await withDatabase(async (pool) => {
    await executeCanonicalBody(pool);
    const migrations = await loadMigrations();
    const wrongVersion = [{ ...migrations[0]!, postgresMajor: 15, postgresVersionNum: 150000 }];
    const version = await withClient(pool, (client) => preflightBaselineAdoption(client, wrongVersion));
    assert.equal(version.readiness, "NOT_READY");
    assert.ok(version.blockers.includes("POSTGRES_MAJOR_MISMATCH"));
    await pool.query("DROP EXTENSION pg_trgm CASCADE");
    const extension = await withClient(pool, (client) => preflightBaselineAdoption(client, migrations));
    assert.equal(extension.readiness, "NOT_READY");
    assert.equal(extension.requiredExtensions.pg_trgm, "MISSING");
    assert.ok(extension.blockers.includes("MISSING_EXTENSION:pg_trgm"));
  });
});

test("production startup cannot reach migration runner", async () => {
  const report = checkProductionRequestDependencyBoundary({
    rootFiles: ["artifacts/api-server/src/index.ts"],
    forbiddenModulePatterns: [/(?:^|\/)scripts\/src\/migrations(?:\/|$)/iu],
  });
  assert.equal(report.violations.length, 0);
});