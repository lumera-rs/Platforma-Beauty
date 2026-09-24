import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertSafeRuntime,
  parsePhase5IntegrationOptions,
  runPhase5Integration,
  safeEnvironment,
  serialLogWriter,
  validatedOutputDirectory,
} from "./run-phase5-integration";
import { phase5DisposableIntegrationSuites } from "./phase5-test-inventory";

test("fresh checkouts without .local validate output without creating directories", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "lumera-phase5-fresh-checkout-"));
  const root = path.join(parent, "workspace");
  await mkdir(root);
  try {
    const external = path.join(parent, "runner-temp", "phase5", "output");
    const local = path.join(root, ".local", "phase5", "output");
    assert.equal(await validatedOutputDirectory(external, root), external);
    assert.equal(await validatedOutputDirectory(local, root), local);
    for (const forbidden of [
      root,
      path.join(root, "scripts", "output"),
      path.join(root, ".local-sibling", "output"),
      path.join(root, ".local", "..", "docs", "output"),
    ]) {
      await assert.rejects(
        () => validatedOutputDirectory(forbidden, root),
        /outside the workspace or inside ignored \.local/u,
      );
    }
    for (const absent of [path.join(root, ".local"), path.join(parent, "runner-temp")]) {
      await assert.rejects(() => access(absent), { code: "ENOENT" });
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("output containment follows existing symlinks before permitting missing tails", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "lumera-phase5-output-symlinks-"));
  const root = path.join(parent, "workspace");
  const local = path.join(root, ".local");
  const tracked = path.join(root, "docs");
  await mkdir(path.join(local, "safe"), { recursive: true });
  await mkdir(tracked);
  try {
    await symlink(tracked, path.join(local, "escape"), "dir");
    await symlink(tracked, path.join(parent, "external-alias"), "dir");
    await symlink(path.join(local, "safe"), path.join(local, "safe-alias"), "dir");
    for (const forbidden of [
      path.join(local, "escape", "missing", "output"),
      path.join(parent, "external-alias", "missing", "output"),
    ]) {
      await assert.rejects(
        () => validatedOutputDirectory(forbidden, root),
        /outside the workspace or inside ignored \.local/u,
      );
    }
    const safe = path.join(local, "safe-alias", "missing", "output");
    assert.equal(await validatedOutputDirectory(safe, root), safe);
    await symlink(root, path.join(parent, "workspace-alias"), "dir");
    assert.equal(await validatedOutputDirectory(safe, path.join(parent, "workspace-alias")), safe);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("a .local symlink cannot expand the allowed boundary into tracked workspace paths", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "lumera-phase5-local-boundary-"));
  const root = path.join(parent, "workspace");
  await mkdir(path.join(root, "docs"), { recursive: true });
  try {
    await symlink(root, path.join(root, ".local"), "dir");
    for (const forbidden of [
      path.join(root, "docs", "output"),
      path.join(root, ".local", "docs", "output"),
    ]) {
      await assert.rejects(
        () => validatedOutputDirectory(forbidden, root),
        /outside the workspace or inside ignored \.local/u,
      );
    }
    const external = path.join(parent, "runner-temp", "output");
    assert.equal(await validatedOutputDirectory(external, root), external);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("reused output directories cannot supply a stale passing test summary", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lumera-phase5-log-reuse-"));
  const file = path.join(directory, "suite.log");
  try {
    await writeFile(file, "ℹ tests 15\nℹ pass 15\nℹ fail 0\nℹ skipped 0\n");
    const writer = serialLogWriter(file);
    writer.write(Buffer.from("Current run has no summary.\n"));
    await writer.flush();
    assert.equal(await readFile(file, "utf8"), "Current run has no summary.\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Phase 5 runner selects every suite by default and accepts pnpm's separator", () => {
  assert.deepEqual(
    parsePhase5IntegrationOptions([]).suites.map((suite) => suite.id),
    phase5DisposableIntegrationSuites.map((suite) => suite.id),
  );
  assert.deepEqual(
    parsePhase5IntegrationOptions(["--", "--suite=supported-state"]).suites.map((suite) => suite.id),
    ["supported-state"],
  );
  assert.deepEqual(
    safeEnvironment(
      {
        DATABASE_URL: "postgres://extra.invalid/extra",
        LUMERA_DATABASE_URL: "postgres://extra.invalid/override",
      },
      {
        PATH: "/safe/bin",
        HOME: "/safe/home",
        DATABASE_URL: "postgres://ambient.invalid/ambient",
        LUMERA_DATABASE_URL: "postgres://ambient.invalid/override",
      },
    ),
    {
      PATH: "/safe/bin",
      HOME: "/safe/home",
      LANG: "C.UTF-8",
      NODE_ENV: "test",
      REPLIT_ENVIRONMENT: undefined,
      CI: "true",
    },
    "Phase 5 children must not inherit either runtime database target, even through extra environment.",
  );
});

test("Phase 5 runner rejects an invalid suite before any PostgreSQL operation", () => {
  assert.throws(
    () => parsePhase5IntegrationOptions(["--suite=not-a-suite"]),
    /Unknown --suite selection/u,
  );
});

test("production refusal occurs before output-directory creation", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "lumera-phase5-runner-test-"));
  const output = path.join(parent, "must-not-exist");
  try {
    await assert.rejects(
      () => runPhase5Integration([`--output-dir=${output}`], { NODE_ENV: "production" }),
      /refuses production or deployment runtimes/u,
    );
    await assert.rejects(() => access(output));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("deployment refusal is an in-memory guard", () => {
  for (const environment of [
    { REPLIT_DEPLOYMENT: "1" },
    { REPLIT_DEPLOYMENT: "true" },
    { REPL_DEPLOYMENT: "true" },
    { REPLIT_DEPLOYMENT_ID: "synthetic-deployment" },
    { REPL_DEPLOYMENT_ID: "synthetic-deployment" },
  ]) {
    assert.throws(
      () => assertSafeRuntime(environment),
      /refuses production or deployment runtimes/u,
    );
  }
  assert.doesNotThrow(() => assertSafeRuntime({
    NODE_ENV: "test",
    REPLIT_ENVIRONMENT: "production",
  }));
});