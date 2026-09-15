import assert from "node:assert/strict";
import { test } from "node:test";
import { MIGRATION_MANIFEST } from "./manifest";
import { loadMigrations } from "./files";
import { migrationStatus } from "./runner";
import { splitSqlStatements } from "./runner";

test("the Phase 4 manifest is explicit and loads the canonical checksum", async () => {
  assert.deepEqual(MIGRATION_MANIFEST.map((entry) => entry.id), ["000001"]);
  const migrations = await loadMigrations();
  assert.equal(migrations[0]?.checksum, "643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60");
  assert.equal(migrations[0]?.mode, "transactional");
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