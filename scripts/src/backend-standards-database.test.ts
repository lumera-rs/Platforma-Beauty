import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
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
import {
  assertDestructiveTestRuntimeAllowed,
  destructiveTestGuardEnvironments,
} from "./destructive-test-runtime.js";
import {
  createRedactedDatabaseOutputWriter,
  formatDatabaseCommandFailure,
  pipeRedactedDatabaseOutput,
  redactDatabaseCommandOutput,
} from "./safe-child-process-output.js";

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");

async function runDatabaseCommand(
  command: string,
  args: string[],
  options: Parameters<typeof execFileAsync>[2],
  label: string,
): Promise<Awaited<ReturnType<typeof execFileAsync>>> {
  try {
    return await execFileAsync(command, args, options);
  } catch (error) {
    throw formatDatabaseCommandFailure(label, error, options?.env);
  }
}

function requireDisposableDevelopmentDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  assertDestructiveTestRuntimeAllowed(environment, "Backend standards process tests");

  const databaseUrl = environment.DATABASE_URL;
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

test("refuses destructive database fixtures before commands in production and deployment runtimes", () => {
  const guardedEnvironments = destructiveTestGuardEnvironments.map(({ name, values }) => ({
    name,
    environment: {
      DATABASE_URL: "postgresql://localhost/development",
      ...values,
    },
  }));

  for (const { name, environment } of guardedEnvironments) {
    const invokedCommands: string[] = [];
    const attemptFixtureCommands = () => {
      requireDisposableDevelopmentDatabaseUrl(environment);
      invokedCommands.push("createdb", "dropdb");
    };

    assert.throws(
      attemptFixtureCommands,
      /refuse production or deployment runtimes/,
      `${name} must refuse the isolated database fixture`,
    );
    assert.deepEqual(
      invokedCommands,
      [],
      `${name} must be rejected before createdb or dropdb`,
    );
  }

  const developmentDatabaseUrl = requireDisposableDevelopmentDatabaseUrl({
    DATABASE_URL: "postgresql://localhost/development",
    NODE_ENV: "test",
    REPLIT_DEPLOYMENT: "0",
    REPL_DEPLOYMENT: "0",
  });
  assert.equal(developmentDatabaseUrl, "postgresql://localhost/development");
});

