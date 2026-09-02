import assert from "node:assert/strict";
import { runEducationGalleryCleanup } from "../routes/marketplace";
import {
  createResilientScheduledJob,
  schedulerFailureDiagnostics,
} from "./scheduler-resilience";

async function run(): Promise<void> {
  const sourceFailure = Object.assign(
    new Error("column cleanup_failure_count does not exist"),
    { code: "42703" },
  );
  const loadCandidates = async () => {
    throw sourceFailure;
  };

  await assert.rejects(
    () => runEducationGalleryCleanup({ loadCandidates }),
    (error) => {
      assert.deepEqual(schedulerFailureDiagnostics(error), {
        dependency: "education-gallery-candidates",
        errorCode: "42703",
        errorType: "SchedulerDependencyError",
        causeType: "Error",
      });
      return true;
    },
  );

  const job = createResilientScheduledJob({
    job: "education-gallery-cleanup-controlled-query-failure",
    run: () => runEducationGalleryCleanup({ loadCandidates }),
  });
  await job.run();
  assert.equal(job.snapshot().state, "failed");
  assert.equal(job.snapshot().lastFailureClass, "permanent");
  assert.equal(job.snapshot().consecutiveFailures, 1);

  console.log("✓ education gallery candidate-query failures retain safe diagnostics and permanent classification");
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});