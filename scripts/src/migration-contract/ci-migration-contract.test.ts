import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { runCiMigrationContract } from "./validate-ci-migration-contract";

const execFileAsync = promisify(execFile);

function migrationSql(id: string, body = "select 1;\n"): string {
  return [
    "-- lumera:migration-format 1",
    `-- lumera:id ${id}`,
    "-- lumera:mode transactional",
    "-- lumera:description CI orchestration fixture migration.",
    "-- lumera:min-postgres 16",
    "-- lumera:max-postgres 16",
    "-- lumera:recovery Restore the prior reviewed schema.",
    "-- lumera:end-header",
    body,
  ].join("\n");
}

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd: root,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/(?:^|_)DATABASE_URL$/.test(key)),
    ),
  });
  return result.stdout.trim();
}

async function writeMigration(root: string, directory: string, contents?: string): Promise<void> {
  const migrationRoot = path.join(root, "lib", "db", "migrations");
  await mkdir(path.join(migrationRoot, directory), { recursive: true });
  await writeFile(
    path.join(migrationRoot, directory, "migration.sql"),
    contents ?? migrationSql(directory.slice(0, 6)),
  );
}

async function repository(): Promise<{ root: string; base: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumera-ci-migration-git-"));
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "migration-contract@example.invalid");
  await git(root, "config", "user.name", "Migration Contract Test");
  await mkdir(path.join(root, "lib", "db", "migrations"), { recursive: true });
  await writeFile(path.join(root, "lib", "db", "migrations", "README.md"), "Migrations.\n");
  await writeMigration(root, "000001_create_customer_profile");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "base");
  return { root, base: await git(root, "rev-parse", "HEAD") };
}

async function commit(root: string, message = "current"): Promise<void> {
  await git(root, "add", "-A");
  await git(root, "commit", "-qm", message);
}

function ciEnvironment(
  eventName: "pull_request" | "push" | "workflow_dispatch",
  base?: string,
): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: eventName,
    LUMERA_CI_EVENT_NAME: eventName,
    ...(base ? { LUMERA_CI_PR_BASE_SHA: base } : {}),
  };
}

test("PR orchestration validates a trusted base and appended migration without a database", async (t) => {
  const repo = await repository();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await writeMigration(repo.root, "000002_add_customer_preferences", migrationSql("000002", "select 2;\n"));
  await commit(repo.root);
  const result = await runCiMigrationContract({
    repoRoot: repo.root,
    environment: ciEnvironment("pull_request", repo.base),
  });
  assert.equal(result.eventName, "pull_request");
  assert.equal(result.protectedMigrations, 1);
  assert.deepEqual(result.current.map((record) => record.sequence), [1, 2]);
});

test("PR orchestration rejects malformed headers, sequence gaps, and duplicate IDs", async (t) => {
  for (const scenario of ["header", "gap", "duplicate"] as const) {
    await t.test(scenario, async (t) => {
      const repo = await repository();
      t.after(() => rm(repo.root, { recursive: true, force: true }));
      if (scenario === "header") {
        await writeMigration(
          repo.root,
          "000002_add_customer_preferences",
          migrationSql("000002").replace("-- lumera:mode transactional", "-- lumera:mode invalid"),
        );
      } else if (scenario === "gap") {
        await writeMigration(repo.root, "000003_add_customer_preferences", migrationSql("000003"));
      } else {
        await writeMigration(repo.root, "000001_add_customer_preferences", migrationSql("000001"));
      }
      await commit(repo.root);
      await assert.rejects(
        runCiMigrationContract({
          repoRoot: repo.root,
          environment: ciEnvironment("pull_request", repo.base),
        }),
        scenario === "header" ? /mode/i : scenario === "gap" ? /gap/i : /duplicate|reused/i,
      );
    });
  }
});

test("PR orchestration rejects edited body, header metadata, and line-ending history", async (t) => {
  for (const scenario of ["body", "header", "line-ending"] as const) {
    await t.test(scenario, async (t) => {
      const repo = await repository();
      t.after(() => rm(repo.root, { recursive: true, force: true }));
      const file = path.join(
        repo.root,
        "lib/db/migrations/000001_create_customer_profile/migration.sql",
      );
      const original = migrationSql("000001");
      const edited = scenario === "body"
        ? original.replace("select 1;", "select 2;")
        : scenario === "header"
          ? original.replace("CI orchestration fixture", "Edited CI orchestration fixture")
          : original.replaceAll("\n", "\r\n");
      await writeFile(file, edited);
      await commit(repo.root);
      await assert.rejects(
        runCiMigrationContract({
          repoRoot: repo.root,
          environment: ciEnvironment("pull_request", repo.base),
        }),
        /edited or replaced/i,
      );
    });
  }
});

test("PR orchestration rejects deleted and renamed protected migrations", async (t) => {
  for (const scenario of ["deleted", "renamed"] as const) {
    await t.test(scenario, async (t) => {
      const repo = await repository();
      t.after(() => rm(repo.root, { recursive: true, force: true }));
      const original = path.join(repo.root, "lib/db/migrations/000001_create_customer_profile");
      if (scenario === "deleted") {
        await rm(original, { recursive: true });
      } else {
        const renamed = path.join(repo.root, "lib/db/migrations/000001_create_customer_account");
        await mkdir(renamed);
        await writeFile(path.join(renamed, "migration.sql"), migrationSql("000001"));
        await rm(original, { recursive: true });
      }
      await commit(repo.root);
      await assert.rejects(
        runCiMigrationContract({
          repoRoot: repo.root,
          environment: ciEnvironment("pull_request", repo.base),
        }),
        scenario === "deleted" ? /removed/i : /renamed|reused/i,
      );
    });
  }
});

