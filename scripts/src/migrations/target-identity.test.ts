import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertTargetIdentity, validateExpectedTargetIdentity } from "./target-identity";
import { parseExpectedTargetIdentity, parseMigrationCliOptions } from "./cli";
import { isDeploymentRuntime } from "./development-runtime";
import { assertEligibilityDevelopmentRuntime } from "./deployment-eligibility-cli";
import { assertSafeRuntime } from "./run-phase5-integration";
import { prepareDevelopmentMigrations } from "./prepare-development";
import { applyMigrations, adoptBaseline } from "./runner";
import { loadMigrations } from "./files";

const expected = { databaseName: "fixture", systemIdentifier: "123", transport: "unencrypted" } as const;
export const markerCases = [
  { NODE_ENV: "production" },
  ...["1", "true", "TRUE", "TrUe"].flatMap((value) => [
    { REPLIT_DEPLOYMENT: value }, { REPL_DEPLOYMENT: value },
  ]),
  { REPLIT_DEPLOYMENT_ID: "deployment" }, { REPL_DEPLOYMENT_ID: "deployment" },
  { REPLIT_DEPLOYMENT_ID: "" }, { REPL_DEPLOYMENT_ID: "" },
];

test("all real deployment marker forms block each development runtime gate", async () => {
  const client = { async query(): Promise<never> { throw new Error("No database query allowed"); } };
  for (const environment of markerCases) {
    assert.equal(isDeploymentRuntime(environment), true);
    assert.throws(() => assertEligibilityDevelopmentRuntime(environment), /development-only/u);
    assert.throws(() => assertSafeRuntime(environment), /refuses production/u);
    await assert.rejects(() => prepareDevelopmentMigrations(client, { environment }), /refuses production/u);
  }
  assert.equal(isDeploymentRuntime({ REPLIT_ENVIRONMENT: "production" }), false);
  assert.doesNotThrow(() => assertEligibilityDevelopmentRuntime({ REPLIT_ENVIRONMENT: "production" }));
  assert.doesNotThrow(() => assertSafeRuntime({ REPLIT_ENVIRONMENT: "production" }));
});

test("development schema entrypoint rejects every marker before configured database import", () => {
  const tsx = fileURLToPath(new URL("../../node_modules/.bin/tsx", import.meta.url));
  const entrypoint = fileURLToPath(new URL("../ensure-development-schema.ts", import.meta.url));
  for (const marker of markerCases) {
    const result = spawnSync(tsx, [entrypoint], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...marker },
      encoding: "utf8", timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Development schema preparation refuses/u);
  }
  const workspace = spawnSync(tsx, [entrypoint], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, REPLIT_ENVIRONMENT: "production" },
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(workspace.error, undefined);
  assert.match(workspace.stderr, /Explicit target identity/u);
  assert.doesNotMatch(workspace.stderr, /refuses production/u);
});

test("identity is explicitly validated, never inferred from a URL or environment", () => {
  for (const value of [undefined, {}, { ...expected, databaseName: "" },
    { ...expected, systemIdentifier: 123 }, { ...expected, systemIdentifier: "0" },
    { ...expected, systemIdentifier: "18446744073709551616" },
    { ...expected, systemIdentifier: "1e2" }, { ...expected, transport: "verify-full" }]) {
    assert.throws(() => validateExpectedTargetIdentity(value), /Explicit expected/u);
  }
  assert.throws(() => parseMigrationCliOptions(["apply", "--database-url=postgres://local/db", "--confirm"]), /Explicit target identity/u);
  const args = ["--expected-database=fixture", "--expected-system-identifier=123", "--expected-transport=unencrypted"];
  assert.deepEqual(parseExpectedTargetIdentity(args), expected);
  assert.throws(() => parseExpectedTargetIdentity([...args, args[0]!]), /exactly one/u);
});

test("identity evidence fails closed on every mismatch and unavailable backend evidence", async () => {
  const row = { database_name: "fixture", system_identifier: "123", encrypted: false };
  await assertTargetIdentity({ async query() { return { rows: [row] }; } }, expected);
  await assertTargetIdentity({ async query() { return { rows: [{ ...row, encrypted: true }] }; } },
    { ...expected, transport: "encrypted" });
  for (const rows of [[], [row, row], [{ ...row, encrypted: null }], [{ ...row, system_identifier: null }]]) {
    await assert.rejects(() => assertTargetIdentity({ async query() { return { rows }; } }, expected), /indeterminate/u);
  }
  for (const wrong of [{ ...expected, databaseName: "wrong" }, { ...expected, systemIdentifier: "124" },
    { ...expected, transport: "encrypted" as const }]) {
    await assert.rejects(() => assertTargetIdentity({ async query() { return { rows: [row] }; } }, wrong), /mismatch/u);
  }
  await assert.rejects(() => assertTargetIdentity({ async query() { throw new Error("permission denied"); } }, expected), /indeterminate/u);
});

test("apply and adoption identity refusal happens before any lock or bookkeeping", async () => {
  for (const run of [applyMigrations, adoptBaseline]) {
    const statements: string[] = [];
    const client = { async query(sql: string) {
      statements.push(sql);
      return { rows: [{ database_name: "other", system_identifier: "123", encrypted: false }] };
    } };
    await assert.rejects(() => run(client, { expectedTargetIdentity: expected }), /mismatch/u);
    assert.equal(statements.length, 1);
    assert.match(statements[0]!, /pg_control_system/u);
    assert.doesNotMatch(statements[0]!, /advisory|BEGIN|CREATE|INSERT|UPDATE|DELETE/u);
    statements.length = 0;
    await assert.rejects(() => run(client), /Explicit expected/u);
    assert.deepEqual(statements, []);
  }
});

test("narrowed and empty manifests always verify identity before branching or bookkeeping", async () => {
  const baseline = [(await loadMigrations())[0]!];
  for (const migrations of [baseline, []]) {
    for (const run of [applyMigrations, adoptBaseline]) {
      for (const fault of ["missing", "name", "system", "transport", "denied", "unreadable"]) {
        const statements: string[] = [];
        const client = { async query(sql: string) {
          statements.push(sql);
          if (fault === "denied") throw new Error("permission denied");
          return { rows: fault === "unreadable" ? [] : [{
            database_name: fault === "name" ? "wrong" : "fixture",
            system_identifier: fault === "system" ? "124" : "123",
            encrypted: fault === "transport",
          }] };
        } };
        await assert.rejects(() => run(client, {
          migrations, expectedTargetIdentity: fault === "missing" ? undefined : expected,
        }), /identity/u);
        assert.equal(statements.length, fault === "missing" ? 0 : 1);
        assert.ok(statements.every((sql) => sql.includes("pg_control_system")));
      }
    }
  }
});