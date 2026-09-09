import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {
  BASELINE_METADATA_SCHEMA,
  BASELINE_METADATA_TABLE,
  BaselineAdoptionRefusedError,
  adoptKnownLegacyBaseline,
  adoptKnownLegacyBaselineInTransaction,
} from "./adoption";
import {
  readPostgresFingerprintCompatibility,
  readPostgresSnapshot,
} from "./catalog";
import type { BaselineEligibilityManifest, ExpectedFingerprint } from "./eligibility";
import { fingerprintSnapshot, type CatalogFingerprintResult } from "./fingerprint";
import {
  acquireBaselineAdoptionLock,
  BASELINE_ADOPTION_ADVISORY_LOCK_KEY,
  beginBaselineAdoptionTransaction,
  beginFingerprintTransaction,
  releaseBaselineAdoptionLock,
} from "./fingerprint-transaction";
import type { SchemaSnapshot } from "./model";
import { ownershipExceptions } from "./ownership";
import { readOnlyQueryLayer } from "./read-only-query";

if (!process.env.DATABASE_URL && process.env.SCHEMA_DRIFT_UNIT_ONLY !== "1") {
  throw new Error("DATABASE_URL is required for adoption integration tests; set SCHEMA_DRIFT_UNIT_ONLY=1 to skip deliberately");
}

function manifest(
  id: string,
  state: ExpectedFingerprint["state"],
  value: CatalogFingerprintResult,
): BaselineEligibilityManifest {
  return {
    formatVersion: 1,
    expected: [{
      id,
      state,
      formatVersion: value.formatVersion,
      algorithm: value.algorithm,
      fingerprintVersion: value.fingerprintVersion,
      schemaFormatVersion: value.schemaFormatVersion,
      structuralFingerprint: value.structuralFingerprint,
      physicalFingerprint: value.physicalFingerprint,
      physicalSnapshot: structuredClone(value.physicalPayload as SchemaSnapshot),
    }],
  };
}

async function currentFingerprint(client: pg.PoolClient): Promise<CatalogFingerprintResult> {
  await beginFingerprintTransaction(client);
  const readOnlyClient = readOnlyQueryLayer(client);
  const postgresCompatibility = await readPostgresFingerprintCompatibility(readOnlyClient);
  const value = fingerprintSnapshot(
    await readPostgresSnapshot(readOnlyClient),
    ownershipExceptions,
    postgresCompatibility,
  );
  await client.query("ROLLBACK");
  return value;
}

