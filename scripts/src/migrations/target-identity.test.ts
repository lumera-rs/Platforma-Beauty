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
const tenantId = "0123456789abcdef0123456789abcdef";
const timelineId = "fedcba9876543210fedcba9876543210";
const expectedNeon = { ...expected, neon: { tenantId, timelineId } } as const;
const nonNeonRow = {
  database_name: "fixture",
  system_identifier: "123",
  encrypted: false,
  neon_tenant_id: null,
  neon_timeline_id: null,
};
const neonRow = {
  ...nonNeonRow,
  neon_tenant_id: tenantId,
  neon_timeline_id: timelineId,
};
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
    { ...expected, systemIdentifier: "1e2" }, { ...expected, transport: "verify-full" },
    { ...expected, neon: null }, { ...expected, neon: {} },
    { ...expected, neon: { tenantId } }, { ...expected, neon: { timelineId } },
    { ...expected, neon: { tenantId: "", timelineId } },
    { ...expected, neon: { tenantId: tenantId.toUpperCase(), timelineId } },
    { ...expected, neon: { tenantId, timelineId: `${timelineId}0` } }]) {
    assert.throws(() => validateExpectedTargetIdentity(value), /Explicit expected/u);
  }
  assert.throws(
    () => validateExpectedTargetIdentity({ ...expected, neon: { tenantId } }),
    /neon\.timelineId.*lowercase 32hex/u,
  );
  assert.throws(
    () => validateExpectedTargetIdentity({ ...expected, neon: { timelineId } }),
    /neon\.tenantId.*lowercase 32hex/u,
  );
  assert.throws(
    () => validateExpectedTargetIdentity({ ...expected, neon: { tenantId: "bad", timelineId } }),
    /neon\.tenantId.*lowercase 32hex/u,
  );
  assert.throws(
    () => validateExpectedTargetIdentity({ ...expected, neon: { tenantId, timelineId: "bad" } }),
    /neon\.timelineId.*lowercase 32hex/u,
  );
  assert.throws(() => parseMigrationCliOptions(["apply", "--database-url=postgres://local/db", "--confirm"]), /Explicit target identity/u);
  const args = ["--expected-database=fixture", "--expected-system-identifier=123", "--expected-transport=unencrypted"];
  assert.deepEqual(parseExpectedTargetIdentity(args), expected);
  assert.throws(() => parseExpectedTargetIdentity([...args, args[0]!]), /exactly one/u);
});

test("Neon CLI identity flags are paired, validated, and reject duplicates", () => {
  const args = ["--expected-database=fixture", "--expected-system-identifier=123", "--expected-transport=unencrypted"];
  const tenantFlag = `--expected-neon-tenant-id=${tenantId}`;
  const timelineFlag = `--expected-neon-timeline-id=${timelineId}`;
  assert.deepEqual(parseExpectedTargetIdentity([...args, tenantFlag, timelineFlag]), expectedNeon);
  for (const flag of ["--expected-neon-tenant-id", "--expected-neon-timeline-id"]) {
    assert.throws(() => parseExpectedTargetIdentity([...args, flag]), /=VALUE syntax/u);
    assert.throws(() => parseMigrationCliOptions(["status", "--database-url=postgres://local/db", flag]), /status does not verify/u);
  }
  assert.throws(() => parseMigrationCliOptions(["status", "--database-url=postgres://local/db", tenantFlag, timelineFlag]), /status does not verify/u);
  assert.throws(() => parseExpectedTargetIdentity([...args, tenantFlag]), /both .*tenant.*timeline/iu);
  assert.throws(() => parseExpectedTargetIdentity([...args, timelineFlag]), /both .*tenant.*timeline/iu);
  assert.throws(() => parseExpectedTargetIdentity([...args, tenantFlag, tenantFlag, timelineFlag]), /at most one/iu);
  assert.throws(() => parseExpectedTargetIdentity([...args, tenantFlag, timelineFlag, timelineFlag]), /at most one/iu);
  assert.throws(() => parseExpectedTargetIdentity([
    ...args, "--expected-neon-tenant-id=ABC", timelineFlag,
  ]), /neon\.tenantId.*lowercase 32hex/u);
});

