/**
 * Deterministic unit tests — no network, no database, no real process.exit.
 *
 * Covers:
 *   1. slow-request middleware: fires exactly one event with the correct
 *      structured payload; query values, cookies, auth headers are absent.
 *   2. apiErrorHandler generic-500 contract.
 *   3. registerFatalHandlers: unhandledRejection and uncaughtException each
 *      invoke fatal logging + cleanup + exit(1) exactly once (once semantics).
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { makeSlowRequestMiddleware, safePathname } from "../app";
import { apiErrorHandler } from "./api-errors";
import { registerFatalHandlers, runFatalShutdown } from "./process-lifecycle";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockRes(opts: { headersSent?: boolean } = {}): Response {
  let statusCode = 200;
  let body: unknown;
  const listeners: Record<string, Array<() => void>> = {};

  const res = {
    get statusCode() { return statusCode; },
    set statusCode(v: number) { statusCode = v; },
    get body() { return body; },
    headersSent: opts.headersSent ?? false,
    status(code: number) {
      statusCode = code;
      return { json(b: unknown) { body = b; } };
    },
    json(b: unknown) { body = b; },
    end() { /* no-op */ },
    on(event: string, cb: () => void) {
      listeners[event] ??= [];
      listeners[event]!.push(cb);
      return res;
    },
    once(event: string, cb: () => void) {
      const once = () => {
        listeners[event] = (listeners[event] ?? []).filter((listener) => listener !== once);
        cb();
      };
      listeners[event] ??= [];
      listeners[event]!.push(once);
      return res;
    },
    /** Trigger the finish event from test code. */
    _finish() {
      for (const cb of listeners["finish"] ?? []) cb();
    },
  } as unknown as Response & { _finish(): void; body: unknown };

  return res;
}

function makeMockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    id: "req-test-id",
    method: "GET",
    url: "/api/test?secret=abc&token=xyz",
    headers: {
      authorization: "Bearer supersecret",
      cookie: "session=abc123",
    },
    log: {
      error: () => { /* suppress */ },
      warn:  () => { /* suppress */ },
    },
    ...overrides,
  } as unknown as Request;
}

// ---------------------------------------------------------------------------
// 1. Slow-request middleware
// ---------------------------------------------------------------------------

function testSlowRequestMiddlewareFiringAndPayload(): void {
  const captured: unknown[] = [];
  const fakeLogger = {
    warn(obj: unknown, _msg?: string) { captured.push(obj); },
  } as unknown as typeof import("../lib/logger").logger;

  // Threshold of 0 ensures every request is "slow" so the event always fires.
  const middleware = makeSlowRequestMiddleware(0, fakeLogger);

  const req = makeMockReq();
  const res = makeMockRes() as Response & { _finish(): void };
  const nextCalled: boolean[] = [];
  const next: NextFunction = () => { nextCalled.push(true); };

  middleware(req, res, next);

  // next() must be called so the request chain continues
  assert.equal(nextCalled.length, 1, "next() must be called exactly once");

  // No event yet — finish has not fired
  assert.equal(captured.length, 0, "no event before finish");

  // Simulate response completion
  (res as unknown as { _finish(): void })._finish();

  // Exactly one event emitted
  assert.equal(captured.length, 1, "exactly one slow_request event must be emitted");

  const event = captured[0] as Record<string, unknown>;

  // Required fields present
  assert.equal(event["event"], "slow_request");
  assert.equal(event["requestId"], "req-test-id");
  assert.equal(event["method"], "GET");
  assert.equal(event["statusCode"], 200);
  assert.ok(typeof event["durationMs"] === "number" && event["durationMs"] >= 0, "durationMs must be a non-negative number");

  // Pathname must have query string stripped
  assert.equal(event["pathname"], "/api/test", "pathname must not include query string");
  assert.ok(
    !String(event["pathname"]).includes("secret"),
    "query param value 'secret' must not appear in pathname",
  );
  assert.ok(
    !String(event["pathname"]).includes("abc"),
    "query param value 'abc' must not appear in pathname",
  );

  // Sensitive fields must be absent from the log payload entirely
  const serialized = JSON.stringify(event);
  assert.ok(!serialized.includes("supersecret"), "auth header must not appear in log");
  assert.ok(!serialized.includes("session=abc123"), "cookie value must not appear in log");
  assert.ok(!serialized.includes("Bearer"), "auth scheme must not appear in log");
  assert.ok(!serialized.includes("token=xyz"), "query token value must not appear in log");

  console.log("✓ slow-request middleware: payload correctness and secret sanitization");
}

