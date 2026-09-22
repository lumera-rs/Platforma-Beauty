import assert from "node:assert/strict";
import test from "node:test";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import { explicitAdminUrlFromArgs, withOwnedDisposableDatabase } from "../startup-equivalence/fixtures";
import { expectedDisposableTarget } from "./disposable-target-fixture";
import { applyMigrations, adoptBaseline } from "./runner";
import { loadMigrations } from "./files";
import { prepareDevelopmentMigrations } from "./prepare-development";
import type pg from "pg";

assertDestructiveTestRuntimeAllowed();
const adminUrl = explicitAdminUrlFromArgs();
if (!adminUrl) throw new Error("Explicit owned disposable --admin-url required");

async function snapshot(client: pg.PoolClient): Promise<unknown> {
  const tables = (await client.query(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename",
  )).rows;
  const rows: Record<string, unknown> = {};
  for (const { tablename } of tables) {
    rows[tablename] = (await client.query(
      `SELECT to_jsonb(t) AS row FROM public."${tablename.replaceAll('"', '""')}" t ORDER BY to_jsonb(t)::text`,
    )).rows;
  }
  return { tables, rows, ledger: (await client.query(
    "SELECT to_regclass('public.lumera_migration_ledger') AS ledger",
  )).rows };
}

test("workspace production label permits explicit matching identity and development preparation", async () => {
  await withOwnedDisposableDatabase(adminUrl, async ({ pool }) => {
    const client = await pool.connect();
    const previous = process.env.REPLIT_ENVIRONMENT;
    process.env.REPLIT_ENVIRONMENT = "production";
    try {
      const result = await prepareDevelopmentMigrations(client, {
        expectedTargetIdentity: expectedDisposableTarget(pool),
      });
      assert.deepEqual(result.migration.applied, ["000001", "000002", "000003", "000004"]);
      assert.deepEqual((await applyMigrations(client, {
        expectedTargetIdentity: expectedDisposableTarget(pool),
      })).skipped, ["000001", "000002", "000003", "000004"]);
    } finally {
      if (previous === undefined) delete process.env.REPLIT_ENVIRONMENT;
      else process.env.REPLIT_ENVIRONMENT = previous;
      client.release();
    }
  });
});

test("each real deployment marker refuses apply and adoption without changing disposable fixture", async () => {
  await withOwnedDisposableDatabase(adminUrl, async ({ pool }) => {
    const client = await pool.connect();
    try {
      await client.query((await loadMigrations())[0]!.body);
      const before = await snapshot(client);
      const cases = [
        ["NODE_ENV", "production"],
        ...["1", "true", "TRUE", "TrUe"].flatMap((value) => [
          ["REPLIT_DEPLOYMENT", value], ["REPL_DEPLOYMENT", value],
        ]),
        ["REPLIT_DEPLOYMENT_ID", "id"], ["REPL_DEPLOYMENT_ID", "id"],
        ["REPLIT_DEPLOYMENT_ID", ""], ["REPL_DEPLOYMENT_ID", ""],
      ];
      for (const [key, value] of cases) {
        const previous = process.env[key!];
        process.env[key!] = value;
        try {
          for (const run of [applyMigrations, adoptBaseline]) {
            await assert.rejects(() => run(client, { expectedTargetIdentity: expectedDisposableTarget(pool) }), /development-only/u);
          }
        } finally {
          if (previous === undefined) delete process.env[key!];
          else process.env[key!] = previous;
        }
        assert.deepEqual(await snapshot(client), before);
      }
    } finally { client.release(); }
  });
});

test("each mismatched or absent identity refuses before locks and preserves all rows and absent ledger", async () => {
  await withOwnedDisposableDatabase(adminUrl, async ({ pool }) => {
    const client = await pool.connect();
    try {
      await client.query((await loadMigrations())[0]!.body);
      await client.query("INSERT INTO public.business_growth_schema_rollout(version) VALUES (99999)");
      const before = await snapshot(client);
      const expected = expectedDisposableTarget(pool);
      for (const wrong of [
        undefined, { ...expected, databaseName: "wrong_database" },
        { ...expected, systemIdentifier: expected.systemIdentifier === "1" ? "2" : "1" },
        { ...expected, transport: "encrypted" as const },
      ]) {
        for (const run of [applyMigrations, adoptBaseline]) {
          const statements: string[] = [];
          const observedClient = { async query(sql: string, values?: unknown[]) {
            statements.push(sql);
            return client.query(sql, values);
          } };
          await assert.rejects(() => run(observedClient, { expectedTargetIdentity: wrong }), /identity/u);
          assert.ok(statements.every((sql) => sql.includes("pg_control_system")));
          assert.ok(statements.length <= 1);
          assert.deepEqual(await snapshot(client), before);
        }
      }
    } finally { client.release(); }
  });
});

