import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
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

export async function readThroughCatalogCache<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs?: number,
): Promise<T> {
  const namespace = namespaceFromKey(key);
  return catalogCache.getOrLoad(key, namespace ? [namespace] : [], loader, ttlMs);
}

export async function invalidateCatalogCache(
  ...namespaces: CatalogCacheNamespace[]
): Promise<void> {
  await publishCatalogInvalidation([...new Set(namespaces)]);
}

export async function startCatalogCacheInvalidationListener(): Promise<void> {
  await startCatalogCacheListener();
}

export async function stopCatalogCacheInvalidationListener(): Promise<void> {
  await stopCatalogCacheListener();
}

export function catalogCacheStats() {
  return catalogCache.getStats();
}

const CHANNEL = "lumera_catalog_cache_invalidation";
const INITIAL_RECONNECT_DELAY_MS = 1_000;

function isInvalidationPayload(v: unknown): v is InvalidationPayload {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  if (typeof obj["sourceInstanceId"] !== "string") return false;
  const hasKey = "key" in obj;
  const hasTag = "tag" in obj;
  if (hasKey && typeof obj["key"] !== "string") return false;
  if (hasTag && typeof obj["tag"] !== "string") return false;
  if (!hasKey && !hasTag) return false;
  return true;
}

function safeRelease(client: PoolClient): void {
  try {
    client.release();
  } catch (err) {
    logger.warn({ err }, "CatalogCache: failed to release client");
  }
}

/**
 * Invalidate all entries for the given tags locally AND publish pg_notify
 * messages so sibling processes invalidate their own caches.
 *
 * Call this only after a successful mutation has been committed.
 */
export async function publishCatalogInvalidation(tags: string[]): Promise<void> {
  try {
    await catalogCache.publishInvalidateTags(tags);
  } catch (err) {
    // Local entries were already invalidated. A missed broadcast is recoverable
    // because every entry has a bounded TTL, so a committed business mutation
    // must not be reported to the caller as failed after the write succeeded.
    logger.warn({ err, tags }, "CatalogCache: invalidation broadcast failed; TTL remains the fallback");
  }
}

async function acquirePoolClient() {
  return pool.connect();
}

export interface CatalogCacheOptions {
  /**
   * Default TTL in milliseconds for all entries. Clamped to [5 min, 15 min].
   * Default: 10 min.
   */
  ttlMs?: number;
  /** Maximum number of entries before oldest-entry eviction. Default: 1 000. */
  maxEntries?: number;
}

export class CatalogCache {
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  /** key → stored entry */
  private readonly store = new Map<string, StoredEntry>();
  /** key → in-flight loader promise (coalescing) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly inflight = new Map<string, Promise<any>>();
  /** tag → set of keys */
  private readonly tagIndex = new Map<string, Set<string>>();
  /**
   * Monotonic invalidation generation. A loader that started before any
   * invalidation may still return its value to the caller, but it must not
   * repopulate the cache with a snapshot taken before the successful write.
   */
  private invalidationGeneration = 0;

  // ---- Listener state ----
  private listenerClient: PoolClient | undefined;
  private listenerReady = false;
  private listenerStartPromise: Promise<void> | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  private stopped = true;

  // Stable references for event (de)registration
  private readonly boundOnNotification: (n: { channel: string; payload?: string }) => void;
  private readonly boundOnError: (err: Error) => void;
  private readonly boundOnEnd: () => void;