function testSlowRequestMiddlewareNotFiredBelowThreshold(): void {
  const captured: unknown[] = [];
  const fakeLogger = {
    warn(obj: unknown) { captured.push(obj); },
  } as unknown as typeof import("../lib/logger").logger;

  // Very high threshold — no real request will exceed it in a sync test
  const middleware = makeSlowRequestMiddleware(999_999, fakeLogger);

  const req = makeMockReq();
  const res = makeMockRes() as Response & { _finish(): void };
  const next: NextFunction = () => { /* no-op */ };

  middleware(req, res, next);
  (res as unknown as { _finish(): void })._finish();

  assert.equal(captured.length, 0, "no event must be emitted below threshold");

  console.log("✓ slow-request middleware: no event below threshold");
}

function testSlowRequestFinishFiresOnlyOnce(): void {
  // Guard: multiple finish events must not produce duplicate log entries.
  const captured: unknown[] = [];
  const fakeLogger = {
    warn(obj: unknown) { captured.push(obj); },
  } as unknown as typeof import("../lib/logger").logger;

  const middleware = makeSlowRequestMiddleware(0, fakeLogger);
  const req = makeMockReq();
  const res = makeMockRes() as Response & { _finish(): void };
  middleware(req, res, () => { /* no-op */ });

  (res as unknown as { _finish(): void })._finish();
  (res as unknown as { _finish(): void })._finish(); // second finish — should not re-fire

  assert.equal(captured.length, 1, "finish listener must emit exactly one event");

  console.log("✓ slow-request middleware: finish-event guard");
}

// ---------------------------------------------------------------------------
// 2. apiErrorHandler – generic 500 and headers-sent guard
// ---------------------------------------------------------------------------

function testGeneric500Contract(): void {
  const req = makeMockReq();
  const res = makeMockRes();
  const next: NextFunction = () => { /* no-op */ };

  apiErrorHandler(new Error("internal details must not leak"), req, res, next);

  assert.equal((res as unknown as { statusCode: number }).statusCode, 500);
  const body = (res as unknown as { body: unknown }).body as { error: string; code: string };
  assert.ok(body, "body must be set");
  assert.equal(typeof body.error, "string");
  assert.equal(body.code, "INTERNAL_ERROR");
  assert.ok(!body.error.includes("internal details must not leak"), "error message must not leak to client");

  console.log("✓ apiErrorHandler: generic 500 contract");
}

function testHeadersSentGuard(): void {
  const req = makeMockReq();
  const res = makeMockRes({ headersSent: true });
  let endCalled = false;
  (res as unknown as { end(): void }).end = () => { endCalled = true; };
  const next: NextFunction = () => { /* no-op */ };

  apiErrorHandler(new Error("late"), req, res, next);

  assert.equal((res as unknown as { statusCode: number }).statusCode, 200, "must not change statusCode after headers sent");
  assert.equal(endCalled, true, "res.end() must be called");

  console.log("✓ apiErrorHandler: headers-sent guard");
}

// ---------------------------------------------------------------------------
// 3. registerFatalHandlers – fake-process deterministic tests
// ---------------------------------------------------------------------------

function makeTestDeps() {
  const fakeProc = new EventEmitter() as NodeJS.EventEmitter & {
    once(event: string, listener: (...args: unknown[]) => void): NodeJS.EventEmitter;
  };

  const calls = {
    fatalMessages: [] as string[],
    flushCalled: 0,
    cleanupCalled: 0,
    exitCodes: [] as number[],
  };

  const fakeLogger = {
    fatal(_obj: unknown, msg: string) { calls.fatalMessages.push(msg); },
    flush(cb?: (err?: Error) => void) {
      calls.flushCalled += 1;
      // Invoke callback synchronously (simulates immediate flush)
      cb?.();
    },
  } as unknown as import("pino").Logger;

  const cleanup = () => { calls.cleanupCalled += 1; };
  const exit = (code: number): never => {
    calls.exitCodes.push(code);
    return undefined as never; // don't actually exit
  };

  return { fakeProc, fakeLogger, cleanup, exit, calls };
}

async function testUnhandledRejectionInvokesFatalAndExits1(): Promise<void> {
  const { fakeProc, fakeLogger, cleanup, exit, calls } = makeTestDeps();

  registerFatalHandlers({ logger: fakeLogger, cleanup, exit, proc: fakeProc });

  const reason = new Error("rejected promise");
  fakeProc.emit("unhandledRejection", reason);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.fatalMessages.length, 1, "exactly one fatal log");
  assert.ok(calls.fatalMessages[0]!.includes("Unhandled promise rejection"), "fatal message must describe rejection");
  assert.equal(calls.cleanupCalled, 1, "cleanup must be called once");
  assert.equal(calls.flushCalled, 1, "flush must be called once");
  assert.deepEqual(calls.exitCodes, [1], "must exit with code 1");

  console.log("✓ registerFatalHandlers: unhandledRejection → fatal + exit(1)");
}

