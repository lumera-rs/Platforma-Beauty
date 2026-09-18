import assert from "node:assert/strict";
import test from "node:test";
import { reconcileKnownTestListings } from "./test-listing-reconciliation";

test("production reconciliation is a deterministic no-op", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let calls = 0;
  process.env.NODE_ENV = "production";

  try {
    await reconcileKnownTestListings(async () => {
      calls += 1;
      throw new Error("production must not reach legacy reconciliation");
    });
    assert.equal(calls, 0);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test("development and test retain explicit legacy reconciliation", async () => {
  const originalNodeEnv = process.env.NODE_ENV;

  try {
    for (const nodeEnv of ["development", "test"]) {
      let calls = 0;
      process.env.NODE_ENV = nodeEnv;
      await reconcileKnownTestListings(async () => {
        calls += 1;
        return { beautyJobsMarked: 1, coursesMarked: 2 };
      });
      assert.equal(calls, 1, `${nodeEnv} must retain explicit reconciliation`);
    }
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});