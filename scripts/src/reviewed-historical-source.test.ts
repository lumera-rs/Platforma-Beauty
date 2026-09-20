import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { loadReviewedHistoricalSources, PINNED_REVIEWED_EVIDENCE_COMMIT } from "./reviewed-historical-source";
import { prepareCiReviewedHistory } from "./prepare-ci-reviewed-history";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], {
  env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  stdio: ["pipe", "pipe", "pipe"],
}).toString().trim();

test("missing historical object fails closed even with current working-tree sources", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "missing-reviewed-history-"));
  try {
    git(temporary, "init", "--quiet");
    const file = "artifacts/api-server/src/index.ts";
    mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true });
    writeFileSync(path.join(temporary, file), readFileSync(path.join(root, file)));
    assert.throws(() => loadReviewedHistoricalSources(temporary), /Command failed/);
    assert.throws(() => prepareCiReviewedHistory(temporary), /Command failed/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("shallow checkout fetches the exact reviewed pin and authenticates every source", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "shallow-reviewed-history-"));
  try {
    const clone = path.join(temporary, "checkout");
    git(root, "clone", "--quiet", "--no-checkout", "--depth=1", pathToFileURL(root).href, clone);
    assert.equal(git(clone, "rev-parse", "--is-shallow-repository"), "true");
    // A pin already at HEAD is also valid; reconstruction normally has a later HEAD.
    const head = git(clone, "rev-parse", "HEAD");
    if (head !== PINNED_REVIEWED_EVIDENCE_COMMIT) {
      assert.throws(() => loadReviewedHistoricalSources(clone), /Command failed/);
    }
    prepareCiReviewedHistory(clone);
    assert.deepEqual(loadReviewedHistoricalSources(clone), loadReviewedHistoricalSources(root));
    const poisoned = loadReviewedHistoricalSources(clone);
    poisoned.clear();
    assert.ok(loadReviewedHistoricalSources(clone).size > 0);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("history suites stay in existing CI jobs, outside production publish checks", () => {
  const scripts = JSON.parse(readFileSync(path.join(root, "scripts/package.json"), "utf8")).scripts;
  assert.doesNotMatch(scripts["test:backend-standards:static"], /test:startup-migration-crosswalk|reviewed-history|reconstruction:non-db/);
  assert.match(scripts["test:reconstruction:non-db"], /startup-migration-crosswalk\.test\.ts/);
  assert.doesNotMatch(scripts["test:reconstruction:non-db"], /test-name-pattern/);
  const workflow = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.equal(workflow.match(/run validate:ci:reviewed-history/g)?.length, 2);
  assert.match(workflow, /run test:reconstruction:non-db/);
  assert.match(workflow, /run validate:ci:startup-ddl-removal-gate/);
});