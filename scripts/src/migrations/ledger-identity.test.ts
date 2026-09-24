import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  inspectDatabaseMigrationReady,
  ledgerIdentityMismatch,
  migrationReadinessContract,
} from "@workspace/db/migration-runtime";

const target = {
  databaseName: "fixture",
  systemIdentifier: "123",
  transport: "unencrypted" as const,
  neon: {
    projectId: "quiet-river-12345678",
    branchId: "br-little-field-a1b2c3d4",
  },
};

const checksums = [
  migrationReadinessContract.baselineChecksum,
  migrationReadinessContract.supportedStartupMigrationChecksum,
  migrationReadinessContract.salonEntranceMigrationChecksum,
  migrationReadinessContract.jobPublicationMigrationChecksum,
];

function rows(identity: {
  database_name: string | null;
  system_identifier: string | null;
  neon_project_id: string | null;
  neon_branch_id: string | null;
}) {
  return checksums.map((checksum, index) => ({
    migration_id: `00000${index + 1}`,
    checksum,
    mode: "transactional",
    state: "APPLIED",
    error: null,
    started_at: "2026-01-01T00:00:00Z",
    finished_at: "2026-01-01T00:00:01Z",
    ...identity,
  }));
}

const catalog = async () => ({
  structuralFingerprint: migrationReadinessContract.headStructuralFingerprint,
  physicalFingerprint: migrationReadinessContract.headPhysicalFingerprint,
  formatVersion: 2,
  fingerprintVersion: 4,
  schemaFormatVersion: 1,
  postgresServerMajorVersion: 16,
  postgresServerVersionNum: 160010,
  postgresDeparserFormat: "postgresql-16-deparser-v1",
  normalizedObjectCount: migrationReadinessContract.headNormalizedObjectCount,
  enumCount: 103,
  triggerCount: 24,
  functionCount: 21,
});

async function inspect(ledgerRows: ReturnType<typeof rows>) {
  const client = {
    async query(sql: string) {
      if (sql.includes("to_jsonb(ledger)")) return { rows: ledgerRows };
      return { rows: [] };
    },
  };
  return inspectDatabaseMigrationReady(client, catalog, async () => target);
}

test("readiness names the migration and component for every bound mismatch", async () => {
  const valid = {
    database_name: target.databaseName,
    system_identifier: target.systemIdentifier,
    neon_project_id: target.neon.projectId,
    neon_branch_id: target.neon.branchId,
  };
  for (const [column, component] of [
    ["database_name", "databaseName"],
    ["system_identifier", "systemIdentifier"],
    ["neon_project_id", "neon.projectId"],
    ["neon_branch_id", "neon.branchId"],
  ] as const) {
    const ledgerRows = rows(valid);
    ledgerRows[2]![column] = "foreign-value";
    const report = await inspect(ledgerRows);
    assert.equal(
      report.reason,
      `MIGRATION_READINESS_LEDGER_IDENTITY_MISMATCH:000003:${component}`,
    );
  }
  assert.equal(
    ledgerIdentityMismatch(
      {
        databaseName: target.databaseName,
        systemIdentifier: target.systemIdentifier,
        neonProjectId: target.neon.projectId,
        neonBranchId: "br-copied-field-a1b2c3d4",
      },
      {
        databaseName: target.databaseName,
        systemIdentifier: target.systemIdentifier,
        neonProjectId: target.neon.projectId,
        neonBranchId: target.neon.branchId,
      },
    ),
    "neon.branchId",
  );
});

test("deployment readiness refuses wholly unbound and partially bound rows", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(
      (await inspect(rows({
        database_name: null,
        system_identifier: null,
        neon_project_id: null,
        neon_branch_id: null,
      }))).reason,
      "MIGRATION_READINESS_LEDGER_IDENTITY_UNBOUND:000001:databaseName",
    );
    assert.equal(
      (await inspect(rows({
        database_name: target.databaseName,
        system_identifier: null,
        neon_project_id: null,
        neon_branch_id: null,
      }))).reason,
      "MIGRATION_READINESS_LEDGER_IDENTITY_PARTIAL:000001:systemIdentifier",
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("binding SQL is a one-way compare-and-set and cannot rebind", async () => {
  const source = await readFile(new URL("./runner.ts", import.meta.url), "utf8");
  assert.match(source, /if \(component\) throw new Error\(`Migration ledger identity mismatch/u);
  assert.match(source, /await client\.query\("BEGIN"\);[\s\S]*readLedger\(client, \{ forUpdate: true \}\)/u);
  assert.match(source, /AND database_name IS NULL AND system_identifier IS NULL\s+AND neon_project_id IS NULL AND neon_branch_id IS NULL/u);
  assert.doesNotMatch(source, /UPDATE public\.lumera_migration_ledger[\s\S]*?WHERE migration_id=\$1\s+RETURNING migration_id/u);
});