import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  MigrationContractError,
  compareWithReference,
  readMigrationSet,
  sha256,
  validateDirectoryName,
  verifyMigrationContract,
} from "./contract";
import "./header.test";

async function fixture(migrations: Array<[string, string]>, extras: string[] = []): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumera-migration-contract-"));
  for (const [directory, sql] of migrations) {
    await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, directory, "migration.sql"), migrationSql(directory.slice(0, 6), sql));
  }
  for (const extra of extras) await writeFile(path.join(root, extra), "unexpected");
  return root;
}

function migrationSql(id: string, body: string): string {
  return [
    "-- lumera:migration-format 1",
    `-- lumera:id ${id}`,
    "-- lumera:mode transactional",
    "-- lumera:description Contract fixture migration.",
    "-- lumera:min-postgres 16",
    "-- lumera:max-postgres 16",
    "-- lumera:recovery Restore the prior schema from the reviewed migration plan.",
    "-- lumera:end-header",
    body,
  ].join("\n");
}

async function rejectsWith(root: string, pattern: RegExp): Promise<void> {
  await assert.rejects(() => readMigrationSet(root), pattern);
}

test("accepts a valid sequence and returns deterministic ordering and hashes", async (t) => {
  const root = await fixture([
    ["000002_add_customer_preferences", "select 2;\n"],
    ["000001_create_customer_profile", "select 1;\n"],
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await readMigrationSet(root);
  const second = await readMigrationSet(root);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((record) => record.sequence), [1, 2]);
  assert.equal(first[0]?.sha256, sha256(migrationSql("000001", "select 1;\n")));
  assert.equal(first[0]?.metadata.migrationId, "000001");
  assert.equal(sha256("same bytes"), sha256("same bytes"));
  assert.notEqual(sha256("same bytes"), sha256("different bytes"));
});

test("checksum covers the complete header as well as the SQL body", () => {
  const original = migrationSql("000001", "SELECT 1;\n");
  const metadataEdit = original.replace(
    "Contract fixture migration.",
    "Contract fixture migration with changed metadata.",
  );
  assert.notEqual(sha256(original), sha256(metadataEdit));
});

test("rejects sequence gaps and duplicate numbers", async (t) => {
  const gap = await fixture([["000002_add_customer_preferences", "select 1;"]]);
  const duplicate = await fixture([
    ["000001_add_customer_preferences", "select 1;"],
    ["000001_create_customer_profile", "select 2;"],
  ]);
  t.after(() => Promise.all([
    rm(gap, { recursive: true, force: true }),
    rm(duplicate, { recursive: true, force: true }),
  ]));
  await rejectsWith(gap, /sequence gap/i);
  await rejectsWith(duplicate, /duplicate|reused/i);
});

test("rejects invalid, uppercase, bad snake case, generic, date, and branch/task names", () => {
  for (const name of [
    "1_add_customer",
    "000001_Add_customer",
    "000001_add-customer",
    "000001_fix",
    "000001_final",
    "000001_v2",
    "000001_v3_cleanup",
    "000001_fix_final",
    "000001_a",
    "000001_d20260909",
    "000001_2026_09_09_customer",
    "000001_task_921",
    "000001_main_customer_change",
  ]) {
    assert.throws(() => validateDirectoryName(name), MigrationContractError, name);
  }
});

test("rejects missing migration.sql and unexpected layout", async (t) => {
  const missing = await fixture([]);
  await mkdir(path.join(missing, "000001_add_customer_preferences"));
  const extraRootEntry = await fixture([], ["notes.txt"]);
  const extraMigrationEntry = await fixture([["000001_add_customer_preferences", "select 1;"]]);
  await writeFile(path.join(extraMigrationEntry, "000001_add_customer_preferences", "notes.txt"), "no");
  t.after(() => Promise.all([missing, extraRootEntry, extraMigrationEntry]
    .map((root) => rm(root, { recursive: true, force: true }))));
  await rejectsWith(missing, /exactly one regular migration\.sql/i);
  await rejectsWith(extraRootEntry, /unexpected migration root entry/i);
  await rejectsWith(extraMigrationEntry, /exactly one regular migration\.sql/i);
});

test("rejects migration.sql symlinks", async (t) => {
  const root = await fixture([]);
  const directory = path.join(root, "000001_add_customer_preferences");
  await mkdir(directory);
  await writeFile(path.join(root, "README.md"), "select 1;");
  await symlink(path.join(root, "README.md"), path.join(directory, "migration.sql"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await rejectsWith(root, /regular migration\.sql/i);
});

test("detects renamed, edited, deleted, replaced, and reused historical migrations", async (t) => {
  const reference = await fixture([
    ["000001_create_customer_profile", "select 1;"],
    ["000002_add_customer_preferences", "select 2;"],
  ]);
  const renamed = await fixture([
    ["000001_create_customer_account", "select 1;"],
    ["000002_add_customer_preferences", "select 2;"],
  ]);
  const edited = await fixture([
    ["000001_create_customer_profile", "select changed;"],
    ["000002_add_customer_preferences", "select 2;"],
  ]);
  const deleted = await fixture([["000001_create_customer_profile", "select 1;"]]);
  const replaced = await fixture([
    ["000001_create_customer_profile", "select replacement;"],
    ["000002_add_customer_preferences", "select 2;"],
  ]);
  t.after(() => Promise.all([reference, renamed, edited, deleted, replaced]
    .map((root) => rm(root, { recursive: true, force: true }))));
  const protectedSet = await readMigrationSet(reference);
  await assert.rejects(
    async () => compareWithReference(await readMigrationSet(renamed), protectedSet),
    /renamed|reused/i,
  );
  await assert.rejects(
    async () => compareWithReference(await readMigrationSet(edited), protectedSet),
    /edited|replaced/i,
  );
  await assert.rejects(
    async () => compareWithReference(await readMigrationSet(deleted), protectedSet),
    /removed/i,
  );
  await assert.rejects(
    async () => compareWithReference(await readMigrationSet(replaced), protectedSet),
    /edited|replaced/i,
  );
});

test("accepts appended migrations and fails when the reference is unavailable", async (t) => {
  const reference = await fixture([["000001_create_customer_profile", "select 1;"]]);
  const current = await fixture([
    ["000001_create_customer_profile", "select 1;"],
    ["000002_add_customer_preferences", "select 2;"],
  ]);
  t.after(() => Promise.all([reference, current]
    .map((root) => rm(root, { recursive: true, force: true }))));
  const result = await verifyMigrationContract(current, reference);
  assert.equal(result.current.length, 2);
  await assert.rejects(
    () => verifyMigrationContract(current, path.join(reference, "missing")),
    /reference migration directory is unavailable/i,
  );
});

test("rejects self-reference through the same path or a symlink alias", async (t) => {
  const current = await fixture([["000001_create_customer_profile", "select 1;"]]);
  const aliasRoot = await mkdtemp(path.join(os.tmpdir(), "lumera-migration-alias-"));
  const alias = path.join(aliasRoot, "reference");
  await symlink(current, alias);
  t.after(() => Promise.all([
    rm(current, { recursive: true, force: true }),
    rm(aliasRoot, { recursive: true, force: true }),
  ]));
  await assert.rejects(
    () => verifyMigrationContract(current, current),
    /independent physical directories/i,
  );
  await assert.rejects(
    () => verifyMigrationContract(current, alias),
    /independent physical directories/i,
  );
});

// Inspect syntax without resolving or executing any fixture imports.
function assertNoCapabilities(source: string): void {
  const tree = ts.createSourceFile("capability-fixture.ts", source, ts.ScriptTarget.Latest, true);
  const forbiddenModule = /^(?:node:)?(?:pg|postgres|drizzle-kit|drizzle-orm|child_process|http|https|http2|net|tls|dgram|undici)(?:\/|$)|^(?:https?:|@workspace\/db(?:\/|$))|(?:^|\/)(?:bootstrap|runtime)(?:[./-]|$)/;
  const forbiddenCall = /^(?:execFile|execSync|execFileSync|spawn|spawnSync|fetch)$/;
  function checkModule(node: ts.Expression | undefined): void {
    if (node && ts.isStringLiteralLike(node)) {
      assert.equal(forbiddenModule.test(node.text), false, `forbidden module: ${node.text}`);
    }
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      checkModule(node.moduleSpecifier);
    } else if (ts.isExternalModuleReference(node)) {
      checkModule(node.expression);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text
        : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
          ? callee.argumentExpression.text : undefined;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || name === "require") {
        checkModule(node.arguments[0]);
      }
      if (name) assert.equal(forbiddenCall.test(name), false, `forbidden call: ${name}`);
    }
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
      assert.notEqual(node.text, "DATABASE_URL", "forbidden DATABASE_URL access");
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}

// Deliberately specific to the CI validator's one Git helper; this is not a
// data-flow analyzer and does not attempt to prove arbitrary TypeScript safe.
function assertNarrowCiGitCapabilities(source: string): void {
  const tree = ts.createSourceFile("ci-capability-fixture.ts", source, ts.ScriptTarget.Latest, true);
  const forbiddenModule = /^(?:node:)?(?:pg|postgres|drizzle-kit|drizzle-orm|http|https|http2|net|tls|dgram|undici)(?:\/|$)|^(?:https?:|@workspace\/db(?:\/|$))|(?:^|\/)(?:bootstrap|runtime)(?:[./-]|$)/;

  function moduleText(node: ts.Expression | undefined): string | undefined {
    return node && ts.isStringLiteralLike(node) ? node.text : undefined;
  }
  function enclosingFunctionName(node: ts.Node): string | undefined {
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if (ts.isFunctionDeclaration(current)) return current.name?.text;
      current = current.parent;
    }
    return undefined;
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const imported = moduleText(node.moduleSpecifier);
      if (imported) {
        assert.equal(forbiddenModule.test(imported), false, `forbidden module: ${imported}`);
        if (/(?:^|:)child_process$/.test(imported)) {
          assert.ok(ts.isImportDeclaration(node), "child_process may only be imported");
          const names = node.importClause?.namedBindings;
          assert.ok(names && ts.isNamedImports(names), "child_process requires a named import");
          assert.equal(node.importClause?.name, undefined, "child_process does not allow a default import");
          assert.deepEqual(names.elements.map(({ name }) => name.text), ["spawn"]);
        }
      }
    } else if (ts.isExternalModuleReference(node)) {
      const imported = moduleText(node.expression);
      if (imported) assert.equal(forbiddenModule.test(imported), false, `forbidden module: ${imported}`);
      assert.fail("require/import-equals is forbidden in the CI validator");
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text
        : undefined;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || name === "require") {
        assert.fail("dynamic import/require is forbidden in the CI validator");
      }
      const regexExec = name === "exec"
        && ts.isPropertyAccessExpression(callee)
        && callee.expression.kind === ts.SyntaxKind.RegularExpressionLiteral;
      if (name && /^(?:exec|execFile|execSync|execFileSync|spawnSync|fetch|eval|Function)$/.test(name)
        && !regexExec) {
        assert.fail(`forbidden call: ${name}`);
      }
      if (name === "spawn") {
        assert.equal(enclosingFunctionName(node), "gitCommand", "spawn is allowed only in gitCommand");
        assert.ok(ts.isStringLiteral(node.arguments[0]!) && node.arguments[0].text === "git",
          "spawn executable must be literal git");
        assert.ok(ts.isIdentifier(node.arguments[1]!)
          && node.arguments[1].text === "argumentsToPass",
        "spawn argv must be the gitCommand argv parameter");
        const options = node.arguments[2];
        assert.ok(options && ts.isObjectLiteralExpression(options), "spawn options must be literal");
        const shell = options.properties.find((property) =>
          ts.isPropertyAssignment(property)
          && ts.isIdentifier(property.name)
          && property.name.text === "shell");
        assert.ok(shell && ts.isPropertyAssignment(shell)
          && shell.initializer.kind === ts.SyntaxKind.FalseKeyword,
        "spawn must explicitly set shell: false");
      }
      if (name === "gitCommand" && enclosingFunctionName(node) !== "gitCommand") {
        assert.ok(ts.isArrayLiteralExpression(node.arguments[0]!),
          "gitCommand argv must be an array literal at every call site");
      }
    } else if (ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "Function") {
      assert.fail("new Function is forbidden");
    } else if (ts.isPropertyAssignment(node)
      && ((ts.isIdentifier(node.name) && node.name.text === "shell")
        || (ts.isStringLiteralLike(node.name) && node.name.text === "shell"))) {
      assert.notEqual(node.initializer.kind, ts.SyntaxKind.TrueKeyword, "shell: true is forbidden");
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}

test("implementation has no database, network, drizzle-kit, bootstrap, or shell capability", async () => {
  const sourceFiles = [
    new URL("./contract.ts", import.meta.url),
    new URL("./verify-migration-contract.ts", import.meta.url),
    new URL("./header.ts", import.meta.url),
  ];
  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    assert.doesNotThrow(() => assertNoCapabilities(source), file.pathname);
  }
});

