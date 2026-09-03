import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import {
  denyInternalRequestControlsInProduction,
  internalRequestControlHeaders,
} from "./internal-request-controls";

const INTERNAL_HEADER_NAME = /\bx-[a-z0-9-]*(?:test|testing|debug|diagnostic|observation|regression|qa|fault)[a-z0-9-]*\b/gi;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    return [absolute];
  }));
  return files.flat();
}

test("all test and diagnostic request headers are registered at the production boundary", async () => {
  const roots = [
    path.resolve(import.meta.dirname, ".."),
    path.resolve(import.meta.dirname, "../../../../lib/db/src"),
  ];
  const discovered = new Set<string>();

  for (const file of (await Promise.all(roots.map(sourceFiles))).flat()) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(INTERNAL_HEADER_NAME)) {
      discovered.add(match[0].toLowerCase());
    }
  }

  assert.deepEqual(
    [...discovered].sort(),
    [...internalRequestControlHeaders].sort(),
    "Every test/diagnostic x-* request header must be added to internalRequestControlHeaders",
  );
});

test("production and deployment runtimes deny every registered internal request control", () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    REPLIT_DEPLOYMENT: process.env.REPLIT_DEPLOYMENT,
    REPL_DEPLOYMENT: process.env.REPL_DEPLOYMENT,
  };

  try {
    for (const environment of [
      { NODE_ENV: "production" },
      { REPLIT_DEPLOYMENT: "1" },
      { REPL_DEPLOYMENT: "1" },
    ]) {
      delete process.env.NODE_ENV;
      delete process.env.REPLIT_DEPLOYMENT;
      delete process.env.REPL_DEPLOYMENT;
      Object.assign(process.env, environment);

      for (const header of internalRequestControlHeaders) {
        let statusCode: number | undefined;
        let body: unknown;
        let nextCalled = false;
        const req = {
          get: (name: string) => name === header ? "internal-control-value" : undefined,
        } as Request;
        const res = {
          status(code: number) {
            statusCode = code;
            return this;
          },
          json(value: unknown) {
            body = value;
            return this;
          },
        } as unknown as Response;
        const next = (() => {
          nextCalled = true;
        }) as NextFunction;

        denyInternalRequestControlsInProduction(req, res, next);
        assert.equal(statusCode, 404, `${header} must be denied in ${JSON.stringify(environment)}`);
        assert.deepEqual(body, { error: "Not found" });
        assert.equal(nextCalled, false);
      }
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("registered controls remain available to explicitly enabled non-production harnesses", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDeployment = process.env.REPLIT_DEPLOYMENT;
  const previousLegacyDeployment = process.env.REPL_DEPLOYMENT;
  try {
    process.env.NODE_ENV = "test";
    delete process.env.REPLIT_DEPLOYMENT;
    delete process.env.REPL_DEPLOYMENT;
    let nextCalled = false;
    const req = { get: () => "internal-control-value" } as unknown as Request;
    const res = {} as Response;
    denyInternalRequestControlsInProduction(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDeployment === undefined) delete process.env.REPLIT_DEPLOYMENT;
    else process.env.REPLIT_DEPLOYMENT = previousDeployment;
    if (previousLegacyDeployment === undefined) delete process.env.REPL_DEPLOYMENT;
    else process.env.REPL_DEPLOYMENT = previousLegacyDeployment;
  }
});