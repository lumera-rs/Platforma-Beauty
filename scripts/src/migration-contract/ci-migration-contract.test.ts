import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  main,
  runCiMigrationContract,
  safeTreePath,
} from "./validate-ci-migration-contract";

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
      Object.entries(process.env).filter(([key]) =>
        !/^(?:DATABASE_URL(?:_UNPOOLED)?|POSTGRES_URL|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|.+_DATABASE_URL)$/.test(key)),
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

async function repository(withMigration = true): Promise<{ root: string; base: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumera-ci-migration-git-"));
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "migration-contract@example.invalid");
  await git(root, "config", "user.name", "Migration Contract Test");
  await mkdir(path.join(root, "lib", "db", "migrations"), { recursive: true });
  await writeFile(path.join(root, "lib", "db", "migrations", "README.md"), "Migrations.\n");
  if (withMigration) await writeMigration(root, "000001_create_customer_profile");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "base");
  await git(root, "remote", "add", "origin", `file://${root}`);
  return { root, base: await git(root, "rev-parse", "HEAD") };
}

async function commit(root: string, message = "current"): Promise<string> {
  await git(root, "add", "-A");
  await git(root, "commit", "-qm", message);
  return await git(root, "rev-parse", "HEAD");
}

type NativeEvent = "pull_request" | "merge_group" | "push" | "workflow_dispatch";

async function ciEnvironment(
  root: string,
  eventName: NativeEvent,
  base?: string,
): Promise<NodeJS.ProcessEnv> {
  const eventPath = path.join(root, `.event-${eventName}.json`);
  const payload = eventName === "pull_request"
    ? { pull_request: { base: { sha: base } } }
    : eventName === "merge_group"
      ? { merge_group: { base_sha: base } }
      : {};
  await writeFile(eventPath, JSON.stringify(payload));
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: eventName,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_SHA: await git(root, "rev-parse", "HEAD"),
    GITHUB_REF: eventName === "merge_group" ? "refs/heads/gh-readonly-queue/main/test" : "refs/pull/1/merge",
    LUMERA_CI_EVENT_NAME: eventName,
    ...(eventName === "pull_request" && base ? { LUMERA_CI_PR_BASE_SHA: base } : {}),
    ...(eventName === "merge_group" && base ? { LUMERA_CI_MERGE_GROUP_BASE_SHA: base } : {}),
  };
}

test("native PR and merge_group validate payload-authoritative immutable history", async (t) => {
  const repo = await repository();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await writeMigration(repo.root, "000002_add_customer_preferences", migrationSql("000002", "select 2;\n"));
  await commit(repo.root);
  for (const event of ["pull_request", "merge_group"] as const) {
    const result = await runCiMigrationContract({
      repoRoot: repo.root,
      environment: await ciEnvironment(repo.root, event, repo.base),
    });
    assert.equal(result.eventName, event);
    assert.equal(result.protectedMigrations, 1);
    assert.deepEqual(result.current.map(({ sequence }) => sequence), [1, 2]);
  }
});

test("empty protected base permits the first 000001 append", async (t) => {
  const repo = await repository(false);
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  await writeMigration(repo.root, "000001_create_customer_profile");
  await commit(repo.root);
  const result = await runCiMigrationContract({
    repoRoot: repo.root,
    environment: await ciEnvironment(repo.root, "pull_request", repo.base),
  });
  assert.equal(result.protectedMigrations, 0);
  assert.deepEqual(result.current.map(({ sequence }) => sequence), [1]);
});

test("PR rejects edits, removals, renames, malformed additions, gaps, and CRLF rewrites", async (t) => {
  for (const scenario of ["body", "header", "deleted", "renamed", "gap", "crlf"] as const) {
    await t.test(scenario, async (t) => {
      const repo = await repository();
      t.after(() => rm(repo.root, { recursive: true, force: true }));
      const original = path.join(repo.root, "lib/db/migrations/000001_create_customer_profile");
      const sql = path.join(original, "migration.sql");
      if (scenario === "body") await writeFile(sql, migrationSql("000001", "select 2;\n"));
      if (scenario === "header") {
        await writeFile(sql, migrationSql("000001").replace("fixture migration", "changed fixture migration"));
      }
      if (scenario === "deleted") await rm(original, { recursive: true });
      if (scenario === "renamed") {
        const renamed = path.join(repo.root, "lib/db/migrations/000001_create_customer_account");
        await mkdir(renamed);
        await writeFile(path.join(renamed, "migration.sql"), migrationSql("000001"));
        await rm(original, { recursive: true });
      }
      if (scenario === "gap") await writeMigration(repo.root, "000003_add_customer_preferences", migrationSql("000003"));
      if (scenario === "crlf") await writeFile(sql, migrationSql("000001").replaceAll("\n", "\r\n"));
      await commit(repo.root);
      await assert.rejects(
        runCiMigrationContract({
          repoRoot: repo.root,
          environment: await ciEnvironment(repo.root, "pull_request", repo.base),
        }),
        /edited|replaced|removed|renamed|reused|gap/i,
      );
    });
  }
});