  constructor(options: CatalogCacheOptions = {}) {
    const rawTtl = options.ttlMs ?? DEFAULT_TTL_MS;
    this.defaultTtlMs = Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, rawTtl));
    const requestedMaxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxEntries = Number.isInteger(requestedMaxEntries) && requestedMaxEntries > 0
      ? requestedMaxEntries
      : DEFAULT_MAX_ENTRIES;

    this.boundOnNotification = (n) => { this.handleNotification(n); };
    this.boundOnError        = (err) => { this.handleListenerError(err); };
    this.boundOnEnd          = () => { this.handleListenerEnd(); };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Connect the PostgreSQL LISTEN/NOTIFY invalidation channel.
   * Safe to call multiple times — subsequent calls are no-ops while connected.
   */
  async start(): Promise<void> {
    this.stopped = false;
    if (this.listenerReady) return;

    if (!this.listenerStartPromise) {
      this.listenerStartPromise = this.connectListener().finally(() => {
        this.listenerStartPromise = undefined;
      });
    }
    await this.listenerStartPromise;
  }

  /**
   * UNLISTEN and release the dedicated connection.
   * The in-process cache is NOT cleared — TTL is the fallback.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    const client = this.listenerClient;
    if (!client) return;

    this.listenerReady = false;
    this.listenerClient = undefined;

    client.off("notification", this.boundOnNotification);
    client.off("error", this.boundOnError);
    client.off("end", this.boundOnEnd);
    client.on("error", noop);

    try {
      await client.query(`UNLISTEN ${CHANNEL}`);
      client.release();
      client.off("error", noop);
    } catch (err) {
      logger.warn({ err }, "CatalogCache: UNLISTEN failed during stop");
      client.release(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // -------------------------------------------------------------------------
  // Cache-aside — primary API
  // -------------------------------------------------------------------------

  /**
   * Return the cached value for `key`, or load it via `loader` on a miss.
   *
   * Concurrent calls with the same key while the loader is in flight receive
   * the same Promise (coalescing), preventing cache stampedes.
   *
   * @param key    Unique cache key
   * @param tags   Tags for bulk invalidation (stored with the entry)
   * @param loader Async factory called on a cache miss
   * @param ttlMs  Per-call TTL override (clamped to [5 min, 15 min])
   */
  async getOrLoad<T>(
    key: string,
    tags: string[],
    loader: () => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (existing && existing.expiresAt > now) {
      // Refresh Map insertion order so capacity eviction is genuinely LRU.
      this.store.delete(key);
      this.store.set(key, existing);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return existing.value as T;
    }

    // Coalesce concurrent misses for the same key
    const inFlight = this.inflight.get(key) as Promise<T> | undefined;
    if (inFlight) return inFlight;

    const effectiveTtl = ttlMs !== undefined
      ? Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ttlMs))
      : this.defaultTtlMs;

    const generationAtLoadStart = this.invalidationGeneration;
    let promise: Promise<T>;
    promise = loader().then(
      (value) => {
        if (generationAtLoadStart === this.invalidationGeneration) {
          this.setEntry(key, value, tags, effectiveTtl);
        }
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
        return value;
      },
      (err: unknown) => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
        throw err;
      },
    );

    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Explicitly insert or overwrite a cache entry.
   */
  set<T>(key: string, value: T, tags: string[] = [], ttlMs?: number): void {
    const effectiveTtl = ttlMs !== undefined
      ? Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ttlMs))
      : this.defaultTtlMs;
    this.setEntry(key, value, tags, effectiveTtl);
  }

  // -------------------------------------------------------------------------
  // Local invalidation
  // -------------------------------------------------------------------------

  /** Remove a single entry from the local cache. */
  invalidateKey(key: string): void {
    this.invalidationGeneration += 1;
    this.inflight.delete(key);
    this.evict(key);
  }

  /** Remove all entries tagged with `tag` from the local cache. */
  invalidateTag(tag: string): void {
    this.invalidationGeneration += 1;
    // A miss that started before the write may be loading an entry whose tags
    // have not been indexed yet. Detach all in-flight loads so post-write
    // callers never join a pre-write snapshot; the generation guard prevents
    // those detached loads from populating the cache when they finish.
    this.inflight.clear();
    const keys = this.tagIndex.get(tag);
    if (!keys) return;
    for (const key of [...keys]) this.evict(key);
    this.tagIndex.delete(tag);
  }

  /** Remove all entries whose tags intersect `tags` from the local cache. */
  invalidateTags(tags: string[]): void {
    if (tags.length === 0) return;
    for (const tag of tags) this.invalidateTag(tag);
  }

  /** Clear every entry from the local cache. */
  clear(): void {
    this.invalidationGeneration += 1;
    this.inflight.clear();
    this.store.clear();
    this.tagIndex.clear();
    // In-flight promises still resolve for their callers, but the generation
    // guard prevents them from repopulating this cleared cache.
  }

  // -------------------------------------------------------------------------
  // Cross-process publish helpers — call AFTER a successful mutation
  // -------------------------------------------------------------------------

  /**
   * Invalidate a key locally AND notify sibling processes via pg_notify.
   */
  async publishInvalidateKey(key: string): Promise<void> {
    this.invalidateKey(key);
    await this.pgNotify({ key, sourceInstanceId: INSTANCE_ID });
  }

  /**
   * Invalidate a tag locally AND notify sibling processes via pg_notify.
   */
  async publishInvalidateTag(tag: string): Promise<void> {
    this.invalidateTag(tag);
    await this.pgNotify({ tag, sourceInstanceId: INSTANCE_ID });
  }

  /**
   * Invalidate multiple tags locally AND notify sibling processes for each.
   */
  async publishInvalidateTags(tags: string[]): Promise<void> {
    this.invalidateTags(tags);
    await Promise.all(tags.map((tag) => this.pgNotify({ tag, sourceInstanceId: INSTANCE_ID })));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private setEntry(key: string, value: unknown, tags: string[], ttlMs: number): void {
    // Evict oldest entry if at capacity and the key is new
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.evict(oldest);
    }

    // Remove the key from its previous tags before re-indexing
    const previous = this.store.get(key);
    if (previous) {
      for (const tag of previous.tags) this.tagIndex.get(tag)?.delete(key);
    }

    const tagSet = new Set(tags);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs, tags: tagSet });

    for (const tag of tagSet) {
      let keySet = this.tagIndex.get(tag);
      if (!keySet) { keySet = new Set(); this.tagIndex.set(tag, keySet); }
      keySet.add(key);
    }
  }

  private evict(key: string): void {
    const entry = this.store.get(key);
    if (!entry) return;
    this.store.delete(key);
    for (const tag of entry.tags) this.tagIndex.get(tag)?.delete(key);
  }

  private async pgNotify(payload: InvalidationPayload): Promise<void> {
    try {
      await pool.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(payload)]);
    } catch (err) {
      logger.warn({ err }, "CatalogCache: pg_notify failed; siblings will rely on TTL");
    }
  }

  // -------------------------------------------------------------------------
  // Listener
  // -------------------------------------------------------------------------

  private async connectListener(): Promise<void> {
    if (this.stopped) return;

    let client: PoolClient | undefined;
    try {
      client = await acquirePoolClient();

      if (this.stopped) {
        safeRelease(client);
        return;
      }

      this.listenerClient = client;
      client.on("notification", this.boundOnNotification);
      client.once("error", this.boundOnError);
      client.once("end", this.boundOnEnd);

      await client.query(`LISTEN ${CHANNEL}`);

      if (this.stopped) {
        await this.stop();
        return;
      }

      this.listenerReady = true;
      this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
      logger.info("CatalogCache: invalidation listener connected");
    } catch (err) {
      logger.warn({ err }, "CatalogCache: listener connect failed");
      if (client) {
        client.off("notification", this.boundOnNotification);
        client.off("error", this.boundOnError);
        client.off("end", this.boundOnEnd);
        client.on("error", noop);
        if (this.listenerClient === client) this.listenerClient = undefined;
        safeReleaseError(client, err);
      }
      this.listenerReady = false;
      this.scheduleReconnect();
    }
  }

  private handleNotification(n: { channel: string; payload?: string }): void {
    if (this.stopped || n.channel !== CHANNEL) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(n.payload ?? "null");
    } catch {
      logger.warn({ payload: n.payload }, "CatalogCache: unparseable NOTIFY payload");
      return;
    }

    if (!isInvalidationPayload(parsed)) {
      logger.warn({ payload: n.payload }, "CatalogCache: invalid NOTIFY payload shape");
      return;
    }

    // Skip our own publications — we already invalidated locally
    if (parsed.sourceInstanceId === INSTANCE_ID) return;

    if (parsed.key !== undefined) {
      this.invalidateKey(parsed.key);
    } else if (parsed.tag !== undefined) {
      this.invalidateTag(parsed.tag);
    }
  }

  private handleListenerError(err: Error): void {
    if (this.stopped) return;
    logger.warn({ err }, "CatalogCache: listener connection error");
    this.teardownClient();
    this.scheduleReconnect();
  }

  private handleListenerEnd(): void {
    if (this.stopped) return;
    logger.warn("CatalogCache: listener connection ended unexpectedly");
    this.teardownClient();
    this.scheduleReconnect();
  }

  private teardownClient(): void {
    const client = this.listenerClient;
    if (!client) return;

    this.listenerReady = false;
    this.listenerClient = undefined;

    client.off("notification", this.boundOnNotification);
    client.off("error", this.boundOnError);
    client.off("end", this.boundOnEnd);
    client.on("error", noop);
    try {
      client.release(true);
    } catch (err) {
      logger.warn({ err }, "CatalogCache: failed to release listener client");
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAXIMUM_RECONNECT_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectListener();
    }, delay);
    this.reconnectTimer.unref();
  }

  // -------------------------------------------------------------------------
  // Test-only controls
  // -------------------------------------------------------------------------

  private requireTestRuntime(): void {
    if (process.env["NODE_ENV"] !== "test") {
      throw new Error("CatalogCache test controls are only available in NODE_ENV=test");
    }
  }

  /**
   * Returns internal snapshot for test assertions.
   * Only callable when NODE_ENV === "test".
   */
  getTestStatus(): {
    size: number;
    listenerReady: boolean;
    stopped: boolean;
    inflightCount: number;
  } {
    this.requireTestRuntime();
    return {
      size: this.store.size,
      listenerReady: this.listenerReady,
      stopped: this.stopped,
      inflightCount: this.inflight.size,
    };
  }

  /**
   * Wipes all cache entries and in-flight requests.
   * Only callable when NODE_ENV === "test".
   */
  resetForTests(): void {
    this.requireTestRuntime();
    this.clear();
  }

  getStats(): { entries: number; pendingLoads: number } {
    return {
      entries: this.store.size,
      pendingLoads: this.inflight.size,
    };
  }
}

