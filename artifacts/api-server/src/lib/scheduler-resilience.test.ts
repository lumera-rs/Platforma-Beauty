import assert from "node:assert/strict";
import {
  createResilientScheduledJob,
  isTransientDatabaseFailure,
  schedulerFailureDiagnostics,
  schedulerDatabaseCapacitySnapshot,
  SCHEDULER_DATABASE_ACTIVITY_LIMIT,
  type SchedulerTimer,
  withSchedulerDatabaseActivity,
  withSchedulerDependency,
} from "./scheduler-resilience";

type ScheduledTimer = { callback: () => void; delayMs: number; cleared: boolean };

function createFakeTimer(start = "2026-08-23T12:00:00.000Z"): {
  timer: SchedulerTimer;
  scheduled: ScheduledTimer[];
  advance: (ms: number) => void;
} {
  let now = new Date(start);
  const scheduled: ScheduledTimer[] = [];
  return {
    timer: {
      now: () => new Date(now),
      setTimeout: (callback, delayMs) => {
        const item = { callback, delayMs, cleared: false };
        scheduled.push(item);
        return item as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (handle) => {
        (handle as unknown as ScheduledTimer).cleared = true;
      },
    },
    scheduled,
    advance: (ms) => { now = new Date(now.getTime() + ms); },
  };
}

async function run(): Promise<void> {
  {
    const releases: Array<() => void> = [];
    const activities = Array.from(
      { length: SCHEDULER_DATABASE_ACTIVITY_LIMIT + 1 },
      () => withSchedulerDatabaseActivity(
        () => new Promise<void>((resolve) => { releases.push(resolve); }),
      ),
    );
    while (releases.length < SCHEDULER_DATABASE_ACTIVITY_LIMIT) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.deepEqual(schedulerDatabaseCapacitySnapshot(), {
      active: SCHEDULER_DATABASE_ACTIVITY_LIMIT,
      limit: SCHEDULER_DATABASE_ACTIVITY_LIMIT,
      queued: 1,
    }, "scheduler capacity snapshot must expose queued work separately from job failures");

    releases[0]?.();
    while (releases.length < SCHEDULER_DATABASE_ACTIVITY_LIMIT + 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(schedulerDatabaseCapacitySnapshot().queued, 0);
    releases.slice(1).forEach((release) => release());
    await Promise.all(activities);
    assert.equal(schedulerDatabaseCapacitySnapshot().active, 0);
  }

  assert.equal(isTransientDatabaseFailure(Object.assign(new Error("connection timed out"), { code: "08006" })), true);
  assert.equal(isTransientDatabaseFailure(Object.assign(new Error("socket reset"), { code: "ECONNRESET" })), true);
  assert.equal(isTransientDatabaseFailure(Object.assign(new Error("missing relation"), { code: "42P01" })), false);
  {
    const source = Object.assign(new Error("relation secret_table does not exist"), { code: "42P01" });
    await assert.rejects(
      () => withSchedulerDependency("education-gallery-candidates", async () => { throw source; }),
      (error) => {
        assert.deepEqual(schedulerFailureDiagnostics(error), {
          dependency: "education-gallery-candidates",
          errorCode: "42P01",
          errorType: "SchedulerDependencyError",
          causeType: "Error",
        });
        return true;
      },
    );
  }
  {
    const source = new Error("connection timed out");
    let wrappedFailure: unknown;
    await assert.rejects(
      () => withSchedulerDependency("delivery-report-statuses", async () => { throw source; }),
      (error) => {
        wrappedFailure = error;
        assert.deepEqual(schedulerFailureDiagnostics(error), {
          dependency: "delivery-report-statuses",
          errorCode: "unknown",
          errorType: "SchedulerDependencyError",
          causeType: "Error",
        });
        return true;
      },
    );
    assert.equal(
      isTransientDatabaseFailure(wrappedFailure),
      true,
      "a wrapper must preserve message-only transient classification from its cause",
    );

    const fake = createFakeTimer();
    const job = createResilientScheduledJob({
      job: "delivery-report-status-timeout",
      run: () => withSchedulerDependency("delivery-report-statuses", async () => { throw source; }),
      timer: fake.timer,
      random: () => 0.5,
    });
    await job.run();
    assert.equal(job.snapshot().state, "retrying");
    assert.equal(job.snapshot().lastFailureClass, "transient_database");
    assert.equal(fake.scheduled.length, 1, "wrapped status timeouts retain bounded retry behavior");
  }

  {
    const fake = createFakeTimer();
    let calls = 0;
    const job = createResilientScheduledJob({
      job: "timeout-recovery",
      run: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("connection timed out"), { code: "08006" });
      },
      timer: fake.timer,
      random: () => 0.5,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 8_000,
    });

    await job.run();
    assert.equal(calls, 1);
    assert.equal(fake.scheduled.length, 1);
    assert.equal(fake.scheduled[0]?.delayMs, 1_000);
    assert.equal(job.snapshot().state, "retrying");
    assert.equal(job.snapshot().deferredCycles, 1);

    await job.run();
    assert.equal(calls, 1, "a normal tick must not fan out while retry is pending");
    assert.equal(job.snapshot().deferredCycles, 2);

    fake.advance(1_000);
    fake.scheduled[0]?.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 2);
    assert.deepEqual(job.snapshot(), {
      job: "timeout-recovery",
      state: "idle",
      lastStartedAt: "2026-08-23T12:00:01.000Z",
      lastSucceededAt: "2026-08-23T12:00:01.000Z",
      lastFailedAt: "2026-08-23T12:00:00.000Z",
      lastFailureClass: null,
      consecutiveFailures: 0,
      deferredCycles: 0,
      nextRetryAt: null,
    });
  }

  {
    const fake = createFakeTimer();
    let resolveRun: (() => void) | undefined;
    let calls = 0;
    const job = createResilientScheduledJob({
      job: "single-flight",
      run: async () => {
        calls += 1;
        await new Promise<void>((resolve) => { resolveRun = resolve; });
      },
      timer: fake.timer,
    });
    const firstRun = job.run();
    await new Promise((resolve) => setImmediate(resolve));
    await job.run();
    assert.equal(calls, 1);
    assert.equal(job.snapshot().deferredCycles, 1);
    resolveRun?.();
    await firstRun;
    assert.equal(job.snapshot().state, "idle");
  }

  {
    const fake = createFakeTimer();
    const job = createResilientScheduledJob({
      job: "permanent-error",
      run: async () => { throw Object.assign(new Error("missing relation"), { code: "42P01" }); },
      timer: fake.timer,
      random: () => 0.5,
    });
    await job.run();
    assert.equal(fake.scheduled.length, 0, "permanent failures must not hot-loop");
    assert.equal(job.snapshot().state, "failed");
    assert.equal(job.snapshot().lastFailureClass, "permanent");
  }

  {
    const fake = createFakeTimer();
    let calls = 0;
    const job = createResilientScheduledJob({
      job: "bounded-retries",
      run: async () => {
        calls += 1;
        throw Object.assign(new Error("database connection terminated"), { code: "57P01" });
      },
      timer: fake.timer,
      random: () => 0.5,
      maxRetryAttempts: 2,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 8_000,
    });
    await job.run();
    assert.equal(fake.scheduled[0]?.delayMs, 1_000);
    fake.advance(1_000);
    fake.scheduled[0]?.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fake.scheduled[1]?.delayMs, 2_000);
    fake.advance(2_000);
    fake.scheduled[1]?.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 3);
    assert.equal(fake.scheduled.length, 2, "retry attempts must be capped");
    assert.equal(job.snapshot().state, "failed");
    assert.equal(job.snapshot().consecutiveFailures, 3);

    await job.run();
    assert.equal(
      fake.scheduled.length,
      3,
      "a later normal cycle must start a new bounded retry window after an exhausted outage",
    );
  }

  {
    const fake = createFakeTimer();
    let calls = 0;
    const job = createResilientScheduledJob({
      job: "shutdown-cancels-retry",
      run: async () => {
        calls += 1;
        throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
      },
      timer: fake.timer,
      random: () => 0.5,
    });
    await job.run();
    const pending = fake.scheduled[0];
    assert.ok(pending);
    job.stop();
    assert.equal(pending.cleared, true);
    pending.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1, "stopped jobs must not execute their pending retry");
  }

  console.log("✓ scheduler resilience: timeout recovery, single-flight, permanent failure, and shutdown");
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});