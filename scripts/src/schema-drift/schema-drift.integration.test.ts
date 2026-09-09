import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { buildCanonicalSnapshot } from "./canonical";
import { readPostgresSnapshot } from "./catalog";
import { compareSchemas } from "./compare";
import { ownershipExceptions } from "./ownership";

test("current database exposes all six confirmed Education B2B findings read-only", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const client = {
      query(text: string, values?: unknown[]) {
        assert.match(text, /^\s*(SELECT|WITH)\b/i);
        return pool.query(text, values);
      },
    };
    const report = compareSchemas(
      buildCanonicalSnapshot(),
      await readPostgresSnapshot(client),
      ownershipExceptions,
    );
    const found = new Set(report.findings
      .filter((x) => x.objectPath.startsWith("public.education_b2b_orders."))
      .map((x) => `${x.objectType}:${x.objectName}`));
    for (const expected of [
      "COLUMN:idempotency_key",
      "COLUMN:idempotency_fingerprint",
      "INDEX:education_b2b_orders_center_idempotency_unique",
      "CHECK:education_b2b_orders_payment_status_check",
      "CHECK:education_b2b_orders_fulfillment_status_check",
      "CHECK:education_b2b_orders_refund_check",
    ]) assert.ok(found.has(expected), `missing confirmed finding ${expected}`);
  } finally {
    await pool.end();
  }
});