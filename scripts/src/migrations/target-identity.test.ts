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
const projectId = "quiet-river-12345678";
const branchId = "br-little-field-a1b2c3d4";
const timelineId = "fedcba9876543210fedcba9876543210";
const expectedNeon = { ...expected, neon: { projectId, branchId } } as const;
const expectedNeonTimeline = { ...expected, neon: { projectId, branchId, timelineId } } as const;
const nonNeonRow = {
  database_name: "fixture",
  system_identifier: "123",
  encrypted: false,
  neon_project_id: null,
  neon_branch_id: null,
  neon_timeline_id: null,
};
const neonRow = {
  ...nonNeonRow,
  neon_project_id: projectId,
  neon_branch_id: branchId,
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
    { ...expected, neon: { projectId } }, { ...expected, neon: { branchId } },
    { ...expected, neon: { projectId: "", branchId } },
    { ...expected, neon: { projectId: projectId.toUpperCase(), branchId } },
    { ...expected, neon: { projectId, branchId: "main" } },
    { ...expected, neon: { projectId, branchId, timelineId: `${timelineId}0` } },
    { ...expected, neon: { projectId, branchId, tenantId: timelineId } }]) {
    assert.throws(() => validateExpectedTargetIdentity(value), /Explicit expected/u);
  }
  assert.throws(
    () => validateExpectedTargetIdentity({ ...expected, neon: { projectId } }),
    /neon\.branchId/u,
  );
  assert.throws(
    () => validateExpectedTargetIdentity({ ...expected, neon: { branchId } }),
    /neon\.projectId/u,
  );
  assert.throws(
    () => validateExpectedTargetIdentity({ ...expected, neon: { projectId: "bad", branchId } }),
    /neon\.projectId/u,
  );
  assert.throws(
    () => validateExpectedTargetIdentity({ ...expected, neon: { projectId, branchId, timelineId: "bad" } }),
    /neon\.timelineId.*lowercase 32hex/u,
  );
  assert.throws(() => parseMigrationCliOptions(["apply", "--database-url=postgres://local/db", "--confirm"]), /Explicit target identity/u);
  const args = ["--expected-database=fixture", "--expected-system-identifier=123", "--expected-transport=unencrypted"];
  assert.deepEqual(parseExpectedTargetIdentity(args), expected);
  assert.throws(() => parseExpectedTargetIdentity([...args, args[0]!]), /exactly one/u);
});

test("Neon CLI identity flags are paired, validated, and reject duplicates", () => {
  const args = ["--expected-database=fixture", "--expected-system-identifier=123", "--expected-transport=unencrypted"];
  const projectFlag = `--expected-neon-project-id=${projectId}`;
  const branchFlag = `--expected-neon-branch-id=${branchId}`;
  const timelineFlag = `--expected-neon-timeline-id=${timelineId}`;
  assert.deepEqual(parseExpectedTargetIdentity([...args, projectFlag, branchFlag]), expectedNeon);
  assert.deepEqual(parseExpectedTargetIdentity([...args, projectFlag, branchFlag, timelineFlag]), expectedNeonTimeline);
  for (const flag of ["--expected-neon-project-id", "--expected-neon-branch-id", "--expected-neon-timeline-id"]) {
    assert.throws(() => parseExpectedTargetIdentity([...args, flag]), /=VALUE syntax/u);
    assert.throws(() => parseMigrationCliOptions(["status", "--database-url=postgres://local/db", flag]), /status does not verify/u);
  }
  assert.throws(() => parseMigrationCliOptions(["status", "--database-url=postgres://local/db", projectFlag, branchFlag]), /status does not verify/u);
  assert.throws(() => parseExpectedTargetIdentity([...args, projectFlag]), /both .*project.*branch/iu);
  assert.throws(() => parseExpectedTargetIdentity([...args, branchFlag]), /both .*project.*branch/iu);
  assert.throws(() => parseExpectedTargetIdentity([...args, timelineFlag]), /project and branch/iu);
  assert.throws(() => parseExpectedTargetIdentity([...args, projectFlag, projectFlag, branchFlag]), /at most one/iu);
  assert.throws(() => parseExpectedTargetIdentity([...args, projectFlag, branchFlag, branchFlag]), /at most one/iu);
  assert.throws(() => parseExpectedTargetIdentity([...args, projectFlag, branchFlag, timelineFlag, timelineFlag]), /at most one/iu);
  assert.throws(() => parseExpectedTargetIdentity([
    ...args, "--expected-neon-project-id=ABC", branchFlag,
  ]), /neon\.projectId/u);
  for (const oldTenantFlag of ["--expected-neon-tenant-id", `--expected-neon-tenant-id=${timelineId}`]) {
    assert.throws(() => parseExpectedTargetIdentity([...args, oldTenantFlag]), /no longer supported/u);
    assert.throws(
      () => parseMigrationCliOptions(["status", "--database-url=postgres://local/db", oldTenantFlag]),
      /status does not verify/u,
    );
  }
});

test("unknown expected identity diagnostics redact equals and colon values", () => {
  for (const separator of ["=", ":"]) {
    const secret = "must-not-appear";
    assert.throws(
      () => parseExpectedTargetIdentity([`--expected-x${separator}${secret}`]),
      (error) => {
        assert(error instanceof Error);
        assert.equal(
          error.message,
          "Unrecognized expected target identity flag: --expected-x",
        );
        assert.doesNotMatch(error.message, new RegExp(secret));
        return true;
      },
    );
  }
});

