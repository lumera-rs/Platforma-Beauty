import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  classifyDeploymentEligibility,
  inspectDeploymentEligibility,
  readDeploymentLedgerInspection,
} from "./deployment-eligibility";
import {
  assertEligibilityDevelopmentRuntime,
  parseDeploymentEligibilityCliOptions,
} from "./deployment-eligibility-cli";
import { loadMigrations } from "./files";
import { adoptBaseline, applyMigrations } from "./runner";
import type { DatabaseClient } from "../backend-standards-database";

function fakeClient(
  handler: (sql: string) => Record<string, unknown>[],
): DatabaseClient & { readonly statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("has_unsupported_namespace")) {
        return { rows: [{ has_unsupported_namespace: false }] };
      }
      return { rows: handler(sql) };
    },
  } as DatabaseClient & { readonly statements: string[] };
}

test("fresh eligibility is read-only and reports the initial transition", async () => {
  const client = fakeClient((sql) => {
    if (sql.includes("to_regclass")) return [{ ledger: null }];
    if (sql.includes("SELECT EXISTS")) return [{ present: false }];
    throw new Error(`unexpected query: ${sql}`);
  });
  const report = await classifyDeploymentEligibility(client);
  assert.deepEqual(report.path, "FRESH_EMPTY");
  assert.equal(report.mode, "INITIAL_TRANSITION");
  assert.deepEqual(report.pendingMigrationIds, ["000001", "000002"]);
  assert.equal(report.productionEligibility, "NOT_ASSESSED");
  assert.equal(client.statements.some((sql) => /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql)), false);
});

test("an existing schema without a ledger is unsupported before any write", async () => {
  const client = fakeClient((sql) => {
    if (sql.includes("to_regclass")) return [{ ledger: null }];
    if (sql.includes("SELECT EXISTS")) return [{ present: true }];
    throw new Error(`unexpected query: ${sql}`);
  });
  const report = await classifyDeploymentEligibility(client);
  assert.equal(report.path, "UNSUPPORTED");
  assert.ok(report.reasons.includes("EXISTING_SCHEMA_WITHOUT_VALID_LEDGER"));
  assert.equal(report.ledger, "INVALID");
  assert.equal(client.statements.some((sql) => /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql)), false);
});