test("adopts only a freshly reverified exact legacy fingerprint and records auditable evidence", {
  skip: process.env.SCHEMA_DRIFT_UNIT_ONLY === "1",
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    const live = await currentFingerprint(client);
    const id = `integration-legacy-${process.pid}`;
    const manifestBytes = `${JSON.stringify(manifest(id, "LEGACY", live), null, 2)}\n`;
    await acquireBaselineAdoptionLock(client);
    await beginBaselineAdoptionTransaction(client);
    const request = {
      expectedId: id,
      actor: "schema-adoption-integration-test",
      manifestBytes,
    };
    const result = await adoptKnownLegacyBaselineInTransaction(client, request);
    assert.equal(result.outcome, "ADOPTED");
    assert.equal(result.eligibility.code, "KNOWN_LEGACY");
    const repeated = await adoptKnownLegacyBaselineInTransaction(client, request);
    assert.equal(repeated.outcome, "ALREADY_ADOPTED");
    await assert.rejects(
      () => adoptKnownLegacyBaselineInTransaction(client, {
        ...request,
        expectedId: `${id}-wrong`,
      }),
      (error: unknown) =>
        error instanceof BaselineAdoptionRefusedError
        && error.eligibility.code === "KNOWN_LEGACY",
    );
    await assert.rejects(
      () => adoptKnownLegacyBaselineInTransaction(client, {
        ...request,
        manifestBytes: "{not-json",
      }),
      /not valid JSON/i,
    );

    const recorded = await client.query(`
      SELECT expected_id, structural_fingerprint, physical_fingerprint,
        manifest_sha256, postgres_server_version_num,
        postgres_server_major_version, postgres_deparser_format,
        adopted_by, database_name, adopted_at
      FROM ${BASELINE_METADATA_SCHEMA}.${BASELINE_METADATA_TABLE}
      WHERE expected_id = $1`, [id]);
    assert.equal(recorded.rows.length, 1);
    assert.equal(recorded.rows[0]?.structural_fingerprint, live.structuralFingerprint);
    assert.equal(recorded.rows[0]?.physical_fingerprint, live.physicalFingerprint);
    assert.equal(recorded.rows[0]?.manifest_sha256, result.manifestSha256);
    assert.equal(
      Number(recorded.rows[0]?.postgres_server_version_num),
      live.postgresCompatibility.serverVersionNum,
    );
    assert.equal(
      Number(recorded.rows[0]?.postgres_server_major_version),
      live.postgresCompatibility.serverMajorVersion,
    );
    assert.equal(
      recorded.rows[0]?.postgres_deparser_format,
      live.postgresCompatibility.deparserFormat,
    );
    assert.equal(recorded.rows[0]?.adopted_by, "schema-adoption-integration-test");
    assert.equal(typeof recorded.rows[0]?.database_name, "string");
    assert.ok(recorded.rows[0]?.adopted_at instanceof Date);

    await client.query(`
      UPDATE ${BASELINE_METADATA_SCHEMA}.${BASELINE_METADATA_TABLE}
      SET manifest_sha256 = repeat('0', 64)
      WHERE expected_id = $1`, [id]);
    await assert.rejects(
      () => adoptKnownLegacyBaselineInTransaction(client, request),
      /ledger conflict/i,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await releaseBaselineAdoptionLock(client).catch(() => undefined);
    client.release();
    await pool.end();
  }
});