async function testUncaughtExceptionInvokesFatalAndExits1(): Promise<void> {
  const { fakeProc, fakeLogger, cleanup, exit, calls } = makeTestDeps();

  registerFatalHandlers({ logger: fakeLogger, cleanup, exit, proc: fakeProc });

  const error = new Error("uncaught exception");
  fakeProc.emit("uncaughtException", error);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.fatalMessages.length, 1, "exactly one fatal log");
  assert.ok(calls.fatalMessages[0]!.includes("Uncaught exception"), "fatal message must describe exception");
  assert.equal(calls.cleanupCalled, 1, "cleanup must be called once");
  assert.equal(calls.flushCalled, 1, "flush must be called once");
  assert.deepEqual(calls.exitCodes, [1], "must exit with code 1");

  console.log("✓ registerFatalHandlers: uncaughtException → fatal + exit(1)");
}

async function testFatalHandlerFiresOnlyOnce(): Promise<void> {
  // Both events emitted: only the first must be handled (once semantics).
  const { fakeProc, fakeLogger, cleanup, exit, calls } = makeTestDeps();

  registerFatalHandlers({ logger: fakeLogger, cleanup, exit, proc: fakeProc });

  fakeProc.emit("unhandledRejection", new Error("first"));
  fakeProc.emit("uncaughtException", new Error("second — must be ignored"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.fatalMessages.length, 1, "only first fatal event must be logged");
  assert.equal(calls.cleanupCalled, 1, "cleanup must be called exactly once");
  assert.equal(calls.exitCodes.length, 1, "exit must be called exactly once");

  console.log("✓ registerFatalHandlers: once semantics — only first event handled");
}

function testDeregisterRemovesListeners(): void {
  const { fakeProc, fakeLogger, cleanup, exit, calls } = makeTestDeps();

  const { deregister } = registerFatalHandlers({ logger: fakeLogger, cleanup, exit, proc: fakeProc });
  deregister();

  fakeProc.emit("unhandledRejection", new Error("should be ignored"));
  fakeProc.emit("uncaughtException", new Error("should be ignored"));

  assert.equal(calls.fatalMessages.length, 0, "no fatal log after deregister");
  assert.equal(calls.exitCodes.length, 0, "no exit after deregister");

  console.log("✓ registerFatalHandlers: deregister removes listeners");
}

async function testFlushCalledBeforeExit(): Promise<void> {
  // Verify that exit is NOT called before flush callback completes.
  const { fakeProc, fakeLogger, cleanup, exit, calls } = makeTestDeps();

  let flushCallbackCaptured: ((err?: Error) => void) | undefined;
  (fakeLogger as unknown as {
    flush(cb?: (err?: Error) => void): void;
  }).flush = (cb?: (err?: Error) => void) => {
    calls.flushCalled += 1;
    // Capture the callback but do NOT invoke it yet
    flushCallbackCaptured = cb;
  };

  let cleanupComplete = false;
  let finishCleanup: (() => void) | undefined;
  const cleanupPromise = new Promise<void>((resolve) => {
    finishCleanup = () => {
      cleanupComplete = true;
      resolve();
    };
  });
  const shutdown = runFatalShutdown({
    logger: fakeLogger,
    cleanup: () => cleanupPromise,
    exit,
    reason: "test fatal",
    error: new Error("test"),
  });

  // Neither flush nor exit can happen before asynchronous cleanup completes.
  assert.equal(calls.exitCodes.length, 0, "exit must not be called before flush completes");
  assert.equal(calls.flushCalled, 0, "flush must wait for cleanup");
  finishCleanup?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleanupComplete, true);
  assert.equal(calls.flushCalled, 1, "flush must start after cleanup");
  assert.equal(calls.exitCodes.length, 0, "exit must still wait for flush callback");

  // Now complete the flush
  flushCallbackCaptured?.();
  await shutdown;
  assert.deepEqual(calls.exitCodes, [1], "exit must be called after flush completes");

  console.log("✓ registerFatalHandlers: exit deferred until flush callback");
}

// ---------------------------------------------------------------------------
// safePathname edge cases (retained for completeness)
// ---------------------------------------------------------------------------

function testSafePathname(): void {
  assert.equal(safePathname("/api/appointments?date=2024-01-01&user=secret"), "/api/appointments");
  assert.equal(safePathname("/api/salons/123"), "/api/salons/123");
  assert.equal(safePathname(""), "/");
  assert.equal(safePathname(undefined), "/");
  assert.equal(safePathname("/?x=leak"), "/");
  assert.equal(safePathname("/path?"), "/path");

  console.log("✓ safePathname edge cases");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  testSafePathname();

  testSlowRequestMiddlewareFiringAndPayload();
  testSlowRequestMiddlewareNotFiredBelowThreshold();
  testSlowRequestFinishFiresOnlyOnce();

  testGeneric500Contract();
  testHeadersSentGuard();

  await testUnhandledRejectionInvokesFatalAndExits1();
  await testUncaughtExceptionInvokesFatalAndExits1();
  await testFatalHandlerFiresOnlyOnce();
  testDeregisterRemovesListeners();
  await testFlushCalledBeforeExit();

  console.log("\nAll monitoring tests passed.");
}

await run();
