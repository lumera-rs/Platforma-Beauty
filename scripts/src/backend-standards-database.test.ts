import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  auditInvalidIndexes,
  auditUnvalidatedConstraints,
  formatInvalidIndexReport,
  formatUnvalidatedConstraintReport,
  type DatabaseClient,
} from "./backend-standards-database.js";

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");

function requireDisposableDevelopmentDatabaseUrl(): string {
  if (
    process.env.NODE_ENV === "production"
    || process.env.REPLIT_DEPLOYMENT === "1"
    || process.env.REPL_DEPLOYMENT === "1"
  ) {
    throw new Error("Backend standards process tests refuse production or deployment runtimes.");
  }

  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the backend standards process test.");
  const parsed = new URL(databaseUrl);
  assert.ok(parsed.pathname && parsed.pathname !== "/", "DATABASE_URL must include a database name.");
  return databaseUrl;
}

function databaseUrlFor(databaseUrl: string, databaseName: string): string {
  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.pathname = `/${databaseName}`;
  return isolatedUrl.toString();
}

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

test("reports invalid public indexes with a safe development-only remediation", async () => {
  let capturedSql = "";
  const client: DatabaseClient = {
    async query(sql) {
      capturedSql = sql;
      return {
        rows: [
          {
            schema_name: "public",
            table_name: "release_gate_fixture",
            index_name: "release_gate_fixture_invalid_idx",
          },
        ],
      };
    },
  };

  const indexes = await auditInvalidIndexes(client);
  const report = formatInvalidIndexReport(indexes);

  assert.match(capturedSql, /FROM pg_index/);
  assert.match(capturedSql, /index_record\.indisvalid = false/);
  assert.match(capturedSql, /namespace\.nspname = 'public'/);
  assert.deepEqual(indexes, [
    {
      schemaName: "public",
      tableName: "release_gate_fixture",
      indexName: "release_gate_fixture_invalid_idx",
    },
  ]);
  assert.match(
    report,
    /public\.release_gate_fixture — release_gate_fixture_invalid_idx \(INVALID INDEX\)/,
  );
  assert.match(report, /development database/);
  assert.match(report, /drop and recreate it from the canonical schema declaration/);
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

test("database-only release command exits nonzero and identifies an invalid isolated index", {
  timeout: 120_000,
}, async () => {
  const developmentDatabaseUrl = requireDisposableDevelopmentDatabaseUrl();
  const developmentDatabaseName = decodeURIComponent(
    new URL(developmentDatabaseUrl).pathname.slice(1),
  );
  const databaseName =
    `backend_standards_gate_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  assert.notEqual(databaseName, developmentDatabaseName);
  const isolatedDatabaseUrl = databaseUrlFor(developmentDatabaseUrl, databaseName);
  const isolatedEnvironment = {
    ...process.env,
    DATABASE_URL: isolatedDatabaseUrl,
    NODE_ENV: "test",
    REPLIT_DEPLOYMENT: "0",
    REPL_DEPLOYMENT: "0",
  };
  let databaseMayExist = false;

  try {
    databaseMayExist = true;
    await execFileAsync(
      "createdb",
      ["--maintenance-db", developmentDatabaseUrl, databaseName],
      { cwd: workspaceRoot },
    );
    await execFileAsync(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      { cwd: workspaceRoot, env: isolatedEnvironment, maxBuffer: 10 * 1024 * 1024 },
    );
    await execFileAsync(
      "psql",
      [
        isolatedDatabaseUrl,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        [
          "CREATE TABLE public.release_gate_fixture (id integer NOT NULL)",
          "CREATE INDEX release_gate_fixture_invalid_idx ON public.release_gate_fixture (id)",
          [
            "UPDATE pg_index",
            "SET indisvalid = false",
            "WHERE indexrelid = 'public.release_gate_fixture_invalid_idx'::regclass",
          ].join(" "),
        ].join("; "),
      ],
      { cwd: workspaceRoot },
    );

    let commandFailure: unknown;
    try {
      await execFileAsync(
        "pnpm",
        ["--filter", "@workspace/scripts", "run", "test:backend-standards:database"],
        {
          cwd: workspaceRoot,
          env: isolatedEnvironment,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
    } catch (error) {
      commandFailure = error;
    }

    assert.ok(commandFailure, "The database-only command must reject an invalid index.");
    assert.equal(
      (commandFailure as { code?: number }).code,
      1,
      "The database-only command must use its documented failure exit code.",
    );
    const output = [
      (commandFailure as { stdout?: string }).stdout ?? "",
      (commandFailure as { stderr?: string }).stderr ?? "",
    ].join("\n");
    assert.match(output, /public\.release_gate_fixture/);
    assert.match(output, /release_gate_fixture_invalid_idx/);
    assert.match(output, /INVALID INDEX/);
  } finally {
    if (databaseMayExist) {
      await execFileAsync(
        "dropdb",
        [
          "--force",
          "--if-exists",
          "--maintenance-db",
          developmentDatabaseUrl,
          databaseName,
        ],
        { cwd: workspaceRoot },
      );
    }
  }
});

test("database-only release command exits nonzero and identifies an unvalidated isolated constraint", {
  timeout: 120_000,
}, async () => {
  const developmentDatabaseUrl = requireDisposableDevelopmentDatabaseUrl();
  const developmentDatabaseName = decodeURIComponent(
    new URL(developmentDatabaseUrl).pathname.slice(1),
  );
  const databaseName =
    `backend_standards_constraint_gate_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  assert.notEqual(databaseName, developmentDatabaseName);
  const isolatedDatabaseUrl = databaseUrlFor(developmentDatabaseUrl, databaseName);
  const isolatedEnvironment = {
    ...process.env,
    DATABASE_URL: isolatedDatabaseUrl,
    NODE_ENV: "test",
    REPLIT_DEPLOYMENT: "0",
    REPL_DEPLOYMENT: "0",
  };
  let databaseMayExist = false;

  try {
    databaseMayExist = true;
    await execFileAsync(
      "createdb",
      ["--maintenance-db", developmentDatabaseUrl, databaseName],
      { cwd: workspaceRoot },
    );
    await execFileAsync(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      { cwd: workspaceRoot, env: isolatedEnvironment, maxBuffer: 10 * 1024 * 1024 },
    );
    await execFileAsync(
      "psql",
      [
        isolatedDatabaseUrl,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        [
          "CREATE TABLE public.release_constraint_gate_fixture (id integer NOT NULL)",
          [
            "ALTER TABLE public.release_constraint_gate_fixture",
            "ADD CONSTRAINT release_constraint_gate_positive_check",
            "CHECK (id > 0) NOT VALID",
          ].join(" "),
        ].join("; "),
      ],
      { cwd: workspaceRoot },
    );

    let commandFailure: unknown;
    try {
      await execFileAsync(
        "pnpm",
        ["--filter", "@workspace/scripts", "run", "test:backend-standards:database"],
        {
          cwd: workspaceRoot,
          env: isolatedEnvironment,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
    } catch (error) {
      commandFailure = error;
    }

    assert.ok(
      commandFailure,
      "The database-only command must reject an unvalidated constraint.",
    );
    assert.equal(
      (commandFailure as { code?: number }).code,
      1,
      "The database-only command must use its documented failure exit code.",
    );
    const output = [
      (commandFailure as { stdout?: string }).stdout ?? "",
      (commandFailure as { stderr?: string }).stderr ?? "",
    ].join("\n");
    assert.match(output, /public\.release_constraint_gate_fixture/);
    assert.match(output, /release_constraint_gate_positive_check/);
    assert.match(output, /\(CHECK\)/);
  } finally {
    if (databaseMayExist) {
      await execFileAsync(
        "dropdb",
        [
          "--force",
          "--if-exists",
          "--maintenance-db",
          developmentDatabaseUrl,
          databaseName,
        ],
        { cwd: workspaceRoot },
      );
    }
  }
});