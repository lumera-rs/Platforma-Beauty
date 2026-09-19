import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildHistoricalOperationMatrix } from "./historical-operation-matrix";
import { materializeHistoricalSourceFixture } from "./historical-source-fixture";

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const historicalFixtureDirectory = path.join(workspaceRoot, "scripts/fixtures/historical-operation-matrix");
const expectedArchiveSha256 = "174ebf6e31fd8f7c53ea5e1112518a2afd2d56e72c3762e796e139a8a43b90a3";

async function copyHistoricalFixture(destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  await Promise.all(
    ["manifest.json", "sources.json.gz"].map((file) =>
      copyFile(path.join(historicalFixtureDirectory, file), path.join(destination, file)),
    ),
  );
}

test("historical matrix is source-pinned and contains exactly 67 records", { timeout: 120_000 }, async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "lumera-historical-operations-"));
  const sourceRoot = path.join(fixtureRoot, "source");
  const archive = path.join(fixtureRoot, "operation-crosswalk.json");
  try {
    await materializeHistoricalSourceFixture(sourceRoot);
    await assert.rejects(access(path.join(sourceRoot, ".git")), /ENOENT/);
    assert.match(
      await readFile(path.join(sourceRoot, "scripts/src/startup-equivalence/crosswalk.ts"), "utf8"),
      /createHash/,
    );
    await symlink(path.join(workspaceRoot, "node_modules"), path.join(sourceRoot, "node_modules"), "dir");
    await symlink(path.join(workspaceRoot, "scripts/node_modules"), path.join(sourceRoot, "scripts/node_modules"), "dir");
    await execFileAsync(
      path.join(workspaceRoot, "scripts/node_modules/.bin/tsx"),
      [path.join(sourceRoot, "scripts/src/startup-equivalence/crosswalk.ts"), `--output=${archive}`],
      { cwd: sourceRoot, maxBuffer: 10 * 1024 * 1024 },
    );
    const archiveBytes = await readFile(archive);
    assert.equal(
      createHash("sha256").update(archiveBytes).digest("hex"),
      expectedArchiveSha256,
      "Repository-derived historical operation evidence changed.",
    );

    const matrix = buildHistoricalOperationMatrix(archive);
    assert.equal(matrix.archive.operationCount, 1569);
    assert.equal(matrix.archive.ownerCount, 8);
    assert.equal(matrix.archive.historicalBackfillCount, 67);
    assert.equal(matrix.records.length, 67);
    assert.equal(new Set(matrix.records.map((record) => record.id)).size, 67);
    assert.equal(matrix.canonicalMigration.sha256, "643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60");
    assert.ok(matrix.records.every((record) => record.source.exactSqlTemplate || record.source.completeSourceExcerpt));
    assert.ok(matrix.records.every((record) => record.affectedTables.length > 0));
    assert.ok(matrix.records.some((record) => record.disposition === "IMPLEMENTED_IN_000002"));
    assert.ok(matrix.records.some((record) => record.disposition === "EXPLICITLY_REFUSED"));
    assert.equal(matrix.records.filter((record) => record.source.exactSqlTemplate).length, 61);
    assert.equal(matrix.records.filter((record) => record.source.completeSourceExcerpt).length, 6);
    assert.deepEqual(
      matrix.records.reduce<Record<string, number>>((counts, record) => {
        counts[record.disposition] = (counts[record.disposition] ?? 0) + 1;
        return counts;
      }, {}),
      {
        REQUIRES_SEPARATE_REVIEWED_MIGRATION: 49,
        IMPLEMENTED_IN_000002: 10,
        EXPLICITLY_REFUSED: 8,
      },
    );
    assert.ok(matrix.records.every((record) => record.applicability.C_unknown_old_historical === "REFUSE"));
    assert.equal(matrix.runtimeOperations.length, 3);
    assert.deepEqual(
      matrix.runtimeOperations.map((operation) => operation.category).sort(),
      ["cleanup-report-read", "rollout-marker-read", "rollout-marker-write"],
    );
    assert.ok(matrix.runtimeOperations.every((operation) => operation.source.completeSourceExcerpt.length > 0));
    assert.ok(matrix.runtimeOperations.every((operation) => operation.consumerProof.length > 0));
    for (const path of ["A_fresh_canonical_empty", "B1_canonical_global_refs_no_tenants", "B2_post_002_ordinary_runtime"] as const) {
      assert.ok(matrix.records.every((record) => record.applicability[path] !== "REFUSE"));
    }
    assert.ok(matrix.records.every((record) => record.applicability.C_unknown_old_historical === "REFUSE"));
    assert.equal(matrix.supportedStateBoundary.globalEquivalence, "BLOCKED");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("historical source fixture rejects a corrupted payload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumera-historical-fixture-corrupt-"));
  try {
    const fixture = path.join(root, "fixture");
    await copyHistoricalFixture(fixture);
    const payloadPath = path.join(fixture, "sources.json.gz");
    const payload = await readFile(payloadPath);
    payload[Math.floor(payload.length / 2)] ^= 0xff;
    await writeFile(payloadPath, payload);
    await assert.rejects(
      materializeHistoricalSourceFixture(path.join(root, "destination"), fixture),
      /payload SHA-256/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("historical source fixture rejects manifest tampering before trusting fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumera-historical-fixture-manifest-"));
  try {
    const fixture = path.join(root, "fixture");
    await copyHistoricalFixture(fixture);
    const manifestPath = path.join(fixture, "manifest.json");
    await writeFile(manifestPath, Buffer.concat([await readFile(manifestPath), Buffer.from("\n")]));
    await assert.rejects(
      materializeHistoricalSourceFixture(path.join(root, "destination"), fixture),
      /manifest SHA-256/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("historical source fixture rejects a missing payload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumera-historical-fixture-missing-"));
  try {
    const fixture = path.join(root, "fixture");
    await mkdir(fixture);
    await copyFile(
      path.join(historicalFixtureDirectory, "manifest.json"),
      path.join(fixture, "manifest.json"),
    );
    await assert.rejects(
      materializeHistoricalSourceFixture(path.join(root, "destination"), fixture),
      /ENOENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("historical source fixture requires an empty owned destination", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumera-historical-fixture-owned-"));
  try {
    const destination = path.join(root, "destination");
    await mkdir(destination);
    await writeFile(path.join(destination, "sentinel"), "do not replace");
    await assert.rejects(
      materializeHistoricalSourceFixture(destination),
      /destination must be empty/,
    );
    assert.equal(await readFile(path.join(destination, "sentinel"), "utf8"), "do not replace");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("historical fixture CI runs with a shallow checkout, not archived Git history", async () => {
  const workflow = await readFile(path.join(workspaceRoot, ".github/workflows/ci.yml"), "utf8");
  const phase5Job = workflow
    .split("\n  phase5-migration-integration:\n")[1]
    ?.split(/\n  [a-z0-9-]+:\n/)[0];
  assert.ok(phase5Job, "The Phase 5 integration job must remain configured.");
  assert.match(phase5Job, /fetch-depth:\s*1\b/);
  assert.doesNotMatch(phase5Job, /fetch-depth:\s*0\b|git\s+(?:archive|fetch)/);
});