test("unavailable system identifier permission fails closed with no mutation or ledger", async () => {
  await withOwnedDisposableDatabase(adminUrl, async ({ pool, name }) => {
    const client = await pool.connect();
    const role = `identity_denied_${process.pid}`;
    try {
      await client.query((await loadMigrations())[0]!.body);
      const before = await snapshot(client);
      await client.query(`CREATE ROLE "${role}"`);
      await client.query(`GRANT CONNECT ON DATABASE "${name}" TO "${role}"`);
      await client.query("REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC");
      for (const run of [applyMigrations, adoptBaseline]) {
        await client.query(`SET ROLE "${role}"`);
        try {
          await assert.rejects(() => run(client, {
            expectedTargetIdentity: expectedDisposableTarget(pool),
          }), /indeterminate/u);
        } finally { await client.query("RESET ROLE"); }
        assert.deepEqual(await snapshot(client), before);
      }
    } finally {
      await client.query("RESET ROLE");
      await client.query(`DROP OWNED BY "${role}"`);
      await client.query(`DROP ROLE "${role}"`);
      client.release();
    }
  });
});

test("baseline-only apply and adoption verify matching identity on first run and replay", async () => {
  const migrations = [(await loadMigrations())[0]!];
  for (const operation of ["apply", "adopt"] as const) {
    await withOwnedDisposableDatabase(adminUrl, async ({ pool }) => {
      const client = await pool.connect();
      try {
        const options = { migrations, expectedTargetIdentity: expectedDisposableTarget(pool) };
        if (operation === "apply") {
          assert.deepEqual((await applyMigrations(client, options)).applied, ["000001"]);
        } else {
          await client.query(migrations[0]!.body);
          assert.deepEqual((await adoptBaseline(client, options)).adopted, ["000001"]);
        }
        const before = await snapshot(client);
        assert.deepEqual((await applyMigrations(client, options)).skipped, ["000001"]);
        // The schema-only helper reports the verified baseline even on replay.
        assert.deepEqual((await adoptBaseline(client, options)).adopted, ["000001"]);
        assert.deepEqual(await snapshot(client), before);
      } finally { client.release(); }
    });
  }
});

test("baseline-only and empty flows fail closed before locks with absent, applied, or adopted ledger", async () => {
  const baseline = [(await loadMigrations())[0]!];
  for (const state of ["absent", "applied", "adopted"] as const) {
    await withOwnedDisposableDatabase(adminUrl, async ({ pool, name }) => {
      const client = await pool.connect();
      const role = `narrow_identity_denied_${process.pid}`;
      try {
        const expected = expectedDisposableTarget(pool);
        const options = { migrations: baseline, expectedTargetIdentity: expected };
        if (state === "applied") await applyMigrations(client, options);
        else {
          await client.query(baseline[0]!.body);
          if (state === "adopted") await adoptBaseline(client, options);
        }
        const before = await snapshot(client);
        await client.query(`CREATE ROLE "${role}"`);
        await client.query(`GRANT CONNECT ON DATABASE "${name}" TO "${role}"`);
        await client.query("REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC");
        for (const migrations of [baseline, []]) {
          for (const run of [applyMigrations, adoptBaseline]) {
            for (const fault of ["missing", "name", "system", "transport", "denied", "unreadable"]) {
              const statements: string[] = [];
              const observed = { async query(sql: string, values?: unknown[]) {
                statements.push(sql);
                const result = await client.query(sql, values);
                // Simulate an unreadable proxy result while still exercising the real backend read.
                return fault === "unreadable" ? { rows: [] } : result;
              } };
              const identity = fault === "missing" ? undefined : {
                ...expected,
                ...(fault === "name" ? { databaseName: "wrong_database" } : {}),
                ...(fault === "system" ? { systemIdentifier: expected.systemIdentifier === "1" ? "2" : "1" } : {}),
                ...(fault === "transport" ? { transport: "encrypted" as const } : {}),
              };
              if (fault === "denied") await client.query(`SET ROLE "${role}"`);
              try {
                await assert.rejects(() => run(observed, {
                  migrations, expectedTargetIdentity: identity,
                }), /identity/u);
              } finally {
                if (fault === "denied") await client.query("RESET ROLE");
              }
              assert.equal(statements.length, fault === "missing" ? 0 : 1);
              assert.ok(statements.every((sql) => sql.includes("pg_control_system")));
              assert.deepEqual(await snapshot(client), before);
            }
          }
        }
      } finally {
        await client.query("RESET ROLE");
        await client.query(`DROP OWNED BY "${role}"`);
        await client.query(`DROP ROLE "${role}"`);
        client.release();
      }
    });
  }
});