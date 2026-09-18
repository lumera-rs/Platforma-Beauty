import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertSafeRuntime,
  parsePhase5IntegrationOptions,
  runPhase5Integration,
  serialLogWriter,
} from "./run-phase5-integration";
import { phase5DisposableIntegrationSuites } from "./phase5-test-inventory";

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