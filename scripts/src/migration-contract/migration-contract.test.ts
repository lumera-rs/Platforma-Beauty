import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MigrationContractError,
  compareWithReference,
  readMigrationSet,
  sha256,
  validateDirectoryName,
  verifyMigrationContract,
} from "./contract";

async function fixture(migrations: Array<[string, string]>, extras: string[] = []): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumera-migration-contract-"));
  for (const [directory, sql] of migrations) {
    await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, directory, "migration.sql"), sql);
  }
  for (const extra of extras) await writeFile(path.join(root, extra), "unexpected");
  return root;
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
  assert.equal(first[0]?.sha256, sha256("select 1;\n"));
  assert.equal(sha256("same bytes"), sha256("same bytes"));
  assert.notEqual(sha256("same bytes"), sha256("different bytes"));
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

test("implementation has no database, network, drizzle-kit, bootstrap, or shell capability", async () => {
  const sourceFiles = [
    new URL("./contract.ts", import.meta.url),
    new URL("./verify-migration-contract.ts", import.meta.url),
  ];
  const source = (await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")))).join("\n");
  for (const forbidden of [
    "DATABASE_URL",
    "from \"pg\"",
    "from 'pg'",
    "postgres",
    "drizzle-kit",
    "child_process",
    "execFile",
    "execSync",
    "spawn(",
    "fetch(",
    "http:",
    "https:",
    "bootstrap",
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});