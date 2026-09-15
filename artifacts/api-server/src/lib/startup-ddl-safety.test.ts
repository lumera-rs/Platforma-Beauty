import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePoolClient, pool } from "@workspace/db";
import { ensureBookingCommandSchema } from "./booking-command-schema";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { ensureEducationBundlePurchaseSchema } from "./education-bundle-purchase-schema";
import { ensureMarketplacePerformanceIndexes } from "./marketplace-performance-schema";
import { ensureMediaSchema } from "./media-schema";
import { ensureShippingConfigSchema } from "./shipping-config";
import { ensureWebPushSchema } from "./web-push-schema";

type QueryResult = { rows: unknown[] };
type QueryHandler = (sql: string, values: readonly unknown[] | undefined) => QueryResult | void;

class FakeClient {
  readonly queries: string[] = [];
  readonly calls: Array<{ sql: string; values: readonly unknown[] | undefined }> = [];
  released = false;

  constructor(private readonly handler: QueryHandler = () => undefined) {}

  async query(query: unknown, values?: readonly unknown[]): Promise<QueryResult> {
    const sql = typeof query === "string"
      ? query.trim()
      : String((query as { text?: unknown }).text ?? query).trim();
    this.queries.push(sql);
    this.calls.push({ sql, values });
    return this.handler(sql, values) ?? { rows: [] };
  }

  release(): void {
    this.released = true;
  }
}

function fakePool(client: FakeClient): Pick<typeof pool, "connect"> & { connectCount: number } {
  const result = {
    connectCount: 0,
    connect: async () => {
      result.connectCount += 1;
      return client as unknown as DatabasePoolClient;
    },
  };
  return result as unknown as Pick<typeof pool, "connect"> & { connectCount: number };
}

function includesQuery(client: FakeClient, value: string): boolean {
  return client.queries.some((sql) => sql.toLowerCase().includes(value.toLowerCase()));
}

function indexOfQuery(client: FakeClient, value: string): number {
  return client.queries.findIndex((sql) => sql.toLowerCase().includes(value.toLowerCase()));
}

function assertCleanRollback(client: FakeClient, error: unknown): void {
  assert.equal(includesQuery(client, "rollback"), true);
  assert.equal(includesQuery(client, "pg_advisory_unlock"), false);
  assert.equal(client.released, true);
  assert.equal(error instanceof Error, true);
}

test("shipping rolls back a timeout-setup failure before releasing the client", async () => {
  const primary = new Error("shipping timeout setup failed");
  const client = new FakeClient((sql) => {
    if (sql.includes("SET LOCAL lock_timeout")) throw primary;
  });

  await assert.rejects(
    ensureShippingConfigSchema("public", fakePool(client)),
    (error) => error === primary,
  );
  assert.equal(client.queries[0].toLowerCase(), "begin");
  assertCleanRollback(client, primary);
});

test("web push rolls back an advisory-lock failure before releasing the client", async () => {
  const primary = new Error("web push advisory lock failed");
  const client = new FakeClient((sql) => {
    if (sql.includes("pg_advisory_lock")) throw primary;
  });

  await assert.rejects(
    ensureWebPushSchema("public", fakePool(client)),
    (error) => error === primary,
  );
  assert.equal(client.queries[0].toLowerCase(), "begin");
  assertCleanRollback(client, primary);
});

test("marketplace preserves an index failure when timeout restoration also fails", async () => {
  const primary = new Error("concurrent index failed");
  const cleanup = new Error("timeout restore failed");
  const client = new FakeClient((sql) => {
    if (sql === "SHOW lock_timeout") return { rows: [{ lock_timeout: "7s" }] };
    if (sql === "SHOW statement_timeout") return { rows: [{ statement_timeout: "9s" }] };
    if (sql.startsWith("create index concurrently")) throw primary;
    if (sql.includes("set_config('lock_timeout'")) throw cleanup;
    return undefined;
  });

  await assert.rejects(
    ensureMarketplacePerformanceIndexes(fakePool(client)),
    (error) => error === primary,
  );
  assert.equal(includesQuery(client, "pg_advisory_unlock"), true);
  assert.equal(includesQuery(client, "set_config('statement_timeout'"), true);
  assert.equal(client.released, true);
});

test("marketplace surfaces timeout restoration failure after successful indexes", async () => {
  const cleanup = new Error("timeout restore failed");
  const client = new FakeClient((sql) => {
    if (sql === "SHOW lock_timeout") return { rows: [{ lock_timeout: "7s" }] };
    if (sql === "SHOW statement_timeout") return { rows: [{ statement_timeout: "9s" }] };
    if (sql.includes("set_config('lock_timeout'")) throw cleanup;
    return undefined;
  });

  await assert.rejects(
    ensureMarketplacePerformanceIndexes(fakePool(client)),
    (error) => error === cleanup,
  );
  assert.equal(includesQuery(client, "products_category_active_idx"), true);
  assert.equal(client.released, true);
});

test("marketplace restores both previous timeout values after success", async () => {
  const client = new FakeClient((sql) => {
    if (sql === "SHOW lock_timeout") return { rows: [{ lock_timeout: "7s" }] };
    if (sql === "SHOW statement_timeout") return { rows: [{ statement_timeout: "9s" }] };
    return undefined;
  });
  await ensureMarketplacePerformanceIndexes(fakePool(client));
  assertPreviousTimeoutsRestored(client);
  assert.equal(client.released, true);
});

test("marketplace restores both previous timeout values after startup failure", async () => {
  const primary = new Error("concurrent index failed");
  const client = new FakeClient((sql) => {
    if (sql === "SHOW lock_timeout") return { rows: [{ lock_timeout: "7s" }] };
    if (sql === "SHOW statement_timeout") return { rows: [{ statement_timeout: "9s" }] };
    if (sql.startsWith("create index concurrently")) throw primary;
    return undefined;
  });
  await assert.rejects(
    ensureMarketplacePerformanceIndexes(fakePool(client)),
    (error) => error === primary,
  );
  assertPreviousTimeoutsRestored(client);
  assert.equal(client.released, true);
});