test("identity evidence fails closed on every mismatch and unavailable backend evidence", async () => {
  const row = nonNeonRow;
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

test("Neon identity requires and matches the canonical tenant and timeline pair", async () => {
  await assertTargetIdentity({ async query() { return { rows: [neonRow] }; } }, expectedNeon);
  await assert.rejects(
    () => assertTargetIdentity({ async query() { return { rows: [neonRow] }; } }, expected),
    /mismatch: neon\.tenantId.*required/u,
  );
  await assert.rejects(
    () => assertTargetIdentity({ async query() { return { rows: [nonNeonRow] }; } }, expectedNeon),
    /mismatch: neon\.tenantId/u,
  );
  await assert.rejects(
    () => assertTargetIdentity({ async query() { return { rows: [neonRow] }; } }, {
      ...expectedNeon, neon: { tenantId, timelineId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    }),
    /mismatch: neon\.timelineId/u,
  );
  await assert.rejects(
    () => assertTargetIdentity({ async query() { return { rows: [neonRow] }; } }, {
      ...expectedNeon, neon: { tenantId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", timelineId },
    }),
    /mismatch: neon\.tenantId/u,
  );
});

test("incomplete, malformed, or absent Neon backend evidence is field-specifically indeterminate", async () => {
  for (const [row, field] of [
    [{ ...neonRow, neon_tenant_id: null }, "tenantId"],
    [{ ...neonRow, neon_tenant_id: undefined }, "tenantId"],
    [{ ...neonRow, neon_tenant_id: tenantId.toUpperCase() }, "tenantId"],
    [{ ...neonRow, neon_timeline_id: null }, "timelineId"],
    [{ ...neonRow, neon_timeline_id: undefined }, "timelineId"],
    [{ ...neonRow, neon_timeline_id: "short" }, "timelineId"],
    [{ database_name: "fixture", system_identifier: "123", encrypted: false }, "tenantId"],
  ] as const) {
    await assert.rejects(
      () => assertTargetIdentity({ async query() { return { rows: [row] }; } }, expectedNeon),
      new RegExp(`indeterminate: .*neon\\.${field}`, "u"),
    );
  }
});

test("identity verification performs exactly one read-only SELECT", async () => {
  const statements: string[] = [];
  await assertTargetIdentity({ async query(sql: string) {
    statements.push(sql);
    return { rows: [neonRow] };
  } }, expectedNeon);
  assert.equal(statements.length, 1);
  assert.match(statements[0]!, /^\s*SELECT\b/u);
  assert.match(statements[0]!, /current_setting\('neon\.tenant_id', true\)/u);
  assert.match(statements[0]!, /current_setting\('neon\.timeline_id', true\)/u);
  assert.doesNotMatch(statements[0]!, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|LOCK|BEGIN)\b/u);
});

test("apply and adoption identity refusal happens before any lock or bookkeeping", async () => {
  for (const run of [applyMigrations, adoptBaseline]) {
    for (const [row, declaration] of [
      [{ ...nonNeonRow, database_name: "other" }, expected],
      [nonNeonRow, expectedNeon],
      [neonRow, expected],
      [neonRow, { ...expectedNeon, neon: { tenantId, timelineId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }],
    ] as const) {
    const statements: string[] = [];
    const client = { async query(sql: string) {
      statements.push(sql);
      return { rows: [row] };
    } };
    await assert.rejects(
      () => run(client, { expectedTargetIdentity: declaration }),
      /mismatch/u,
    );
    assert.equal(statements.length, 1);
    assert.match(statements[0]!, /pg_control_system/u);
    assert.doesNotMatch(statements[0]!, /advisory|BEGIN|CREATE|INSERT|UPDATE|DELETE/u);
    statements.length = 0;
    await assert.rejects(() => run(client), /Explicit expected/u);
    assert.deepEqual(statements, []);
    }
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
            neon_tenant_id: null,
            neon_timeline_id: null,
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