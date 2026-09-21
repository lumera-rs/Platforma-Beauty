import assert from "node:assert/strict";
import test from "node:test";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import { assertDatabaseMigrationReady } from "@workspace/db/migration-runtime";
import { explicitAdminUrlFromArgs, withOwnedDisposableDatabase } from "../startup-equivalence/fixtures";
import { loadMigrations } from "./files";
import { classifyDeploymentEligibility } from "./deployment-eligibility";
import { applyMigrations } from "./runner";
import { expectedDisposableTarget } from "./disposable-target-fixture";

assertDestructiveTestRuntimeAllowed(process.env, "Migration namespace boundary integration tests");
const adminUrl = explicitAdminUrlFromArgs();
if (!adminUrl) throw new Error("An explicit disposable --admin-url is required");

async function withClient<T>(
  pool: { connect(): Promise<any> },
  callback: (client: any) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

test("unsupported namespaces are rejected before ledger creation and at runtime", async () => {
  await withOwnedDisposableDatabase(adminUrl, async ({ pool }) => {
    await withClient(pool, async (client) => {
      await client.query('CREATE SCHEMA "runtime_shadow"');
      const report = await classifyDeploymentEligibility(client);
      assert.equal(report.path, "UNSUPPORTED");
      assert.deepEqual(report.reasons, ["MIGRATION_NON_PUBLIC_NAMESPACE"]);
      await assert.rejects(() => applyMigrations(client, { expectedTargetIdentity: expectedDisposableTarget(pool) }), /MIGRATION_NON_PUBLIC_NAMESPACE/u);
      assert.equal((await client.query(
        "SELECT to_regclass('public.lumera_migration_ledger') AS ledger",
      )).rows[0].ledger, null);
    });
  });

  await withOwnedDisposableDatabase(adminUrl, async ({ pool }) => {
    const migrations = await loadMigrations();
    await withClient(pool, async (client) => {
      await applyMigrations(client, { expectedTargetIdentity: expectedDisposableTarget(pool) });
      const before = (await client.query(
        "SELECT migration_id, state, checksum FROM public.lumera_migration_ledger ORDER BY migration_id",
      )).rows;
      const accepted = await assertDatabaseMigrationReady(pool);
      assert.equal(accepted.ready, true);
      await client.query('CREATE SCHEMA "runtime_shadow"');
      await assert.rejects(
        () => assertDatabaseMigrationReady(pool),
        (error: unknown) => error instanceof Error
          && error.message === "MIGRATION_READINESS_NON_PUBLIC_NAMESPACE",
      );
      assert.deepEqual((await client.query(
        "SELECT migration_id, state, checksum FROM public.lumera_migration_ledger ORDER BY migration_id",
      )).rows, before);
      assert.equal((await client.query(
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'runtime_shadow') AS present",
      )).rows[0].present, true);
      // Keep the loaded manifest in this proof so the test remains pinned to
      // the same supported transition that was applied above.
      assert.equal(migrations.length >= 2, true);
    });
  });
});