test("media executes all 26 operations on one client and commits after them", async () => {
  const client = new FakeClient();
  const poolOverride = fakePool(client);
  await ensureMediaSchema(poolOverride);

  const begin = indexOfQuery(client, "begin");
  const ddlIndexes = client.queries
    .map((sql, index) => ({ sql, index }))
    .filter(({ sql }) => /^DO \$\$|^CREATE TABLE|^ALTER TABLE|^CREATE (?:UNIQUE )?INDEX/i.test(sql))
    .map(({ index }) => index);
  const commit = indexOfQuery(client, "commit");
  assert.equal(poolOverride.connectCount, 1);
  assert.equal(ddlIndexes.length, 26);
  assert.ok(ddlIndexes.every((index) => index > begin && index < commit));
  assert.ok(commit > Math.max(...ddlIndexes));
  assert.equal(includesQuery(client, "pg_advisory_unlock"), true);
  assert.equal(client.released, true);
});

test("media rolls back an injected mid-rollout failure without committing", async () => {
  const primary = new Error("media operation failed");
  let ddlCount = 0;
  const client = new FakeClient((sql) => {
    if (/^DO \$\$|^CREATE TABLE|^ALTER TABLE|^CREATE (?:UNIQUE )?INDEX/i.test(sql)) {
      ddlCount += 1;
      if (ddlCount === 10) throw primary;
    }
  });

  await assert.rejects(ensureMediaSchema(fakePool(client)), (error) => error === primary);
  assert.equal(includesQuery(client, "rollback"), true);
  assert.equal(includesQuery(client, "commit"), false);
  assert.equal(includesQuery(client, "pg_advisory_unlock"), true);
  assert.equal(client.released, true);
});

test("education bundle rolls back replacement failure without committing", async () => {
  const primary = new Error("education trigger replacement failed");
  const client = new FakeClient((sql) => {
    if (sql.includes("DROP TRIGGER IF EXISTS education_bundle_purchases_payment_reference_immutable")) {
      throw primary;
    }
  });

  await assert.rejects(
    ensureEducationBundlePurchaseSchema("public", fakePool(client)),
    (error) => error === primary,
  );
  assert.ok(indexOfQuery(client, "begin") < indexOfQuery(client, "DROP TRIGGER IF EXISTS"));
  assert.equal(includesQuery(client, "rollback"), true);
  assert.equal(includesQuery(client, "commit"), false);
  assert.equal(includesQuery(client, "pg_advisory_unlock"), true);
  assert.equal(client.released, true);
});

test("booking command rolls back index failure without committing", async () => {
  const primary = new Error("booking index failed");
  const client = new FakeClient((sql) => {
    if (sql.includes("booking_command_receipts_scope_key_unique")) throw primary;
  });

  await assert.rejects(
    ensureBookingCommandSchema("public", fakePool(client)),
    (error) => error === primary,
  );
  assert.equal(includesQuery(client, "CREATE TABLE IF NOT EXISTS"), true);
  assert.equal(includesQuery(client, "rollback"), true);
  assert.equal(includesQuery(client, "commit"), false);
  assert.equal(includesQuery(client, "pg_advisory_unlock"), true);
  assert.equal(client.released, true);
});

function businessGrowthHandler(failure?: Error): QueryHandler {
  return (sql, values) => {
    if (sql === "SHOW search_path") return { rows: [{ search_path: '"$user", public' }] };
    if (sql === "SHOW lock_timeout") return { rows: [{ lock_timeout: "7s" }] };
    if (sql === "SHOW statement_timeout") return { rows: [{ statement_timeout: "9s" }] };
    if (failure && sql.includes("education_salon_cleanup_reports")) throw failure;
    if (sql.includes("SELECT to_regclass($1)::text AS relation")) {
      return { rows: [{ relation: "public.business_growth_schema_rollout" }] };
    }
    if (sql.includes("SELECT version FROM")) return { rows: [{ version: 126 }] };
    if (sql.includes("SELECT to_regclass($1) IS NOT NULL AS exists")) {
      return { rows: [{ exists: false }] };
    }
    if (values?.[0] === 99) return { rows: [] };
    return { rows: [] };
  };
}

function assertPreviousTimeoutsRestored(client: FakeClient): void {
  const lockRestore = client.calls.findIndex(({ sql }) => sql.includes("set_config('lock_timeout'"));
  const statementRestore = client.calls.findIndex(({ sql }) => sql.includes("set_config('statement_timeout'"));
  assert.ok(lockRestore >= 0);
  assert.ok(statementRestore > lockRestore);
  assert.deepEqual(client.calls[lockRestore]?.values, ["7s"]);
  assert.deepEqual(client.calls[statementRestore]?.values, ["9s"]);
}

test("business growth restores previous timeouts after success", async () => {
  const client = new FakeClient(businessGrowthHandler());
  await ensureBusinessGrowthSchema("public", fakePool(client));
  assertPreviousTimeoutsRestored(client);
  assert.equal(client.released, true);
});

test("business growth restores previous timeouts after startup failure", async () => {
  const primary = new Error("business growth rollout failed");
  const client = new FakeClient(businessGrowthHandler(primary));
  await assert.rejects(
    ensureBusinessGrowthSchema("public", fakePool(client)),
    (error) => error === primary,
  );
  assertPreviousTimeoutsRestored(client);
  assert.equal(includesQuery(client, "pg_advisory_unlock"), true);
  assert.equal(client.released, true);
});