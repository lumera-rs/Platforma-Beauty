import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { slowApiMonitor } from "../app";
import { apiErrorHandler } from "./api-errors";
import { SLOW_API_THRESHOLD_MS } from "./logger";

type LogRecord = { payload: Record<string, unknown>; message: string };

function makeFakeRequest(overrides: Partial<Request> = {}): {
  req: Request;
  logs: { warn: LogRecord[]; error: LogRecord[] };
} {
  const logs = { warn: [] as LogRecord[], error: [] as LogRecord[] };
  const log = {
    warn: (payload: Record<string, unknown>, message: string) => {
      logs.warn.push({ payload, message });
    },
    error: (payload: Record<string, unknown>, message: string) => {
      logs.error.push({ payload, message });
    },
  };
  const req = {
    id: "req-test-1",
    method: "GET",
    path: "/api/things",
    originalUrl: "/api/things?secret=shhh&token=abc",
    log,
    ...overrides,
  } as unknown as Request;
  return { req, logs };
}

function makeFakeResponse(statusCode: number): Response & EventEmitter {
  const res = new EventEmitter() as Response & EventEmitter;
  res.statusCode = statusCode;
  return res;
}

test("slow-api event is emitted only for requests at or above the threshold", () => {
  const { req, logs } = makeFakeRequest();
  const res = makeFakeResponse(200);

  // Freeze the clock so the measured duration is deterministic and above the
  // threshold without waiting in real time.
  const realHrtime = process.hrtime.bigint;
  let now = 0n;
  process.hrtime.bigint = (() => now) as typeof process.hrtime.bigint;
  try {
    let nextCalled = false;
    slowApiMonitor(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);
    assert.equal(nextCalled, true, "middleware must always call next()");

    now = BigInt(SLOW_API_THRESHOLD_MS) * 1_000_000n; // exactly threshold ms
    res.emit("finish");
  } finally {
    process.hrtime.bigint = realHrtime;
  }

  assert.equal(logs.warn.length, 1, "one slow-api event expected at threshold");
  const record = logs.warn[0];
  assert.ok(record);
  assert.equal(record.message, "slow-api");
  assert.equal(record.payload.event, "slow-api");
  assert.equal(record.payload.reqId, "req-test-1");
  assert.equal(record.payload.method, "GET");
  assert.equal(record.payload.statusCode, 200);
  assert.equal(record.payload.durationMs, SLOW_API_THRESHOLD_MS);
});

test("slow-api pathname strips the query string and no sensitive fields leak", () => {
  const { req, logs } = makeFakeRequest();
  const res = makeFakeResponse(500);

  const realHrtime = process.hrtime.bigint;
  let now = 0n;
  process.hrtime.bigint = (() => now) as typeof process.hrtime.bigint;
  try {
    slowApiMonitor(req, res, (() => undefined) as NextFunction);
    now = BigInt(SLOW_API_THRESHOLD_MS + 500) * 1_000_000n;
    res.emit("finish");
  } finally {
    process.hrtime.bigint = realHrtime;
  }

  const record = logs.warn[0];
  assert.ok(record);
  assert.equal(record.payload.pathname, "/api/things", "query string must be stripped");

  const serialized = JSON.stringify(record.payload);
  assert.ok(!serialized.includes("secret"), "raw query values must not leak");
  assert.ok(!serialized.includes("token"), "raw query values must not leak");

  const allowedKeys = ["event", "reqId", "method", "pathname", "statusCode", "durationMs"];
  assert.deepEqual(Object.keys(record.payload).sort(), [...allowedKeys].sort());
});

test("fast requests below the threshold emit no slow-api event", () => {
  const { req, logs } = makeFakeRequest();
  const res = makeFakeResponse(200);

  const realHrtime = process.hrtime.bigint;
  let now = 0n;
  process.hrtime.bigint = (() => now) as typeof process.hrtime.bigint;
  try {
    slowApiMonitor(req, res, (() => undefined) as NextFunction);
    now = BigInt(SLOW_API_THRESHOLD_MS - 1) * 1_000_000n;
    res.emit("finish");
  } finally {
    process.hrtime.bigint = realHrtime;
  }

  assert.equal(logs.warn.length, 0, "no slow-api event expected below the threshold");
});

test("unexpected errors return a safe generic 500 without leaking detail", () => {
  const { req, logs } = makeFakeRequest();

  let statusCode = 0;
  let body: unknown;
  const res = {
    headersSent: false,
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  const leakyError = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"), {
    stack: "sensitive stack with password=hunter2",
  });

  apiErrorHandler(leakyError, req, res, (() => undefined) as NextFunction);

  assert.equal(statusCode, 500);
  assert.deepEqual(body, {
    error: "Došlo je do neočekivane greške. Pokušajte ponovo.",
    code: "INTERNAL_ERROR",
  });

  const serializedBody = JSON.stringify(body);
  assert.ok(!serializedBody.includes("ECONNREFUSED"), "raw provider error must not reach the client");
  assert.ok(!serializedBody.includes("hunter2"), "credentials must not reach the client");

  // The failure is still logged server-side for observability.
  assert.equal(logs.error.length, 1);
  assert.equal(logs.error[0]?.message, "Unhandled API request error");
});
