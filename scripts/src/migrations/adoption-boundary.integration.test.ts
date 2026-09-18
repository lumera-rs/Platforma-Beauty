import assert from "node:assert/strict";
import test from "node:test";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import { explicitAdminUrlFromArgs, withOwnedDisposableDatabase } from "../startup-equivalence/fixtures";
import { loadMigrations } from "./files";
import { adoptBaseline, applyMigrations } from "./runner";

assertDestructiveTestRuntimeAllowed();
const adminUrl = explicitAdminUrlFromArgs();
if (!adminUrl) throw new Error("An explicit disposable --admin-url is required");

test("supported adoption and receipt boundaries preserve unsupported state", async () => {
  await withOwnedDisposableDatabase(adminUrl, async ({ pool }) => {
    const client = await pool.connect();
    try {
      const migrations = await loadMigrations();
      await client.query(migrations[0]!.body);
      await client.query("INSERT INTO public.business_growth_schema_rollout(version) VALUES (99999)");
      const readHistory = async () => (await client.query(
        "SELECT to_jsonb(r) AS row FROM public.business_growth_schema_rollout r",
      )).rows;
      const before = await readHistory();
      await assert.rejects(() => adoptBaseline(client), /SUPPORTED_STARTUP/u);
      assert.equal((await client.query(
        "SELECT to_regclass('public.lumera_migration_ledger') AS ledger",
      )).rows[0].ledger, null);
      assert.deepEqual(await readHistory(), before);

      // Remove only this test's own deliberately unsupported fixture row.
      await client.query("DELETE FROM public.business_growth_schema_rollout WHERE version = 99999");
      assert.deepEqual((await adoptBaseline(client)).adopted, ["000001"]);
      assert.deepEqual((await applyMigrations(client)).applied, ["000002"]);

      const receiptsBefore = (await client.query(
        "SELECT to_jsonb(r) AS row FROM public.lumera_migration_ledger r ORDER BY migration_id",
      )).rows;
      assert.deepEqual((await adoptBaseline(client)).adopted, []);
      assert.deepEqual((await client.query(
        "SELECT to_jsonb(r) AS row FROM public.lumera_migration_ledger r ORDER BY migration_id",
      )).rows, receiptsBefore);

      await client.query(
        "UPDATE public.lumera_migration_ledger SET finished_at = started_at - $1::interval WHERE migration_id = $2",
        ["1 second", "000002"],
      );
      const invalidReceipt = (await client.query(
        "SELECT to_jsonb(r) AS row FROM public.lumera_migration_ledger r ORDER BY migration_id",
      )).rows;
      await assert.rejects(() => applyMigrations(client), /LEDGER/u);
      assert.deepEqual((await client.query(
        "SELECT to_jsonb(r) AS row FROM public.lumera_migration_ledger r ORDER BY migration_id",
      )).rows, invalidReceipt);
    } finally {
      client.release();
    }
  });
});