test("PR orchestration fails closed for unavailable, malformed, and non-ancestor bases", async (t) => {
  const repo = await repository();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await writeMigration(repo.root, "000002_add_customer_preferences", migrationSql("000002"));
  await commit(repo.root);
  const tree = await git(repo.root, "rev-parse", "HEAD^{tree}");
  const unrelated = await git(repo.root, "commit-tree", tree, "-m", "unrelated");
  for (const [base, pattern] of [
    ["not-a-sha", /exact base commit SHA/i],
    ["f".repeat(40), /unavailable/i],
    [unrelated, /not an ancestor/i],
  ] as const) {
    await assert.rejects(
      runCiMigrationContract({
        repoRoot: repo.root,
        environment: ciEnvironment("pull_request", base),
      }),
      pattern,
    );
  }
});

test("push and workflow dispatch validate only the complete current set", async (t) => {
  const repo = await repository();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await writeFile(
    path.join(repo.root, "lib/db/migrations/000001_create_customer_profile/migration.sql"),
    migrationSql("000001", "select changed;\n"),
  );
  await commit(repo.root);
  for (const eventName of ["push", "workflow_dispatch"] as const) {
    const result = await runCiMigrationContract({
      repoRoot: repo.root,
      environment: ciEnvironment(eventName),
    });
    assert.equal(result.eventName, eventName);
    assert.equal(result.protectedMigrations, 0);
  }
});

test("orchestration rejects nonempty database environments before invoking git", async (t) => {
  const repo = await repository();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  for (const key of ["DATABASE_URL", "LUMERA_MIGRATION_DATABASE_URL"]) {
    await assert.rejects(
      runCiMigrationContract({
        repoRoot: path.join(repo.root, "does-not-exist"),
        environment: { ...ciEnvironment("push"), [key]: "postgres://forbidden.invalid/db" },
      }),
      new RegExp(key),
    );
  }
});

test("GitHub Actions derives the native event and rejects missing or mismatched context", async (t) => {
  const repo = await repository();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await writeMigration(repo.root, "000002_add_customer_preferences", migrationSql("000002"));
  await commit(repo.root);

  for (const configured of [undefined, ""] as const) {
    const derived = ciEnvironment("pull_request", repo.base);
    if (configured === undefined) delete derived.LUMERA_CI_EVENT_NAME;
    else derived.LUMERA_CI_EVENT_NAME = configured;
    const result = await runCiMigrationContract({ repoRoot: repo.root, environment: derived });
    assert.equal(result.eventName, "pull_request");
    assert.equal(result.protectedMigrations, 1);
  }

  const missingNative = ciEnvironment("push");
  delete missingNative.GITHUB_EVENT_NAME;
  delete missingNative.LUMERA_CI_EVENT_NAME;
  await assert.rejects(
    runCiMigrationContract({ repoRoot: repo.root, environment: missingNative }),
    /GITHUB_EVENT_NAME is required/i,
  );

  await assert.rejects(
    runCiMigrationContract({
      repoRoot: repo.root,
      environment: {
        ...ciEnvironment("push"),
        LUMERA_CI_EVENT_NAME: "workflow_dispatch",
      },
    }),
    /event mismatch/i,
  );
});

test("shallow synthetic merge checkout validates its exact first-parent base", async (t) => {
  const source = await repository();
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lumera-ci-merge-ref-"));
  const origin = path.join(temporaryRoot, "origin.git");
  const checkout = path.join(temporaryRoot, "checkout");
  t.after(() => Promise.all([
    rm(source.root, { recursive: true, force: true }),
    rm(temporaryRoot, { recursive: true, force: true }),
  ]));

  await git(source.root, "checkout", "-qb", "fork-head", source.base);
  await writeMigration(source.root, "000002_add_customer_preferences", migrationSql("000002"));
  await commit(source.root, "fork head");
  const forkHead = await git(source.root, "rev-parse", "HEAD");
  await git(source.root, "checkout", "-q", "-b", "protected-base", source.base);
  await writeFile(path.join(source.root, "protected-note.txt"), "new protected tip\n");
  await commit(source.root, "protected tip");
  const exactBase = await git(source.root, "rev-parse", "HEAD");
  const mergeTree = await git(source.root, "merge-tree", "--write-tree", exactBase, forkHead);
  const mergeCommit = await git(
    source.root,
    "commit-tree",
    mergeTree,
    "-p",
    exactBase,
    "-p",
    forkHead,
    "-m",
    "synthetic pull request merge",
  );

  await git(temporaryRoot, "clone", "-q", "--bare", source.root, origin);
  await git(origin, "update-ref", "refs/pull/1/merge", mergeCommit);
  await git(origin, "update-ref", "-d", "refs/heads/fork-head");
  await git(temporaryRoot, "init", "-q", checkout);
  await git(checkout, "remote", "add", "origin", `file://${origin}`);
  await git(checkout, "fetch", "-q", "--depth=2", "origin", "refs/pull/1/merge");
  await git(checkout, "checkout", "-q", "--detach", "FETCH_HEAD");
  await git(checkout, "fetch", "-q", "--no-tags", "--depth=1", "origin", exactBase);

  const result = await runCiMigrationContract({
    repoRoot: checkout,
    environment: ciEnvironment("pull_request", exactBase),
  });
  assert.equal(result.protectedMigrations, 1);
  assert.deepEqual(result.current.map((record) => record.sequence), [1, 2]);
  assert.equal(await git(checkout, "rev-parse", "HEAD^1"), exactBase);
  assert.equal(await git(checkout, "rev-list", "--count", "HEAD"), "3");
});