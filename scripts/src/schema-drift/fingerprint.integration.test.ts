import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { readPostgresFingerprintCompatibility, readPostgresSnapshot } from "./catalog";
import { fingerprintSnapshot } from "./fingerprint";
import { beginFingerprintTransaction } from "./fingerprint-transaction";
import { ownershipExceptions } from "./ownership";
import { readOnlyQueryLayer } from "./read-only-query";

if (!process.env.DATABASE_URL && process.env.SCHEMA_DRIFT_UNIT_ONLY !== "1") {
  throw new Error("DATABASE_URL is required for fingerprint integration tests; set SCHEMA_DRIFT_UNIT_ONLY=1 to skip deliberately");
}

test("current database fingerprint is stable across three read-only catalog reads", {
  skip: process.env.SCHEMA_DRIFT_UNIT_ONLY === "1",
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const results = [];
    const initialSettings = [
      { searchPath: "public, pg_catalog", intervalStyle: "postgres", dateStyle: "ISO, MDY", timeZone: "Europe/Belgrade" },
      { searchPath: "pg_catalog", intervalStyle: "iso_8601", dateStyle: "SQL, DMY", timeZone: "UTC" },
      { searchPath: "\"$user\", public", intervalStyle: "sql_standard", dateStyle: "Postgres, YMD", timeZone: "America/New_York" },
    ];
    for (let run = 0; run < 3; run += 1) {
      const client = await pool.connect();
      try {
        const settings = initialSettings[run]!;
        await client.query(`SET SESSION search_path = ${settings.searchPath}`);
        await client.query(`SET SESSION IntervalStyle = '${settings.intervalStyle}'`);
        await client.query(`SET SESSION DateStyle = '${settings.dateStyle}'`);
        await client.query(`SET SESSION TimeZone = '${settings.timeZone}'`);
        await beginFingerprintTransaction(client);
        const readOnlyClient = readOnlyQueryLayer(client);
        const postgresCompatibility = await readPostgresFingerprintCompatibility(readOnlyClient);
        results.push(fingerprintSnapshot(
          await readPostgresSnapshot(readOnlyClient),
          ownershipExceptions,
          postgresCompatibility,
        ));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    assert.equal(results[0]!.structuralFingerprint, results[1]!.structuralFingerprint);
    assert.equal(results[1]!.structuralFingerprint, results[2]!.structuralFingerprint);
    assert.equal(results[0]!.physicalFingerprint, results[1]!.physicalFingerprint);
    assert.equal(results[1]!.physicalFingerprint, results[2]!.physicalFingerprint);
  } finally {
    await pool.end();
  }
});
