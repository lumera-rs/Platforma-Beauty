import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import test from "node:test";

import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import { formatDatabaseCommandFailure } from "./safe-child-process-output.js";

const execFileAsync = promisify(execFile);
const workspaceRoot = new URL("../..", import.meta.url).pathname;
const databaseName = "lumera_ci_database";
const indexName = "retail_cart_items_cart_product_variant_unique";
const commandTimeoutMs = 300_000;

assertDestructiveTestRuntimeAllowed(
  process.env,
  "Retail cart CI preparation regression",
);

type IndexCatalog = {
  oid: string;
  table_name: string;
  method: string;
  columns: string[];
  is_unique: boolean;
  is_valid: boolean;
  is_ready: boolean;
  nulls_not_distinct: boolean;
  is_standalone: boolean;
  has_no_predicate: boolean;
  has_no_expressions: boolean;
  has_no_included_columns: boolean;
  constraint_name: string | null;
  constraint_type: string | null;
  definition: string;
};

type Fixture = { cartId: string; productId: string; itemId: string };
type FixtureRow = {
  id: string;
  cart_id: string;
  product_id: string | null;
  variant_value: string | null;
  quantity: number;
};

function requireCiDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.CI !== "true" || environment.NODE_ENV !== "test") {
    throw new Error(
      "Retail cart CI preparation regression requires CI=true and NODE_ENV=test.",
    );
  }
  const value = environment.DATABASE_URL;
  if (!value) {
    throw new Error(
      "Retail cart CI preparation regression requires DATABASE_URL.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Retail cart CI preparation regression requires a PostgreSQL URL.");
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !loopbackHosts.has(parsed.hostname.toLowerCase())
    || parsed.pathname !== `/${databaseName}`
    || parsed.search !== ""
    || parsed.hash !== ""
  ) {
    throw new Error(
      "Retail cart CI preparation regression requires a loopback lumera_ci_database URL without query or fragment.",
    );
  }
  return value;
}

async function runWrapper(databaseUrl: string): Promise<void> {
  const environment = {
    ...process.env,
    CI: "true",
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
  };
  try {
    await execFileAsync(
      "pnpm",
      ["--filter", "@workspace/scripts", "run", "ensure:retail-cart-index:ci"],
      {
        cwd: workspaceRoot,
        env: environment,
        maxBuffer: 10 * 1024 * 1024,
        timeout: commandTimeoutMs,
      },
    );
  } catch (error) {
    throw formatDatabaseCommandFailure(
      "Running the retail-cart CI reconciliation wrapper",
      error,
      environment,
    );
  }
}

async function catalog(pool: pg.Pool): Promise<IndexCatalog | undefined> {
  const result = await pool.query<IndexCatalog>(
    `SELECT index_relation.oid::text AS oid,
       table_relation.relname AS table_name,
       access_method.amname AS method,
       ARRAY(
         SELECT attribute_data.attname::text
         FROM unnest(index_data.indkey) WITH ORDINALITY key_data(attnum, position)
         JOIN pg_attribute attribute_data
           ON attribute_data.attrelid = index_data.indrelid
          AND attribute_data.attnum = key_data.attnum
         ORDER BY key_data.position
       ) AS columns,
       index_data.indisunique AS is_unique,
       index_data.indisvalid AS is_valid,
       index_data.indisready AS is_ready,
       index_data.indnullsnotdistinct AS nulls_not_distinct,
       NOT EXISTS (
         SELECT 1 FROM pg_constraint constraint_data
          WHERE constraint_data.conindid = index_relation.oid
       ) AS is_standalone,
       index_data.indpred IS NULL AS has_no_predicate,
       index_data.indexprs IS NULL AS has_no_expressions,
       index_data.indnatts = index_data.indnkeyatts AS has_no_included_columns,
       constraint_data.conname AS constraint_name,
       constraint_data.contype AS constraint_type,
       pg_get_indexdef(index_relation.oid) AS definition
      FROM pg_class index_relation
      JOIN pg_namespace index_namespace
        ON index_namespace.oid = index_relation.relnamespace
      JOIN pg_index index_data
        ON index_data.indexrelid = index_relation.oid
      JOIN pg_class table_relation
        ON table_relation.oid = index_data.indrelid
      JOIN pg_am access_method
        ON access_method.oid = index_relation.relam
      LEFT JOIN pg_constraint constraint_data
        ON constraint_data.conindid = index_relation.oid
     WHERE index_namespace.nspname = 'public'
       AND index_relation.relname = $1`,
    [indexName],
  );
  return result.rows[0];
}

function assertPreparedIndex(value: IndexCatalog | undefined): asserts value is IndexCatalog {
  assert.ok(value, "The prepared retail-cart index is missing.");
  assert.equal(value.table_name, "retail_cart_items");
  assert.equal(value.method, "btree");
  assert.deepEqual(value.columns, ["cart_id", "product_id", "variant_value"]);
  assert.equal(value.is_unique, true);
  assert.equal(value.is_valid, true);
  assert.equal(value.is_ready, true);
  assert.equal(value.nulls_not_distinct, true);
  assert.equal(value.is_standalone, true);
  assert.equal(value.has_no_predicate, true);
  assert.equal(value.has_no_expressions, true);
  assert.equal(value.has_no_included_columns, true);
  assert.equal(value.constraint_name, null);
  assert.equal(value.constraint_type, null);
  assert.match(value.definition, /NULLS NOT DISTINCT$/);
}