test("partial native context, unsupported events, bad payloads, and compatibility mismatches fail closed", async (t) => {
  const repo = await repository();
  t.after(() => rm(repo.root, { recursive: true, force: true }));

  for (const key of ["GITHUB_ACTIONS", "GITHUB_EVENT_NAME", "GITHUB_EVENT_PATH", "GITHUB_SHA", "GITHUB_REF"] as const) {
    const environment = await ciEnvironment(repo.root, "push");
    delete environment[key];
    await assert.rejects(
      runCiMigrationContract({ repoRoot: repo.root, environment }),
      /incomplete GitHub event context/i,
    );
  }
  await assert.rejects(
    runCiMigrationContract({
      repoRoot: repo.root,
      environment: { PATH: process.env.PATH, GITHUB_EVENT_NAME: "push" },
    }),
    /incomplete GitHub event context/i,
  );

  const unsupported = await ciEnvironment(repo.root, "push");
  unsupported.GITHUB_EVENT_NAME = "issues";
  unsupported.LUMERA_CI_EVENT_NAME = "issues";
  await assert.rejects(
    runCiMigrationContract({ repoRoot: repo.root, environment: unsupported }),
    /unsupported migration-contract event/i,
  );

  const malformed = await ciEnvironment(repo.root, "pull_request", repo.base);
  await writeFile(malformed.GITHUB_EVENT_PATH!, "{");
  await assert.rejects(
    runCiMigrationContract({ repoRoot: repo.root, environment: malformed }),
    /missing or malformed/i,
  );
  const missing = await ciEnvironment(repo.root, "pull_request", repo.base);
  missing.GITHUB_EVENT_PATH = path.join(repo.root, "absent.json");
  await assert.rejects(
    runCiMigrationContract({ repoRoot: repo.root, environment: missing }),
    /missing or malformed/i,
  );
  const mismatch = await ciEnvironment(repo.root, "pull_request", repo.base);
  mismatch.LUMERA_CI_PR_BASE_SHA = "f".repeat(40);
  await assert.rejects(
    runCiMigrationContract({ repoRoot: repo.root, environment: mismatch }),
    /must be present and equal/i,
  );
  const missingPrCompatibility = await ciEnvironment(repo.root, "pull_request", repo.base);
  delete missingPrCompatibility.LUMERA_CI_PR_BASE_SHA;
  await assert.rejects(
    runCiMigrationContract({ repoRoot: repo.root, environment: missingPrCompatibility }),
    /must be present and equal/i,
  );
  const mergeGroupMismatch = await ciEnvironment(repo.root, "merge_group", repo.base);
  mergeGroupMismatch.LUMERA_CI_MERGE_GROUP_BASE_SHA = "f".repeat(40);
  await assert.rejects(
    runCiMigrationContract({ repoRoot: repo.root, environment: mergeGroupMismatch }),
    /must be present and equal/i,
  );
  const missingMergeGroupCompatibility = await ciEnvironment(repo.root, "merge_group", repo.base);
  delete missingMergeGroupCompatibility.LUMERA_CI_MERGE_GROUP_BASE_SHA;
  await assert.rejects(
    runCiMigrationContract({ repoRoot: repo.root, environment: missingMergeGroupCompatibility }),
    /must be present and equal/i,
  );
  const eventMismatch = await ciEnvironment(repo.root, "push");
  eventMismatch.LUMERA_CI_EVENT_NAME = "workflow_dispatch";
  await assert.rejects(
    runCiMigrationContract({ repoRoot: repo.root, environment: eventMismatch }),
    /event mismatch/i,
  );
});