test("all non-KNOWN_LEGACY classifications roll back without a ledger row", {
  skip: process.env.SCHEMA_DRIFT_UNIT_ONLY === "1",
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    const live = await currentFingerprint(client);
    const id = `integration-current-${process.pid}`;
    const reviewed = manifest(id, "CURRENT", live);
    await assert.rejects(
      async () => {
        await acquireBaselineAdoptionLock(client);
        await beginBaselineAdoptionTransaction(client);
        return adoptKnownLegacyBaselineInTransaction(client, {
        expectedId: id,
        actor: "schema-adoption-integration-test",
        manifestBytes: JSON.stringify(reviewed),
        });
      },
      (error: unknown) =>
        error instanceof BaselineAdoptionRefusedError
        && error.eligibility.code === "ALREADY_CURRENT",
    );
    await client.query("ROLLBACK");
    await releaseBaselineAdoptionLock(client);
    const ledger = await client.query(
      `SELECT to_regclass($1) AS relation`,
      [`${BASELINE_METADATA_SCHEMA}.${BASELINE_METADATA_TABLE}`],
    );
    if (ledger.rows[0]?.relation) {
      const row = await client.query(
        `SELECT 1 FROM ${BASELINE_METADATA_SCHEMA}.${BASELINE_METADATA_TABLE} WHERE expected_id = $1`,
        [id],
      );
      assert.equal(row.rows.length, 0);
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});

test("the production operation commits idempotently, rejects conflicting evidence, and releases its session lock", {
  skip: process.env.SCHEMA_DRIFT_UNIT_ONLY === "1",
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  const observer = await pool.connect();
  const before = await observer.query(
    `SELECT to_regnamespace($1) AS schema_oid, to_regclass($2) AS table_oid`,
    [BASELINE_METADATA_SCHEMA, `${BASELINE_METADATA_SCHEMA}.${BASELINE_METADATA_TABLE}`],
  );
  const schemaExisted = before.rows[0]?.schema_oid !== null;
  const tableExisted = before.rows[0]?.table_oid !== null;
  const id = `integration-committed-${process.pid}`;
  try {
    const live = await currentFingerprint(client);
    const manifestBytes = JSON.stringify(manifest(id, "LEGACY", live));
    const request = {
      expectedId: id,
      actor: "schema-adoption-production-integration-test",
      manifestBytes,
    };
    assert.equal((await adoptKnownLegacyBaseline(client, request)).outcome, "ADOPTED");
    assert.equal((await adoptKnownLegacyBaseline(client, request)).outcome, "ALREADY_ADOPTED");
    await assert.rejects(
      () => adoptKnownLegacyBaseline(client, {
        ...request,
        manifestBytes: `${manifestBytes}\n`,
      }),
      /ledger conflict/i,
    );
    await assert.rejects(
      () => adoptKnownLegacyBaseline(client, {
        ...request,
        manifestBytes: "{not-json",
      }),
      /not valid JSON/i,
    );
    const lock = await observer.query(
      "SELECT pg_catalog.pg_try_advisory_lock($1) AS acquired",
      [BASELINE_ADOPTION_ADVISORY_LOCK_KEY],
    );
    assert.equal(lock.rows[0]?.acquired, true);
    await observer.query("SELECT pg_catalog.pg_advisory_unlock($1)", [
      BASELINE_ADOPTION_ADVISORY_LOCK_KEY,
    ]);
  } finally {
    await observer.query(`
      DELETE FROM ${BASELINE_METADATA_SCHEMA}.${BASELINE_METADATA_TABLE}
      WHERE expected_id = $1`, [id]).catch(() => undefined);
    if (!tableExisted) {
      await observer.query(
        `DROP TABLE IF EXISTS ${BASELINE_METADATA_SCHEMA}.${BASELINE_METADATA_TABLE}`,
      ).catch(() => undefined);
    }
    if (!schemaExisted) {
      await observer.query(
        `DROP SCHEMA IF EXISTS ${BASELINE_METADATA_SCHEMA}`,
      ).catch(() => undefined);
    }
    client.release();
    observer.release();
    await pool.end();
  }
});

test("the adoption advisory lock serializes competing managed schema operations", {
  skip: process.env.SCHEMA_DRIFT_UNIT_ONLY === "1",
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    const tableResult = await second.query(`
      SELECT pg_catalog.format('%I.%I', n.nspname, c.relname) AS table_name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname = 'public'
      ORDER BY n.nspname, c.relname
      LIMIT 1`);
    const tableName = String(tableResult.rows[0]?.table_name);
    assert.notEqual(tableName, "undefined");
    await acquireBaselineAdoptionLock(first);
    await beginBaselineAdoptionTransaction(first);
    await second.query("BEGIN");
    await second.query("SET LOCAL lock_timeout = '100ms'");
    await assert.rejects(
      () => second.query(
        `ALTER TABLE ${tableName} ADD COLUMN schema_adoption_race_probe integer`,
      ),
      /lock timeout|canceling statement/i,
    );
    await second.query("ROLLBACK");
    await second.query("BEGIN");
    await second.query("SET LOCAL lock_timeout = '100ms'");
    await assert.rejects(
      () => second.query(
        `CREATE TABLE public.schema_adoption_relation_probe_${process.pid} (id integer)`,
      ),
      /lock timeout|canceling statement/i,
    );
    await second.query("ROLLBACK");
    await second.query("BEGIN");
    await second.query("SET LOCAL lock_timeout = '100ms'");
    await assert.rejects(
      () => second.query("SELECT pg_catalog.pg_advisory_lock($1)", [
        BASELINE_ADOPTION_ADVISORY_LOCK_KEY,
      ]),
      /lock timeout|canceling statement/i,
    );
  } finally {
    await Promise.all([
      first.query("ROLLBACK").catch(() => undefined),
      second.query("ROLLBACK").catch(() => undefined),
    ]);
    await releaseBaselineAdoptionLock(first).catch(() => undefined);
    first.release();
    second.release();
    await pool.end();
  }
});