const MAXIMUM_RECONNECT_DELAY_MS = 30_000;

const MAX_TTL_MS     = 15 * 60_000; //  15 minutes
const MIN_TTL_MS     =  5 * 60_000; //   5 minutes
const DEFAULT_TTL_MS = 10 * 60_000; //  10 minutes

const INSTANCE_ID = randomUUID();

type PoolClient = Awaited<ReturnType<typeof acquirePoolClient>>;

const DEFAULT_MAX_ENTRIES = 1_000;

/**
 * General-purpose catalog cache shared across route handlers.
 * Use getOrLoad<T>() for typed cache-aside reads.
 */
export const catalogCache = new CatalogCache();

/** Start the shared cross-process invalidation listener. */
export async function startCatalogCacheListener(): Promise<void> {
  await catalogCache.start();
}

function safeReleaseError(client: PoolClient, cause: unknown): void {
  try {
    client.release(cause instanceof Error ? cause : new Error(String(cause)));
  } catch (err) {
    logger.warn({ err }, "CatalogCache: failed to release errored client");
  }
}

interface InvalidationPayload {
  /** Key to invalidate — absent for tag-based invalidation */
  key?: string;
  /** Tag to invalidate — absent for key-based invalidation */
  tag?: string;
  /** Originating process — receivers ignore if it matches their own INSTANCE_ID */
  sourceInstanceId: string;
}

function noop(): void {
  // Intentional no-op: absorbs terminal socket errors after connection release.
}

/**
 * Compatibility alias for marketplace home discovery payloads. It points to
 * the same shared cache so every catalog follows one invalidation lifecycle.
 */
export const marketplaceHomeDiscoveryCache = catalogCache;

interface StoredEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  expiresAt: number;
  tags: Set<string>;
}

/** Stop cross-process invalidation listeners and release connections. */
export async function stopCatalogCacheListener(): Promise<void> {
  await catalogCache.stop();
}
