import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMigrations } from "../migrations/runner";
import { readLedger } from "../migrations/ledger";
import { loadMigrations } from "../migrations/files";
import { explicitAdminUrlFromArgs, withOwnedDisposableDatabase } from "./fixtures";

const admin = explicitAdminUrlFromArgs();
test("terminated transactional baseline rolls back and remains fail-closed without automatic retry", {
  skip: !admin ? "Explicit disposable target required" : false,
}, async () => {
  await withOwnedDisposableDatabase(admin!, async ({ pool }) => {
    const canonical = (await loadMigrations())[0]!;
    // Synthetic runner protocol fixture, NOT a repository migration or history.
    const migration = {
      ...canonical,
      body: "CREATE TABLE recovery_marker (id integer PRIMARY KEY); INSERT INTO recovery_marker VALUES (1);",
      preconditions: [],
      postconditions: [],
    };
    const interrupted = await pool.connect();
    interrupted.on("error", () => { /* termination is the intended fault */ });
    const pid = (await interrupted.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    let terminated = false;
    try {
      await assert.rejects(() => applyMigrations({
        query: async (sql: string, params?: unknown[]) => {
          if (sql === "COMMIT" && !terminated) {
            terminated = true;
            await pool.query("SELECT pg_terminate_backend($1)", [pid]);
          }
          return interrupted.query(sql, params);
        },
      }, { migrations: [migration] }));
    } finally {
      interrupted.release(true);
    }
    assert.equal(terminated, true);
    const next = await pool.connect();
    try {
      assert.equal((await next.query("SELECT to_regclass('recovery_marker') AS object")).rows[0].object, null);
      const interruptedLedger = await readLedger(next);
      assert.equal(interruptedLedger[0]?.state, "APPLYING");
      // Phase 5 rejects incomplete baseline history before any write. The old
      // automatic retry expectation predates that reviewed safety boundary.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await assert.rejects(
          () => applyMigrations(next, { migrations: [migration] }),
          /Unsupported migration ledger: LEDGER_INCOMPLETE:000001/u,
        );
        assert.deepEqual(await readLedger(next), interruptedLedger);
        assert.equal((await next.query("SELECT to_regclass('recovery_marker') AS object")).rows[0].object, null);
      }
    } finally {
      next.release();
    }
  });
});