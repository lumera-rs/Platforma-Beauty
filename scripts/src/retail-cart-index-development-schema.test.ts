import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getTableConfig } from "drizzle-orm/pg-core";
import { closePool, pool, retailCartItemsTable } from "@workspace/db";
import {
  assertDestructiveTestRuntimeAllowed,
  destructiveTestGuardEnvironments,
} from "@workspace/db/destructive-test-runtime";
import { ensureRetailCartIndexDevelopmentSchema } from "./retail-cart-index-development-schema";

assertDestructiveTestRuntimeAllowed(process.env, "Retail cart index development tests");
const schema = `retail_index_test_${randomUUID().replaceAll("-", "")}`;
const table = `"${schema}".retail_cart_items`;
const name = "retail_cart_items_cart_product_variant_unique";
const cart = randomUUID();
const product = randomUUID();

async function catalog() {
  const { rows } = await pool.query(
    `SELECT i.indnullsnotdistinct, i.indisvalid, i.indisunique, c.oid,
       con.conname, pg_get_indexdef(c.oid) AS definition
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     JOIN pg_index i ON i.indexrelid=c.oid
     LEFT JOIN pg_constraint con ON con.conindid=c.oid
     WHERE n.nspname=$1 AND c.relname=$2`,
    [schema, name],
  );
  return rows[0];
}

async function contents() {
  return (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
}

async function insert(variant: string | null, cartId = cart, productId = product) {
  return pool.query(
    `INSERT INTO ${table} (cart_id,product_id,variant_value,quantity) VALUES ($1,$2,$3,2)`,
    [cartId, productId, variant],
  );
}

async function run() {
  const config = getTableConfig(retailCartItemsTable);
  assert.equal(config.uniqueConstraints.some((c) => c.name === name), false);
  const declaration = config.indexes.find((i) => i.config.name === name);
  assert.equal(declaration?.config.unique, true);
  assert.deepEqual(declaration?.config.columns.map((c) => "name" in c ? c.name : null),
    ["cart_id", "product_id", "variant_value"]);

  // The actual entrypoint must refuse every known production/deployment signal.
  for (const guard of destructiveTestGuardEnvironments) {
    const previous = new Map(Object.keys(guard.values).map((key) => [key, process.env[key]]));
    try {
      Object.assign(process.env, guard.values);
      await assert.rejects(ensureRetailCartIndexDevelopmentSchema(schema), /refuses production/);
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
  await assert.rejects(ensureRetailCartIndexDevelopmentSchema('public"; DROP TABLE x'), /Invalid schema/);
  await pool.query(`CREATE SCHEMA "${schema}"`);
  try {
    await pool.query(`CREATE TABLE ${table} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cart_id uuid NOT NULL,
      product_id uuid, variant_value text, quantity integer NOT NULL,
      CONSTRAINT "${name}" UNIQUE NULLS NOT DISTINCT (cart_id,product_id,variant_value)
    )`);
    await insert(null);
    await insert("blue");
    await insert("red");
    await insert(null, randomUUID());
    await insert(null, cart, randomUUID());
    const before = await contents();
    assert.ok((await catalog()).conname, "fixture starts with constraint-owned index");
    assert.deepEqual(await ensureRetailCartIndexDevelopmentSchema(schema), { changed: true });
    assert.deepEqual(await contents(), before, "every row and quantity survives conversion");
    const index = await catalog();
    assert.equal(index.conname, null);
    assert.equal(index.indnullsnotdistinct, true);
    assert.equal(index.indisvalid, true);
    assert.equal(index.indisunique, true);
    assert.match(index.definition, /NULLS NOT DISTINCT$/);
    assert.deepEqual(await ensureRetailCartIndexDevelopmentSchema(schema), { changed: false });
    assert.equal((await catalog()).oid, index.oid, "replay leaves existing index untouched");
    await assert.rejects(insert(null), { code: "23505" });
    await assert.rejects(insert("blue"), { code: "23505" });

    // Empty/missing index and ordinary legacy constraints must also reconcile.
    await pool.query(`DROP INDEX "${schema}"."${name}"`);
    assert.deepEqual(await ensureRetailCartIndexDevelopmentSchema(schema), { changed: true });
    await pool.query(`DROP INDEX "${schema}"."${name}"`);
    await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT "${name}" UNIQUE (cart_id,product_id,variant_value)`);
    assert.deepEqual(await ensureRetailCartIndexDevelopmentSchema(schema), { changed: true });
    assert.equal((await catalog()).indnullsnotdistinct, true);

    // Do not silently deduplicate or lose data if a weaker source has duplicates.
    await pool.query(`DROP INDEX "${schema}"."${name}"`);
    await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT "${name}" UNIQUE (cart_id,product_id,variant_value)`);
    await insert(null);
    const duplicateRows = await contents();
    const weakIndex = await catalog();
    await assert.rejects(ensureRetailCartIndexDevelopmentSchema(schema), { code: "23505" });
    assert.deepEqual(await contents(), duplicateRows);
    assert.equal((await catalog()).oid, weakIndex.oid, "failed conversion restores original constraint");
    assert.equal((await catalog()).conname, name);

    // Refuse a same-named index over a different key instead of destroying it.
    await pool.query(`ALTER TABLE ${table} DROP CONSTRAINT "${name}"`);
    await pool.query(`CREATE UNIQUE INDEX "${name}" ON ${table} (id)`);
    const unexpected = await catalog();
    await assert.rejects(ensureRetailCartIndexDevelopmentSchema(schema), /Unexpected retail cart index/);
    assert.equal((await catalog()).oid, unexpected.oid);
    assert.deepEqual(await contents(), duplicateRows);
    console.log("✓ retail cart index: standalone, NULL-safe, row-preserving, replay-safe, rollback-safe, development-only");
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
}

try {
  await run();
} finally {
  await closePool();
}