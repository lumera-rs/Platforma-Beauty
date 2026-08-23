import assert from "node:assert/strict";
import { observeDatabaseQueries, pool } from "@workspace/db";
import {
  ensureShippingConfigSchema,
  getOrCreateShippingConfig,
  runShippingConfigSchemaDdl,
} from "./shipping-config";

const TEST_SCHEMA = `shipping_config_upgrade_test_${Date.now()}`;

async function run(): Promise<void> {
  try {
    await pool.query(`create schema "${TEST_SCHEMA}"`);
    await pool.query(`
      create table "${TEST_SCHEMA}".shipping_rules (
        id uuid primary key,
        free_shipping_threshold integer not null default 0
      )
    `);
    await pool.query(`
      insert into "${TEST_SCHEMA}".shipping_rules (id, free_shipping_threshold)
      values
        ('00000000-0000-0000-0000-000000000001', 700),
        ('ffffffff-ffff-ffff-ffff-ffffffffffff', 9900)
    `);

    const client = await pool.connect();
    try {
      await client.query("begin");
      await runShippingConfigSchemaDdl(client, TEST_SCHEMA);
      await client.query("commit");
      await client.query("begin");
      await runShippingConfigSchemaDdl(client, TEST_SCHEMA);
      await client.query("commit");
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }

    const rows = await pool.query<{ id: string; free_shipping_threshold: number }>(`
      select id, free_shipping_threshold
      from "${TEST_SCHEMA}".shipping_rules
      order by id asc
    `);
    assert.equal(rows.rowCount, 1, "bootstrap must repair legacy duplicates");
    assert.equal(rows.rows[0]!.id, "00000000-0000-0000-0000-000000000001");
    assert.equal(rows.rows[0]!.free_shipping_threshold, 700, "bootstrap must preserve active delivery options");

    await assert.rejects(
      pool.query(`
        insert into "${TEST_SCHEMA}".shipping_rules (id)
        values ('11111111-1111-1111-1111-111111111111')
      `),
      { code: "23505" },
      "the database guard must reject a second shipping rule",
    );

    await ensureShippingConfigSchema();
    const queries: string[] = [];
    const stopObserving = observeDatabaseQueries(({ sql }) => queries.push(sql));
    try {
      const configs = await Promise.all(Array.from(
        { length: 8 },
        () => getOrCreateShippingConfig({ freeShippingThreshold: 1, tiers: [] }),
      ));
      assert.ok(configs.every((config) => config.id === configs[0]!.id));
    } finally {
      stopObserving();
    }
    assert.equal(
      queries.some((query) => /pg_advisory|lock table|create unique index/i.test(query)),
      false,
      "normal concurrent reads must not take the bootstrap lock or run DDL",
    );
  } finally {
    await pool.query(`drop schema if exists "${TEST_SCHEMA}" cascade`).catch(() => {});
  }
}

try {
  await run();
  console.log("Shipping configuration singleton regression passed.");
} finally {
  await pool.end();
}