test("database command failures redact connection strings but retain useful diagnostics", () => {
  const databaseUrl = "postgresql://secret-user:secret-password@db.example.test:5432/lumera?sslmode=require";
  const failure = Object.assign(
    new Error(`Command failed: psql ${databaseUrl}`),
    {
      code: 2,
      stderr: `psql: error: connection to ${databaseUrl} failed: timeout`,
      stdout: `maintenance target ${databaseUrl}`,
    },
  );
  const formatted = formatDatabaseCommandFailure(
    "Preparing the disposable database schema",
    failure,
    { DATABASE_URL: databaseUrl },
  );
  const report = `${formatted.message}\n${
    redactDatabaseCommandOutput(`${failure.stdout}\n${failure.stderr}`, {
      DATABASE_URL: databaseUrl,
    })
  }`;

  assert.match(report, /Preparing the disposable database schema/);
  assert.match(report, /exit code 2/);
  assert.match(report, /timeout/);
  assert.match(report, /<redacted-database-url>/);
  assert.doesNotMatch(report, /secret-user|secret-password|db\.example\.test|sslmode/);
  assert.doesNotMatch(report, new RegExp(databaseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("streamed database output redacts a connection string split across chunks", () => {
  const databaseUrl = "postgresql://stream-user:stream-password@db.example.test/lumera";
  let report = "";
  const writer = createRedactedDatabaseOutputWriter(
    { DATABASE_URL: databaseUrl },
    { write(chunk) { report += chunk.toString(); return true; } },
  );

  writer.write(`startup diagnostic: ${databaseUrl.slice(0, 24)}`);
  writer.write(`${databaseUrl.slice(24)}\nserver failed after connection timeout\n`);
  writer.flush();

  assert.match(report, /startup diagnostic: <redacted-database-url>/);
  assert.match(report, /server failed after connection timeout/);
  assert.doesNotMatch(report, /stream-user|stream-password|db\.example\.test/);
  assert.doesNotMatch(report, new RegExp(databaseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("a spawned process cannot print its database connection string to reported output", async () => {
  const databaseUrl = "postgresql://process-user:process-password@db.example.test/lumera?ssl=require";
  const environment = { ...process.env, DATABASE_URL: databaseUrl };
  let stdout = "";
  let stderr = "";
  const child = spawn(
    process.execPath,
    [
      "-e",
      [
        "const value = process.env.DATABASE_URL;",
        "process.stdout.write(`database=${value.slice(0, 25)}`);",
        "setTimeout(() => {",
        "  process.stdout.write(`${value.slice(25)}\\n`);",
        "  process.stderr.write(`connection failed for ${value}\\n`);",
        "}, 5);",
      ].join("\n"),
    ],
    { env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  pipeRedactedDatabaseOutput(
    child,
    environment,
    { write(chunk) { stdout += chunk.toString(); return true; } },
    { write(chunk) { stderr += chunk.toString(); return true; } },
  );
  const [exitCode] = await once(child, "close");
  const report = `${stdout}\n${stderr}`;

  assert.equal(exitCode, 0);
  assert.match(report, /database=<redacted-database-url>/);
  assert.match(report, /connection failed for <redacted-database-url>/);
  assert.doesNotMatch(report, /process-user|process-password|db\.example\.test|ssl=require/);
});

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
    await runDatabaseCommand(
      "createdb",
      ["--maintenance-db", developmentDatabaseUrl, databaseName],
      { cwd: workspaceRoot },
      "Creating the isolated backend-standards database",
    );
    await runDatabaseCommand(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      { cwd: workspaceRoot, env: isolatedEnvironment, maxBuffer: 10 * 1024 * 1024 },
      "Preparing the isolated backend-standards schema",
    );
    await runDatabaseCommand(
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
      "Creating the invalid-index fixture",
    );

    let commandFailure: unknown;
    try {
      await runDatabaseCommand(
        "pnpm",
        ["--filter", "@workspace/scripts", "run", "test:backend-standards:database"],
        {
          cwd: workspaceRoot,
          env: isolatedEnvironment,
          maxBuffer: 10 * 1024 * 1024,
        },
        "Running the database release gate",
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
      await runDatabaseCommand(
        "dropdb",
        [
          "--force",
          "--if-exists",
          "--maintenance-db",
          developmentDatabaseUrl,
          databaseName,
        ],
        { cwd: workspaceRoot },
        "Removing the isolated backend-standards database",
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
    await runDatabaseCommand(
      "createdb",
      ["--maintenance-db", developmentDatabaseUrl, databaseName],
      { cwd: workspaceRoot },
      "Creating the isolated constraint database",
    );
    await runDatabaseCommand(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      { cwd: workspaceRoot, env: isolatedEnvironment, maxBuffer: 10 * 1024 * 1024 },
      "Preparing the isolated constraint schema",
    );
    await runDatabaseCommand(
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
      "Creating the unvalidated-constraint fixture",
    );

    let commandFailure: unknown;
    try {
      await runDatabaseCommand(
        "pnpm",
        ["--filter", "@workspace/scripts", "run", "test:backend-standards:database"],
        {
          cwd: workspaceRoot,
          env: isolatedEnvironment,
          maxBuffer: 10 * 1024 * 1024,
        },
        "Running the database constraint release gate",
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
      await runDatabaseCommand(
        "dropdb",
        [
          "--force",
          "--if-exists",
          "--maintenance-db",
          developmentDatabaseUrl,
          databaseName,
        ],
        { cwd: workspaceRoot },
        "Removing the isolated constraint database",
      );
    }
  }
});