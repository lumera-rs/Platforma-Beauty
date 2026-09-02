import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  auditUnvalidatedConstraints,
  formatUnvalidatedConstraintReport,
  type DatabaseClient,
} from "./backend-standards-database.js";

test("reports NOT VALID public CHECK and FK constraints with a safe remediation", async () => {
  let capturedSql = "";
  const client: DatabaseClient = {
    async query(sql) {
      capturedSql = sql;
      return {
        rows: [
          {
            schema_name: "public",
            table_name: "release_gate_fixture",
            constraint_name: "release_gate_fixture_positive_check",
            constraint_type: "CHECK",
          },
          {
            schema_name: "public",
            table_name: "release_gate_fixture",
            constraint_name: "release_gate_fixture_parent_fk",
            constraint_type: "FOREIGN KEY",
          },
        ],
      };
    },
  };

  const constraints = await auditUnvalidatedConstraints(client);
  const report = formatUnvalidatedConstraintReport(constraints);

  assert.match(capturedSql, /FROM pg_constraint/);
  assert.match(capturedSql, /constraint_record\.convalidated = false/);
  assert.match(capturedSql, /constraint_record\.contype IN \('c', 'f'\)/);
  assert.deepEqual(constraints, [
    {
      schemaName: "public",
      tableName: "release_gate_fixture",
      constraintName: "release_gate_fixture_positive_check",
      constraintType: "CHECK",
    },
    {
      schemaName: "public",
      tableName: "release_gate_fixture",
      constraintName: "release_gate_fixture_parent_fk",
      constraintType: "FOREIGN KEY",
    },
  ]);
  assert.match(
    report,
    /public\.release_gate_fixture — release_gate_fixture_positive_check \(CHECK\)/,
  );
  assert.match(
    report,
    /public\.release_gate_fixture — release_gate_fixture_parent_fk \(FOREIGN KEY\)/,
  );
  assert.match(report, /ALTER TABLE \.\.\. VALIDATE CONSTRAINT/);
  assert.match(report, /Do not apply this repair directly to production/);
});

test("the actual Publish validation command includes the live database gate", async () => {
  const rootPackage = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { scripts?: Record<string, string> };
  const publishCommand = rootPackage.scripts?.["validate:publish"];

  assert.equal(typeof publishCommand, "string");
  assert.match(
    publishCommand ?? "",
    /pnpm run test:backend-standards:database/,
    "validate:publish must block on the live development-schema audit",
  );
});