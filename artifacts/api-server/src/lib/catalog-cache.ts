import { pool, type DatabasePoolClient } from "@workspace/db";
import { logger } from "./logger";

export type CatalogCacheNamespace =
  | "brands"
  | "cities"
  | "discovery"
  | "education-categories"
  | "education-featured"
  | "education-popular"
  | "service-categories"
  | "service-templates";

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

type PendingLoad = {
  generation: number;
  promise: Promise<unknown>;
};

const cache = new Map<string, CacheEntry>();
const pendingLoads = new Map<string, PendingLoad>();
const namespaceGenerations = new Map<CatalogCacheNamespace, number>();
const CACHE_CHANNEL = "lumera_catalog_cache_v1";
const DEFAULT_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 500;

let listenerClient: DatabasePoolClient | undefined;
let listenerGeneration = 0;
let listenerStopped = true;
let reconnectTimer: NodeJS.Timeout | undefined;

export function catalogCacheKey(
  namespace: CatalogCacheNamespace,
  discriminator = "all",
): string {
  return `${namespace}:${discriminator}`;
}

function namespaceFromKey(key: string): CatalogCacheNamespace | undefined {
  const namespace = key.split(":", 1)[0];
  return namespace as CatalogCacheNamespace | undefined;
}

function namespaceGeneration(namespace: CatalogCacheNamespace | undefined): number {
  return namespace ? namespaceGenerations.get(namespace) ?? 0 : 0;
}

function evictNamespaces(namespaces: readonly CatalogCacheNamespace[]): void {
  if (namespaces.length === 0) return;
  const selected = new Set(namespaces);
  for (const namespace of selected) {
    namespaceGenerations.set(namespace, namespaceGeneration(namespace) + 1);
  }
  for (const key of cache.keys()) {
    const namespace = namespaceFromKey(key);
    if (namespace && selected.has(namespace)) cache.delete(key);
  }
  for (const key of pendingLoads.keys()) {
    const namespace = namespaceFromKey(key);
    if (namespace && selected.has(namespace)) pendingLoads.delete(key);
  }
}

function enforceEntryLimit(): void {
  while (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) return;
    cache.delete(oldestKey);
  }
}

export async function readThroughCatalogCache<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    cache.delete(key);
    cache.set(key, existing);
    return existing.value as T;
  }
  if (existing) cache.delete(key);

  const namespace = namespaceFromKey(key);
  const generation = namespaceGeneration(namespace);
  const pending = pendingLoads.get(key);
  if (pending && pending.generation === generation) return pending.promise as Promise<T>;

  const pendingLoad = {} as PendingLoad;
  const load = loader()
    .then((value) => {
      if (namespaceGeneration(namespace) === generation) {
        cache.set(key, {
          value,
          expiresAt: Date.now() + ttlMs,
        });
        enforceEntryLimit();
      }
      return value;
    })
    .finally(() => {
      if (pendingLoads.get(key) === pendingLoad) pendingLoads.delete(key);
    });
  pendingLoad.generation = generation;
  pendingLoad.promise = load;
  pendingLoads.set(key, pendingLoad);
  return load;
}

export async function invalidateCatalogCache(
  ...namespaces: CatalogCacheNamespace[]
): Promise<void> {
  const unique = [...new Set(namespaces)];
  evictNamespaces(unique);
  if (unique.length === 0) return;

  try {
    await pool.query("select pg_notify($1, $2)", [
      CACHE_CHANNEL,
      JSON.stringify({ namespaces: unique }),
    ]);
  } catch (error) {
    logger.warn(
      { err: error, cacheNamespaces: unique },
      "Catalog cache invalidation broadcast failed",
    );
  }
}

function scheduleReconnect(generation: number): void {
  if (listenerStopped || generation !== listenerGeneration || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connectListener(generation);
  }, 2_000);
  reconnectTimer.unref();
}

async function connectListener(generation: number): Promise<void> {
  if (listenerStopped || generation !== listenerGeneration || listenerClient) return;

  try {
    const client = await pool.connect();
    if (listenerStopped || generation !== listenerGeneration) {
      client.release();
      return;
    }

    listenerClient = client;
    const reconnect = (error?: Error) => {
      if (listenerClient !== client) return;
      listenerClient = undefined;
      try {
        client.release(error);
      } catch {
        // The pool may already have removed a failed client.
      }
      if (error) {
        logger.warn({ err: error }, "Catalog cache listener disconnected");
      }
      scheduleReconnect(generation);
    };

    client.on("notification", (notification) => {
      if (notification.channel !== CACHE_CHANNEL || !notification.payload) return;
      try {
        const payload = JSON.parse(notification.payload) as {
          namespaces?: CatalogCacheNamespace[];
        };
        if (Array.isArray(payload.namespaces)) {
          evictNamespaces(payload.namespaces);
        }
      } catch (error) {
        logger.warn({ err: error }, "Invalid catalog cache invalidation payload");
      }
    });
    client.once("error", reconnect);
    client.once("end", () => reconnect());
    await client.query(`listen ${CACHE_CHANNEL}`);
    logger.info("Catalog cache invalidation listener started");
  } catch (error) {
    logger.warn({ err: error }, "Could not start catalog cache listener");
    scheduleReconnect(generation);
  }
}

export async function startCatalogCacheInvalidationListener(): Promise<void> {
  if (!listenerStopped) return;
  listenerStopped = false;
  listenerGeneration += 1;
  await connectListener(listenerGeneration);
}

export async function stopCatalogCacheInvalidationListener(): Promise<void> {
  listenerStopped = true;
  listenerGeneration += 1;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  const client = listenerClient;
  listenerClient = undefined;
  if (!client) return;
  try {
    await client.query(`unlisten ${CACHE_CHANNEL}`);
  } catch {
    // The connection may already be closed.
  } finally {
    client.release();
  }
}

export function catalogCacheStats() {
  return {
    entries: cache.size,
    pendingLoads: pendingLoads.size,
  };
}