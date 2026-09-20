import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import { loadReviewedHistoricalSources, PINNED_REVIEWED_EVIDENCE_COMMIT } from "./reviewed-historical-source";

// CI-only preparation, never imported by application startup or publish checks.
export function prepareCiReviewedHistory(root: string): void {
  assertDestructiveTestRuntimeAllowed(process.env, "CI historical source preparation");
  const ensureCommit = (commit: string): void => {
    const probe = spawnSync("git", ["-C", root, "cat-file", "-e", `${commit}^{commit}`]);
    if (probe.status !== 0) {
      // Fetch each declared object through checkout's configured origin auth.
      // A denied/unavailable pin is a hard failure, not a working-tree fallback.
      execFileSync("git", ["-C", root, "fetch", "--no-tags", "--depth=1", "origin", commit], {
        stdio: "pipe",
      });
    }
  };
  ensureCommit(PINNED_REVIEWED_EVIDENCE_COMMIT);
  // Read the checkout's committed manifest, including in no-checkout fixtures.
  const censusManifest = JSON.parse(execFileSync("git", [
    "-C", root, "show", "HEAD:docs/additional-operations-evidence/census.json",
  ], { encoding: "utf8", stdio: "pipe" })) as {
    sourceArtifact?: { repositoryCommit?: unknown };
  };
  const censusCommit = censusManifest?.sourceArtifact?.repositoryCommit;
  if (typeof censusCommit !== "string" || !/^[0-9a-f]{40}$/.test(censusCommit)) {
    throw new Error("Census source artifact must declare a full repository commit");
  }
  ensureCommit(censusCommit);
  const sources = loadReviewedHistoricalSources(root);
  console.log(`Authenticated ${sources.size} reviewed sources at ${PINNED_REVIEWED_EVIDENCE_COMMIT}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareCiReviewedHistory(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
}