test("CI validator has only the narrow literal-git subprocess capability", async () => {
  const source = await readFile(
    new URL("./validate-ci-migration-contract.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotThrow(() => assertNarrowCiGitCapabilities(source));
});

test("CI capability guard rejects arbitrary executables, dynamic argv, shells, eval, and imports", () => {
  for (const source of [
    'import { spawn } from "node:child_process"; function gitCommand(argumentsToPass: string[]) { spawn("node", argumentsToPass, { shell: false }); }',
    'import { spawn } from "node:child_process"; const args = ["status"]; spawn("git", args, { shell: false });',
    'import { spawn } from "node:child_process"; function gitCommand(argumentsToPass: string[]) { spawn("git", argumentsToPass, { shell: true }); }',
    'import { execFile } from "node:child_process"; execFile("git", ["status"]);',
    'import { spawn } from "node:child_process"; function gitCommand(argumentsToPass: string[]) { spawn("git", argumentsToPass, { shell: false }); } gitCommand(dynamicArgs);',
    'import database from "@workspace/db";',
    'import capability, { spawn } from "node:child_process";',
    'import network from "node:https";',
    'import runtime from "../runtime";',
    'exec("git status");',
    'some.exec("git status");',
    'eval("code");',
    'new Function("code");',
  ]) assert.throws(
    () => assertNarrowCiGitCapabilities(source),
    () => true,
    source,
  );
});

test("capability guard rejects actual pg imports and requires without executing them", () => {
  for (const source of [
    'import { Pool } from "pg";',
    "import pg from 'pg';",
    'import "pg";',
    'const pg = require /* spacing */ ("pg");',
    'import pg = require("pg");',
    'const pg = import("pg");',
    'export { Pool } from "pg";',
  ]) assert.throws(() => assertNoCapabilities(source), /forbidden module: pg/, source);
});

test("capability guard preserves other forbidden modules, calls, and database configuration coverage", () => {
  for (const module of [
    "postgres", "drizzle-kit", "drizzle-orm/pg-core", "@workspace/db",
    "child_process", "node:child_process", "http", "node:https", "https://example.invalid/module",
    "../bootstrap", "../runtime",
  ]) {
    assert.throws(() => assertNoCapabilities(`import capability from "${module}";`), /forbidden module/);
    assert.throws(() => assertNoCapabilities(`const capability = require("${module}");`), /forbidden module/);
  }
  for (const source of [
    'execFile("command");', 'execSync("command");', 'spawn ("command");',
    'fetch ("https://example.invalid");', 'globalThis.fetch("https://example.invalid");',
    "process.env.DATABASE_URL;", 'process.env["DATABASE_URL"];',
  ]) assert.throws(() => assertNoCapabilities(source), /forbidden (call|DATABASE_URL)/, source);
});

test("capability guard permits harmless PostgreSQL terminology and import-like text", () => {
  assert.doesNotThrow(() => assertNoCapabilities(`
    import { SUPPORTED_POSTGRES_MAJOR_VERSIONS } from "../schema-drift/model";
    const keys = ["min-postgres", "max-postgres"];
    function postgresMajor() { return SUPPORTED_POSTGRES_MAJOR_VERSIONS; }
    // import pg from "pg";
    const example = 'import pg from "pg"; fetch("example")';
  `));
});