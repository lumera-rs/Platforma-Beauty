import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import {
  catalogCacheKey,
  catalogCacheStats,
  invalidateCatalogCache,
  readThroughCatalogCache,
  startCatalogCacheInvalidationListener,
  stopCatalogCacheInvalidationListener,
} from "./catalog-cache";

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function runChildInvalidator(namespace: string): Promise<void> {
  const supportFile = fileURLToPath(new URL("./catalog-cache-invalidator.test-support.ts", import.meta.url));
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", [
      "--filter",
      "@workspace/scripts",
      "exec",
      "tsx",
      supportFile,
      namespace,
    ], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Cross-process cache invalidator exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function run(): Promise<void> {
  const suffix = randomUUID();

  let cachedLoads = 0;
  const cachedKey = catalogCacheKey("brands", `cached-${suffix}`);
  const cachedLoader = async () => ({ version: ++cachedLoads });
  const first = await readThroughCatalogCache(cachedKey, cachedLoader);
  const second = await readThroughCatalogCache(cachedKey, cachedLoader);
  assert.deepEqual(second, first, "a warm cache entry must avoid a second loader call");
  assert.equal(cachedLoads, 1);

  let coalescedLoads = 0;
  const coalescedKey = catalogCacheKey("service-templates", `coalesced-${suffix}`);
  const coalescedLoader = async () => {
    coalescedLoads += 1;
    await pause(30);
    return coalescedLoads;
  };
  const coalesced = await Promise.all([
    readThroughCatalogCache(coalescedKey, coalescedLoader),
    readThroughCatalogCache(coalescedKey, coalescedLoader),
    readThroughCatalogCache(coalescedKey, coalescedLoader),
  ]);
  assert.deepEqual(coalesced, [1, 1, 1], "parallel misses for one key must share one loader");
  assert.equal(coalescedLoads, 1);

  let ttlLoads = 0;
  const ttlKey = catalogCacheKey("education-categories", `ttl-${suffix}`);
  await readThroughCatalogCache(ttlKey, async () => ++ttlLoads, 10);
  await pause(25);
  await readThroughCatalogCache(ttlKey, async () => ++ttlLoads, 10);
  assert.equal(ttlLoads, 2, "an expired cache entry must be refreshed");

  await invalidateCatalogCache("brands");
  const refreshed = await readThroughCatalogCache(cachedKey, cachedLoader);
  assert.equal(refreshed.version, 2, "same-process invalidation must evict the namespace");

  let releaseStaleLoad!: () => void;
  const staleLoadGate = new Promise<void>((resolve) => {
    releaseStaleLoad = resolve;
  });
  const racingKey = catalogCacheKey("brands", `in-flight-${suffix}`);
  const staleLoad = readThroughCatalogCache(racingKey, async () => {
    await staleLoadGate;
    return "stale";
  });
  await Promise.resolve();
  await invalidateCatalogCache("brands");
  const freshAfterInvalidation = await readThroughCatalogCache(racingKey, async () => "fresh");
  assert.equal(freshAfterInvalidation, "fresh", "an invalidation must detach an older in-flight load");
  releaseStaleLoad();
  assert.equal(await staleLoad, "stale", "the request that began before invalidation may still finish");
  const cachedAfterRace = await readThroughCatalogCache(racingKey, async () => "unexpected");
  assert.equal(cachedAfterRace, "fresh", "a stale in-flight result must not overwrite the post-invalidation cache");

  await startCatalogCacheInvalidationListener();
  let crossProcessLoads = 0;
  const crossProcessKey = catalogCacheKey("discovery", `cross-process-${suffix}`);
  await readThroughCatalogCache(crossProcessKey, async () => ++crossProcessLoads);
  await runChildInvalidator("discovery");
  await pause(150);
  await readThroughCatalogCache(crossProcessKey, async () => ++crossProcessLoads);
  assert.equal(crossProcessLoads, 2, "a PostgreSQL notification from another process must evict the namespace");

  const stats = catalogCacheStats();
  assert.ok(stats.entries > 0);
  assert.equal(stats.pendingLoads, 0);
  console.log("Catalog cache regression passed.");
}

try {
  await run();
} finally {
  await stopCatalogCacheInvalidationListener();
  await pool.end();
}