test("standalone inspection owns a read-only repeatable-read transaction", async () => {
  const client = fakeClient((sql) => {
    if (sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY") return [];
    if (sql === "COMMIT") return [];
    if (sql.startsWith("SET LOCAL ")) return [];
    if (sql.includes("to_regclass")) return [{ ledger: null }];
    if (sql.includes("SELECT EXISTS")) return [{ present: false }];
    throw new Error(`unexpected query: ${sql}`);
  });
  const report = await inspectDeploymentEligibility(client);
  assert.equal(report.path, "FRESH_EMPTY");
  assert.equal(client.statements[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(client.statements.at(-1), "COMMIT");
});

test("CLI requires an explicit development target and never uses an ambient URL", () => {
  assert.deepEqual(
    parseDeploymentEligibilityCliOptions([
      "--database-url=postgres://development-owner@127.0.0.1:5432/lumera",
      "--target=development",
      "--confirm",
    ]),
    {
      databaseUrl: "postgres://development-owner@127.0.0.1:5432/lumera",
      target: "development",
    },
  );
  assert.throws(
    () => parseDeploymentEligibilityCliOptions(["--target=development", "--confirm"]),
    /explicit --database-url/,
  );
  assert.throws(
    () => parseDeploymentEligibilityCliOptions([
      "--database-url=postgres://owner@127.0.0.1/db",
      "--confirm",
    ]),
    /explicit --target=development/,
  );
  assert.throws(
    () => assertEligibilityDevelopmentRuntime({ NODE_ENV: "production" }),
    /development-only/,
  );
  assert.doesNotThrow(
    () => assertEligibilityDevelopmentRuntime({ NODE_ENV: "test" }),
  );
});

test("ledger inspection rejects an incomplete APPLYING row before the runner can write", async () => {
  const migrations = await loadMigrations();
  const client = fakeClient((sql) => {
    if (sql.includes("to_regclass")) return [{ ledger: "lumera_migration_ledger" }];
    if (sql.includes("started_at")) {
      return [{
        migration_id: "000001",
        checksum: migrations[0]!.checksum,
        mode: migrations[0]!.mode,
        state: "APPLYING",
        error: null,
        started_at: new Date(),
        finished_at: null,
      }];
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const inspection = await readDeploymentLedgerInspection(client, migrations);
  assert.ok(inspection.reasons.includes("LEDGER_INCOMPLETE:000001"));
  assert.equal(inspection.reasons.some((reason) => reason.startsWith("LEDGER_MISSING_FINISHED_AT")), false);
});

test("ledger inspection rejects checksum, mode, error, and timestamp drift", async () => {
  const migrations = await loadMigrations();
  const client = fakeClient((sql) => {
    if (sql.includes("to_regclass")) return [{ ledger: "lumera_migration_ledger" }];
    if (sql.includes("started_at")) {
      return [{
        migration_id: "000001",
        checksum: "wrong",
        mode: "nontransactional",
        state: "APPLIED",
        error: "stale failure",
        started_at: null,
        finished_at: null,
      }];
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const inspection = await readDeploymentLedgerInspection(client, migrations);
  assert.ok(inspection.reasons.includes("LEDGER_CHECKSUM_MISMATCH:000001"));
  assert.ok(inspection.reasons.includes("LEDGER_MODE_MISMATCH:000001"));
  assert.ok(inspection.reasons.includes("LEDGER_MISSING_STARTED_AT:000001"));
  assert.ok(inspection.reasons.includes("LEDGER_MISSING_FINISHED_AT:000001"));
  assert.ok(inspection.reasons.includes("LEDGER_UNEXPECTED_ERROR:000001"));
});

test("ledger inspection rejects a finite but reversed completion interval", async () => {
  const migrations = await loadMigrations();
  const client = fakeClient((sql) => {
    if (sql.includes("to_regclass")) return [{ ledger: "lumera_migration_ledger" }];
    if (sql.includes("started_at")) {
      return [{
        migration_id: "000001",
        checksum: migrations[0]!.checksum,
        mode: migrations[0]!.mode,
        state: "APPLIED",
        error: null,
        started_at: "2026-01-02T00:00:00.000Z",
        finished_at: "2026-01-01T00:00:00.000Z",
      }];
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const inspection = await readDeploymentLedgerInspection(client, migrations);
  assert.ok(inspection.reasons.includes("LEDGER_FINISHED_BEFORE_STARTED:000001"));
});

test("supported runner rejects invalid ledger metadata before BEGIN or ledger DDL", async () => {
  const migrations = await loadMigrations();
  const client = fakeClient((sql) => {
    if (sql.includes("pg_try_advisory_lock")) return [{ locked: true }];
    if (sql.includes("pg_advisory_unlock")) return [{ unlocked: true }];
    if (sql.includes("to_regclass")) return [{ ledger: "lumera_migration_ledger" }];
    if (sql.includes("started_at")) {
      return [{
        migration_id: "000001",
        checksum: "wrong",
        mode: migrations[0]!.mode,
        state: "APPLYING",
        error: null,
        started_at: null,
        finished_at: null,
      }];
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const previous = {
    node: process.env.NODE_ENV,
    deployment: process.env.REPLIT_DEPLOYMENT,
    deploymentId: process.env.REPLIT_DEPLOYMENT_ID,
    environment: process.env.REPLIT_ENVIRONMENT,
  };
  process.env.NODE_ENV = "test";
  delete process.env.REPLIT_DEPLOYMENT;
  delete process.env.REPLIT_DEPLOYMENT_ID;
  delete process.env.REPLIT_ENVIRONMENT;
  try {
    await assert.rejects(
      () => applyMigrations(client, { migrations }),
      /Unsupported migration ledger/u,
    );
  } finally {
    if (previous.node === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.node;
    if (previous.deployment === undefined) delete process.env.REPLIT_DEPLOYMENT;
    else process.env.REPLIT_DEPLOYMENT = previous.deployment;
    if (previous.deploymentId === undefined) delete process.env.REPLIT_DEPLOYMENT_ID;
    else process.env.REPLIT_DEPLOYMENT_ID = previous.deploymentId;
    if (previous.environment === undefined) delete process.env.REPLIT_ENVIRONMENT;
    else process.env.REPLIT_ENVIRONMENT = previous.environment;
  }
  assert.equal(client.statements.some((sql) => /^(?:BEGIN|CREATE|INSERT|UPDATE|DELETE|ALTER|DROP)\b/i.test(sql.trim())), false);
});

test("admission-contract adoption refuses deployment runtime before touching the client", async () => {
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      return { rows: [] };
    },
  } as DatabaseClient;
  const previous = {
    node: process.env.NODE_ENV,
    deployment: process.env.REPLIT_DEPLOYMENT,
    deploymentId: process.env.REPLIT_DEPLOYMENT_ID,
    environment: process.env.REPLIT_ENVIRONMENT,
  };
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(
      () => adoptBaseline(client),
      /development-only/u,
    );
  } finally {
    if (previous.node === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.node;
    if (previous.deployment === undefined) delete process.env.REPLIT_DEPLOYMENT;
    else process.env.REPLIT_DEPLOYMENT = previous.deployment;
    if (previous.deploymentId === undefined) delete process.env.REPLIT_DEPLOYMENT_ID;
    else process.env.REPLIT_DEPLOYMENT_ID = previous.deploymentId;
    if (previous.environment === undefined) delete process.env.REPLIT_ENVIRONMENT;
    else process.env.REPLIT_ENVIRONMENT = previous.environment;
  }
  assert.equal(statements.length, 0);
});
/**
 * `adoptBaseline` reaches the development-only gate only while at least one
 * loaded migration carries an admission contract. If that entry were dropped
 * from the manifest, adoption would fall through to the legacy branch, which
 * writes the ledger without an enclosing transaction or table locks -- the
 * time-of-check/time-of-use window the supported path closes. The refusal
 * test above proves the gate fires today, but only indirectly: stubbing
 * `options.migrations` would silently retire that coverage. This pins the
 * precondition itself.
 */
test("the loaded manifest always carries the admission contract that gates adoption", async () => {
  const migrations = await loadMigrations();
  const admitted = migrations.filter((migration) => migration.admissionContract);
  assert.ok(
    admitted.length > 0,
    "without an admission contract adoptBaseline would use the legacy, unfenced ledger path",
  );
  for (const migration of admitted) {
    assert.equal(migration.admissionContract, "supported-startup-v1", migration.id);
  }
});