test("push and workflow_dispatch validate current state while local mode needs no GitHub context", async (t) => {
  const repo = await repository();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  for (const event of ["push", "workflow_dispatch"] as const) {
    const result = await runCiMigrationContract({
      repoRoot: repo.root,
      environment: await ciEnvironment(repo.root, event),
    });
    assert.equal(result.eventName, event);
    assert.equal(result.protectedMigrations, 0);
  }
  const local = await runCiMigrationContract({
    repoRoot: repo.root,
    environment: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  assert.equal(local.eventName, "local");
  await assert.rejects(
    runCiMigrationContract({
      repoRoot: repo.root,
      environment: { PATH: process.env.PATH, LUMERA_CI_MERGE_GROUP_BASE_SHA: repo.base },
    }),
    /forbidden in local mode/i,
  );
});

test("Gate N rejects each documented database credential family before Git", async (t) => {
  const repo = await repository();
  t.after(() => rm(repo.root, { recursive: true, force: true }));
  for (const key of [
    "DATABASE_URL", "LUMERA_DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL",
    "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD",
  ]) {
    await assert.rejects(
      runCiMigrationContract({
        repoRoot: path.join(repo.root, "missing"),
        environment: { PATH: process.env.PATH, [key]: "forbidden" },
      }),
      new RegExp(key),
    );
  }
});

test("safeTreePath rejects traversal, absolute, backslash, and outside-tree paths", () => {
  for (const unsafe of [
    "../migration.sql",
    "/lib/db/migrations/000001_x/migration.sql",
    "lib/db/migrations/../migration.sql",
    "lib\\db\\migrations\\migration.sql",
    "other/migration.sql",
  ]) assert.throws(() => safeTreePath(Buffer.from(unsafe)), /unsafe/i);
});

test("historical symlinks and gitlinks are rejected during native materialization", async (t) => {
  for (const kind of ["symlink", "gitlink"] as const) {
    await t.test(kind, async (t) => {
      const repo = await repository(false);
      t.after(() => rm(repo.root, { recursive: true, force: true }));
      const migrationPath = "lib/db/migrations/000001_create_customer_profile/migration.sql";
      if (kind === "symlink") {
        await mkdir(path.dirname(path.join(repo.root, migrationPath)), { recursive: true });
        await writeFile(path.join(repo.root, "target.sql"), migrationSql("000001"));
        await execFileAsync("ln", ["-s", "../../../../target.sql", path.join(repo.root, migrationPath)]);
        await git(repo.root, "add", "-A");
      } else {
        await git(repo.root, "update-index", "--add", "--cacheinfo", "160000", repo.base, migrationPath);
      }
      await git(repo.root, "commit", "-qm", kind);
      const badBase = await git(repo.root, "rev-parse", "HEAD");
      if (kind === "symlink") await rm(path.join(repo.root, migrationPath));
      else await git(repo.root, "rm", "--cached", "-q", migrationPath);
      await writeMigration(repo.root, "000001_create_customer_profile");
      await commit(repo.root, "regular current");
      await assert.rejects(
        runCiMigrationContract({
          repoRoot: repo.root,
          environment: await ciEnvironment(repo.root, "pull_request", badBase),
        }),
        /not a regular file/i,
      );
    });
  }
});

test("bounded exact-SHA deepening proves older B0 and rejects unrelated/nonexistent SHAs", async (t) => {
  const source = await repository();
  const temp = await mkdtemp(path.join(os.tmpdir(), "lumera-ci-deepen-"));
  const origin = path.join(temp, "origin.git");
  const checkout = path.join(temp, "checkout");
  t.after(() => Promise.all([
    rm(source.root, { recursive: true, force: true }),
    rm(temp, { recursive: true, force: true }),
  ]));

  const b0 = source.base;
  await writeFile(path.join(source.root, "b1"), "b1");
  await commit(source.root, "B1");
  await writeFile(path.join(source.root, "b2"), "b2");
  const b2 = await commit(source.root, "B2");
  await git(source.root, "checkout", "-qb", "feature", b0);
  await writeMigration(source.root, "000002_add_customer_preferences", migrationSql("000002"));
  const feature = await commit(source.root, "F");
  const mergeTree = await git(source.root, "merge-tree", "--write-tree", b2, feature);
  const merge = await git(source.root, "commit-tree", mergeTree, "-p", b2, "-p", feature, "-m", "merge");
  const unrelated = await git(source.root, "commit-tree", `${merge}^{tree}`, "-m", "unrelated");
  await git(temp, "clone", "-q", "--bare", source.root, origin);
  await git(origin, "update-ref", "refs/pull/1/merge", merge);
  await git(origin, "update-ref", "refs/heads/unrelated", unrelated);
  await git(temp, "init", "-q", checkout);
  await git(checkout, "remote", "add", "origin", `file://${origin}`);
  await git(checkout, "fetch", "-q", "--depth=2", "origin", "refs/pull/1/merge");
  await git(checkout, "checkout", "-q", "--detach", "FETCH_HEAD");
  await assert.rejects(
    execFileAsync("git", ["merge-base", "--is-ancestor", b0, "HEAD"], { cwd: checkout }),
    "the initial shallow checkout must not prove the older base",
  );

  const accepted = await runCiMigrationContract({
    repoRoot: checkout,
    environment: await ciEnvironment(checkout, "pull_request", b0),
  });
  assert.equal(accepted.protectedMigrations, 1);
  assert.equal(await git(checkout, "merge-base", "--is-ancestor", b0, "HEAD").then(() => "yes"), "yes");

  for (const [sha, pattern] of [
    [unrelated, /not an ancestor/i],
    ["f".repeat(40), /unavailable from origin/i],
  ] as const) {
    await assert.rejects(
      runCiMigrationContract({
        repoRoot: checkout,
        environment: await ciEnvironment(checkout, "pull_request", sha),
      }),
      pattern,
    );
  }
  const remotes = await git(checkout, "for-each-ref", "--format=%(refname)", "refs/remotes");
  assert.equal(remotes, "", "validator must not fetch a mutable branch ref");
});

test("CI CLI rejects every argument, including event payload paths", async () => {
  assert.equal(await main(["--event-path=/tmp/untrusted.json"]), 1);
});