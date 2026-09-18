import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DevelopmentPreparationError,
  prepareDevelopmentMigrations,
} from "./prepare-development";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("development preparation refuses deployment runtimes before querying", async () => {
  let queries = 0;
  const client = {
    async query() {
      queries += 1;
      throw new Error("query must not be reached");
    },
  };

  await assert.rejects(
    () => prepareDevelopmentMigrations(client, {
      environment: { NODE_ENV: "production" },
    }),
    /refuses production or deployment runtimes/,
  );
  assert.equal(queries, 0);
});

test("unsupported eligibility is an explicit error contract", () => {
  const error = new DevelopmentPreparationError({
    path: "UNSUPPORTED",
    mode: "INITIAL_TRANSITION",
    reasons: ["EXISTING_SCHEMA_WITHOUT_VALID_LEDGER"],
    pendingMigrationIds: ["000001", "000002"],
    productionEligibility: "NOT_ASSESSED",
    ledger: "INVALID",
    catalog: "UNKNOWN",
  });

  assert.match(error.message, /EXISTING_SCHEMA_WITHOUT_VALID_LEDGER/);
  assert.equal(error.eligibility.path, "UNSUPPORTED");
});

test("development entrypoint gates before importing the configured database", () => {
  const source = readFileSync(resolve(workspaceRoot, "scripts/src/ensure-development-schema.ts"), "utf8");
  const guard = source.indexOf("assertDevelopmentRuntime();");
  const databaseImport = source.indexOf('import("@workspace/db")');

  assert.notEqual(guard, -1);
  assert.notEqual(databaseImport, -1);
  assert.ok(guard < databaseImport);
  assert.doesNotMatch(source, /business-growth-schema|web-push-schema/u);
  assert.doesNotMatch(source, /booking-development-schema|retail-cart-index-development-schema/u);
  assert.doesNotMatch(source, /ensureBookingDevelopmentSchema|ensureRetailCartIndexDevelopmentSchema/u);
  assert.match(source, /prepareDevelopmentMigrations/);
});