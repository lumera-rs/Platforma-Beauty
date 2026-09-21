import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMigrationCliOptions, safeErrorText } from "./cli";
import { MIGRATION_MANIFEST } from "./manifest";
import { loadMigrations } from "./files";
import { applyMigrations, migrationStatus, splitSqlStatements } from "./runner";
import type { LoadedMigration } from "./types";

test("the manifest preserves the canonical baseline and pins the guarded data transition", async () => {
  assert.deepEqual(MIGRATION_MANIFEST.map((entry) => entry.id), ["000001", "000002"]);
  const migrations = await loadMigrations();
  assert.equal(migrations[0]?.checksum, "643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60");
  assert.equal(migrations[0]?.mode, "transactional");
  assert.equal(migrations[0]?.admissionContract, undefined);
  assert.equal(migrations[1]?.admissionContract, "supported-startup-v1");
  assert.equal(migrations[1]?.mode, "transactional");
  assert.equal(migrations[1]?.checksum, "a8c910eb9bd60281aa80e343b4b1d6e02a45222293b123ab198fab4315d48e62");
});

test("status does not create a missing ledger", async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      const error = new Error("missing relation") as Error & { code: string };
      error.code = "42P01";
      throw error;
    },
  };
  const status = await migrationStatus(client, []);
  assert.deepEqual(status, []);
  assert.equal(queries.length, 1);
  assert.match(queries[0]!, /SELECT migration_id/u);
  assert.doesNotMatch(queries[0]!, /CREATE TABLE/u);
});

test("migration modules do not require a database URL on import", async () => {
  assert.equal(typeof MIGRATION_MANIFEST[0]?.id, "string");
});

test("nontransactional statement splitting preserves quoted semicolons", () => {
  assert.deepEqual(
    splitSqlStatements("CREATE TABLE a (value text); SELECT '$'; DO $$ BEGIN PERFORM 1; END $$;"),
    ["CREATE TABLE a (value text)", "SELECT '$'", "DO $$ BEGIN PERFORM 1; END $$"],
  );
});

function fakeMigration(mode: "transactional" | "nontransactional" = "transactional"): LoadedMigration {
  return {
    id: "000001",
    directory: "test",
    checksum: "test-checksum",
    mode,
    description: "test migration",
    structuralFingerprint: "structural",
    physicalFingerprint: "physical",
    fingerprintVersion: 1,
    formatVersion: 1,
    postgresMajor: 16,
    postgresVersionNum: 160000,
    normalizedObjectCount: 0,
    enumCount: 0,
    triggerCount: 0,
    functionCount: 0,
    sql: "",
    body: "SELECT migration failure",
    preconditions: [],
    postconditions: [],
    recovery: "",
  };
}

interface FailureClientOptions {
  readonly migrationError?: Error;
  readonly failMarkFailed?: boolean;
  readonly failRollback?: boolean;
  readonly failUnlock?: boolean;
}