test("migration CLI rejects unknown expected flags without exposing values", () => {
  const identityArgs = [
    "--expected-database=fixture",
    "--expected-system-identifier=123",
    "--expected-transport=unencrypted",
  ];
  const mutatingArgs = ["--database-url=postgres://local/db", "--confirm", ...identityArgs];
  for (const commandArgs of [
    ["status", "--database-url=postgres://local/db"],
    ["apply", ...mutatingArgs],
    ["adopt-baseline", ...mutatingArgs],
  ]) {
    for (const unknown of [
      "--expected-neon-timline-id",
      "--expected-neon-timline-id=do-not-disclose",
    ]) {
      assert.throws(
        () => parseMigrationCliOptions([...commandArgs, unknown]),
        (error: unknown) => {
          assert.match(String(error), /--expected-neon-timline-id/u);
          assert.doesNotMatch(String(error), /do-not-disclose/u);
          return true;
        },
      );
    }
  }
  assert.throws(
    () => parseExpectedTargetIdentity([...identityArgs, "--expected-databsae=do-not-disclose"]),
    /--expected-databsae/u,
  );
  assert.deepEqual(
    parseMigrationCliOptions(["status", "--database-url=postgres://local/db", "--unrelated=value"], {}),
    { command: "status", databaseUrl: "postgres://local/db" },
  );
  assert.deepEqual(
    parseMigrationCliOptions(["apply", ...mutatingArgs, "--unrelated=value"], {}),
    {
      command: "apply",
      databaseUrl: "postgres://local/db",
      expectedTargetIdentity: expected,
    },
  );
  assert.deepEqual(parseExpectedTargetIdentity([
    ...identityArgs,
    `--expected-neon-project-id=${projectId}`,
    `--expected-neon-branch-id=${branchId}`,
    `--expected-neon-timeline-id=${timelineId}`,
  ]), expectedNeonTimeline);
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

test("Neon identity requires project and branch while timeline is optional", async () => {
  await assertTargetIdentity({ async query() { return { rows: [neonRow] }; } }, expectedNeon);
  await assertTargetIdentity({ async query() {
    return { rows: [{ ...neonRow, neon_timeline_id: null }] };
  } }, expectedNeon);
  await assertTargetIdentity({ async query() { return { rows: [neonRow] }; } }, expectedNeonTimeline);
  await assert.rejects(
    () => assertTargetIdentity({ async query() { return { rows: [neonRow] }; } }, expected),
    /mismatch: neon\.projectId.*required/u,
  );
  await assert.rejects(
    () => assertTargetIdentity({ async query() { return { rows: [nonNeonRow] }; } }, expectedNeon),
    /mismatch: neon\.projectId/u,
  );
  await assert.rejects(
    () => assertTargetIdentity({ async query() { return { rows: [neonRow] }; } }, {
      ...expectedNeon, neon: { projectId, branchId, timelineId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    }),
    /mismatch: neon\.timelineId/u,
  );
  await assert.rejects(
    () => assertTargetIdentity({ async query() { return { rows: [neonRow] }; } }, {
      ...expectedNeon, neon: { projectId: "other-project-12345678", branchId },
    }),
    /mismatch: neon\.projectId/u,
  );
  await assert.rejects(
    () => assertTargetIdentity({ async query() { return { rows: [neonRow] }; } }, {
      ...expectedNeon, neon: { projectId, branchId: "br-other-field-a1b2c3d4" },
    }),
    /mismatch: neon\.branchId/u,
  );
});

test("incomplete, malformed, or absent Neon backend evidence is field-specifically indeterminate", async () => {
  for (const [row, field, declaration] of [
    [{ ...neonRow, neon_project_id: null }, "projectId", expectedNeon],
    [{ ...neonRow, neon_project_id: undefined }, "projectId", expectedNeon],
    [{ ...neonRow, neon_project_id: projectId.toUpperCase() }, "projectId", expectedNeon],
    [{ ...neonRow, neon_branch_id: null }, "branchId", expectedNeon],
    [{ ...neonRow, neon_branch_id: undefined }, "branchId", expectedNeon],
    [{ ...neonRow, neon_branch_id: "main" }, "branchId", expectedNeon],
    [{ ...neonRow, neon_timeline_id: null }, "timelineId", expectedNeonTimeline],
    [{ ...neonRow, neon_timeline_id: undefined }, "timelineId", expectedNeon],
    [{ ...neonRow, neon_timeline_id: "short" }, "timelineId", expectedNeon],
    [{ database_name: "fixture", system_identifier: "123", encrypted: false }, "projectId", expectedNeon],
  ] as const) {
    await assert.rejects(
      () => assertTargetIdentity({ async query() { return { rows: [row] }; } }, declaration),
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
  assert.match(statements[0]!, /current_setting\('neon\.project_id', true\)/u);
  assert.match(statements[0]!, /current_setting\('neon\.branch_id', true\)/u);
  assert.match(statements[0]!, /current_setting\('neon\.timeline_id', true\)/u);
  assert.equal(statements[0]!.match(/current_setting\(/gu)?.length, 3);
  assert.doesNotMatch(statements[0]!, /neon\.tenant_id/u);
  assert.doesNotMatch(statements[0]!, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|LOCK|BEGIN)\b/u);
});

test("apply and adoption identity refusal happens before any lock or bookkeeping", async () => {
  for (const run of [applyMigrations, adoptBaseline]) {
    for (const [row, declaration] of [
      [{ ...nonNeonRow, database_name: "other" }, expected],
      [nonNeonRow, expectedNeon],
      [neonRow, expected],
      [neonRow, { ...expectedNeon, neon: { projectId, branchId: "br-other-field-a1b2c3d4" } }],
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
            neon_project_id: null,
            neon_branch_id: null,
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