async function rows(pool: pg.Pool): Promise<FixtureRow[]> {
  return (
    await pool.query<FixtureRow>(
      `SELECT id::text, cart_id::text, product_id::text, variant_value, quantity
         FROM public.retail_cart_items
        ORDER BY id`,
    )
  ).rows;
}

async function createFixture(pool: pg.Pool): Promise<Fixture> {
  const fixture = {
    cartId: randomUUID(),
    productId: randomUUID(),
    itemId: randomUUID(),
  };
  await pool.query(
    `INSERT INTO public.products
      (id, category_name, name, description, image_url, price, sku, unit,
       retail_enabled, active, stock)
     VALUES ($1, 'CI fixture', 'CI retail cart fixture', 'CI fixture product',
       'https://example.invalid/ci-retail-cart.png', 100, $2, 'piece',
       true, true, 10)`,
    [fixture.productId, `ci-retail-cart-${randomUUID()}`],
  );
  await pool.query(
    `INSERT INTO public.retail_carts (id, token_hash)
     VALUES ($1, $2)`,
    [fixture.cartId, `ci-retail-cart-token-${randomUUID()}`],
  );
  await pool.query(
    `INSERT INTO public.retail_cart_items
      (id, cart_id, product_id, variant_value, product_name,
       product_image_url, unit_price, quantity)
     VALUES ($1, $2, $3, NULL, 'CI retail cart fixture',
       'https://example.invalid/ci-retail-cart.png', 100, 1)`,
    [fixture.itemId, fixture.cartId, fixture.productId],
  );
  return fixture;
}

async function removeFixture(pool: pg.Pool, fixture: Fixture): Promise<void> {
  await pool.query("DELETE FROM public.retail_carts WHERE id = $1", [fixture.cartId]);
  await pool.query("DELETE FROM public.products WHERE id = $1", [fixture.productId]);
}

test("fresh CI preparation leaves a safe retail-cart index", {
  timeout: commandTimeoutMs,
}, async () => {
  const databaseUrl = requireCiDatabaseUrl();
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 15_000,
  });
  let fixture: Fixture | undefined;
  let wrongShapeNeedsRestore = false;
  let cleanupError: unknown;

  try {
    // CI has already executed push-force followed by the narrow wrapper.
    const prepared = await catalog(pool);
    assertPreparedIndex(prepared);

    fixture = await createFixture(pool);
    const beforeDuplicate = await rows(pool);
    assert.ok(beforeDuplicate.some((row) => row.id === fixture?.itemId));
    await assert.rejects(
      pool.query(
        `INSERT INTO public.retail_cart_items
          (cart_id, product_id, variant_value, product_name,
           product_image_url, unit_price, quantity)
         VALUES ($1, $2, NULL, 'CI duplicate fixture',
           'https://example.invalid/ci-retail-cart-duplicate.png', 100, 1)`,
        [fixture.cartId, fixture.productId],
      ),
      (error: unknown) => {
        if (!error || typeof error !== "object" || !("code" in error)) return false;
        return (error as { code?: string }).code === "23505";
      },
    );
    assert.deepEqual(await rows(pool), beforeDuplicate);

    const beforeReplay = await catalog(pool);
    assertPreparedIndex(beforeReplay);
    await runWrapper(databaseUrl);
    const afterReplay = await catalog(pool);
    assertPreparedIndex(afterReplay);
    assert.deepEqual(afterReplay, beforeReplay, "replay must preserve the catalog");

    const beforeWrongShape = await rows(pool);
    wrongShapeNeedsRestore = true;
    await pool.query(`DROP INDEX "public"."${indexName}"`);
    await pool.query(
      `CREATE UNIQUE INDEX "${indexName}" ON public.retail_cart_items (id)`,
    );
    const wrongShape = await catalog(pool);
    assert.ok(wrongShape);
    assert.deepEqual(wrongShape.columns, ["id"]);
    let rejected = false;
    try {
      await runWrapper(databaseUrl);
    } catch (error) {
      rejected = true;
      assert.match(
        String((error as { message?: string }).message),
        /Unexpected retail cart index|wrong-shaped|refusing/i,
      );
    }
    assert.equal(rejected, true, "wrong-shaped indexes must fail closed");
    assert.deepEqual(await catalog(pool), wrongShape);
    assert.deepEqual(await rows(pool), beforeWrongShape);
  } finally {
    try {
      if (wrongShapeNeedsRestore) {
        await pool.query(`DROP INDEX IF EXISTS "public"."${indexName}"`);
        await runWrapper(databaseUrl);
      }
      if (fixture) await removeFixture(pool, fixture);
    } catch (error) {
      cleanupError = error;
    } finally {
      try {
        await pool.end();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (cleanupError) throw cleanupError;
  }
});