function failureClient(options: FailureClientOptions = {}) {
  const migrationError = options.migrationError ?? new Error("migration SQL failed");
  return {
    async query(sql: string) {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
      if (sql.includes("pg_advisory_unlock")) {
        if (options.failUnlock) throw new Error("unlock cleanup failed");
        return { rows: [] };
      }
      if (sql.includes("SELECT migration_id")) return { rows: [] };
      if (sql.includes("SELECT migration failure")) throw migrationError;
      if (sql === "ROLLBACK" && options.failRollback) throw new Error("rollback cleanup failed");
      if (sql.includes("SET state = 'FAILED'")) {
        if (options.failMarkFailed) throw new Error("markFailed cleanup failed");
        return { rows: [{}] };
      }
      if (sql.includes("SET state = $2")) return { rows: [{}] };
      if (sql.includes("INSERT INTO")) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("B3-A preserves the migration error when markFailed succeeds", async () => {
  const migrationError = new Error("primary migration error");
  await assert.rejects(
    () => applyMigrations(failureClient({ migrationError }), { migrations: [fakeMigration()] }),
    (error: unknown) => error === migrationError,
  );
});

test("B3-B preserves the migration error when markFailed fails", async () => {
  const migrationError = new Error("primary migration error");
  await assert.rejects(
    () => applyMigrations(failureClient({ migrationError, failMarkFailed: true }), { migrations: [fakeMigration()] }),
    (error: unknown) => error === migrationError,
  );
});

test("B3-C preserves the migration error when advisory unlock fails", async () => {
  const migrationError = new Error("primary migration error");
  await assert.rejects(
    () => applyMigrations(failureClient({ migrationError, failUnlock: true }), { migrations: [fakeMigration()] }),
    (error: unknown) => error === migrationError,
  );
});

test("B3-D surfaces advisory unlock failure after a successful migration", async () => {
  const migration = { ...fakeMigration(), body: "SELECT migration success" };
  await assert.rejects(
    () => applyMigrations(failureClient({ failUnlock: true }), { migrations: [migration] }),
    /unlock cleanup failed/u,
  );
});

test("B3-E preserves the migration error when rollback fails", async () => {
  const migrationError = new Error("primary migration error");
  await assert.rejects(
    () => applyMigrations(failureClient({ migrationError, failRollback: true }), { migrations: [fakeMigration()] }),
    (error: unknown) => error === migrationError,
  );
});

test("B4 handles standard strings, identifiers, escape strings, dollar quotes, comments, and DO blocks", () => {
  assert.deepEqual(
    splitSqlStatements("SELECT 'ordinary\\'; SELECT 1"),
    ["SELECT 'ordinary\\'", "SELECT 1"],
  );
  assert.deepEqual(
    splitSqlStatements('CREATE TABLE "identifier\\;name" (id integer); SELECT 1'),
    ['CREATE TABLE "identifier\\;name" (id integer)', "SELECT 1"],
  );
  assert.deepEqual(
    splitSqlStatements("SELECT E'it\\'s; still one'; SELECT 2"),
    ["SELECT E'it\\'s; still one'", "SELECT 2"],
  );
  assert.deepEqual(
    splitSqlStatements("SELECT some_name_e'ordinary\\'; SELECT 9"),
    ["SELECT some_name_e'ordinary\\'", "SELECT 9"],
  );
  assert.deepEqual(
    splitSqlStatements("CREATE FUNCTION f() RETURNS void AS $body$ BEGIN PERFORM 1; END $body$; SELECT 3"),
    ["CREATE FUNCTION f() RETURNS void AS $body$ BEGIN PERFORM 1; END $body$", "SELECT 3"],
  );
  assert.deepEqual(
    splitSqlStatements("/* outer /* nested; comment */ still comment */ SELECT 4"),
    ["/* outer /* nested; comment */ still comment */ SELECT 4"],
  );
  assert.deepEqual(
    splitSqlStatements("DO $$ BEGIN RAISE NOTICE 'inside; do'; END $$; SELECT 5"),
    ["DO $$ BEGIN RAISE NOTICE 'inside; do'; END $$", "SELECT 5"],
  );
});

test("B5 refuses mutating commands that rely on ambient DATABASE_URL", () => {
  for (const command of ["apply", "adopt-baseline"] as const) {
    assert.throws(
      () => parseMigrationCliOptions([command], { DATABASE_URL: "postgresql://user:password@production.invalid/db" }),
      /explicit --database-url target/u,
    );
  }
});

test("B5 requires confirmation and accepts an explicit target without contacting a database", () => {
  assert.throws(
    () => parseMigrationCliOptions(["apply", "--database-url=postgresql://user:password@db.invalid/db"], {}),
    /explicit confirmation/u,
  );
  assert.deepEqual(
    parseMigrationCliOptions(
      ["adopt-baseline", "--database-url=postgresql://user:password@db.invalid/db", "--confirm",
        "--expected-database=db", "--expected-system-identifier=123", "--expected-transport=unencrypted"],
      { DATABASE_URL: "postgresql://ambient.invalid/db" },
    ),
    { command: "adopt-baseline", databaseUrl: "postgresql://user:password@db.invalid/db",
      expectedTargetIdentity: { databaseName: "db", systemIdentifier: "123", transport: "unencrypted" } },
  );
});

test("B5 redacts database URLs and passwords from CLI errors", () => {
  const message = safeErrorText(
    new Error("connect failed for postgresql://operator:super-secret@database.invalid/lumera"),
  );
  assert.equal(message, "connect failed for <redacted-database-url>");
  assert.doesNotMatch(message, /operator|super-secret|database\.invalid/u);
});