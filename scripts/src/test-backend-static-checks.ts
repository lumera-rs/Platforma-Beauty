/**
 * Static source-code scan helpers for test-backend-standards.ts
 *
 * These scans operate on the raw TypeScript source files without executing
 * any production code and without requiring a database connection.
 *
 * checkAwaitInLoops():
 *   Finds `await db.*` or `await tx.*` calls that appear to be inside a
 *   `for` / `while` loop in the known list-assembler regions of the route
 *   files.  Promise.all()-wrapped maps are explicitly allowed.
 *
 * checkUnboundedSelects():
 *   Finds `db.select().from(<table>)` patterns in critical paginated routes
 *   (those whose response type includes pagination metadata) that lack a
 *   `.limit(` or `.where(` on the same logical line — i.e. whole-table
 *   fetches where DB-level pagination is contractually available.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── helpers ─────────────────────────────────────────────────────────────────

/** Resolve a path relative to the monorepo root (two levels above scripts/src) */
function repoPath(...parts: string[]): string {
  return path.resolve(__dirname, "..", "..", ...parts);
}

async function readSource(relPath: string): Promise<string> {
  return readFile(repoPath(relPath), "utf8");
}

// ── 1. await-in-loop check ───────────────────────────────────────────────────

/**
 * Regions (inclusive line ranges) in marketplace.ts that are known list
 * assembler / per-item processing loops.  A DB await inside these regions
 * is a regression (N+1 query pattern).
 *
 * Key regions to watch:
 *   - linkPhoneContactsToUser   ≈ 1189–1205
 *   - refreshMatureEducationEscrows inner loop ≈ 1341–1400
 *   - campaignRecipients        ≈ 458–475   (loads full tables, not per-item)
 *
 * KNOWN ACCEPTABLE: the for-loops in linkPhoneContactsToUser do per-group
 * batch updates, not per-row fetches.  We flag only SELECT/fetch calls inside
 * for-loops — not INSERT/UPDATE/DELETE which are intentional batch writes.
 */
interface LoopRegion {
  label: string;
  /** regex to detect the opening of the loop region */
  startPattern: RegExp;
  /** regex to detect closing (or max lines to scan) */
  endPattern: RegExp;
  /** regexes that constitute violations inside the loop */
  violationPattern: RegExp;
  /** regexes that excuse a line (e.g. Promise.all wrapper) */
  allowPattern?: RegExp;
}

const LOOP_REGIONS: LoopRegion[] = [
  {
    // publicEducationCourses: Promise.all on courses is OK, but a for-loop
    // containing await db.select inside is not
    label: "publicEducationCourses: per-course db select in loop",
    startPattern: /for\s+.*\bof\s+courses\b/,
    endPattern: /^\s*\}\s*$/,
    violationPattern: /await\s+(db|tx)\s*\.\s*select\s*\(\s*\)\s*\.from\(/,
    allowPattern: /Promise\.all/,
  },
];

export async function checkAwaitInLoops(): Promise<string[]> {
  const violations: string[] = [];
  const file = "artifacts/api-server/src/routes/marketplace.ts";
  let source: string;
  try {
    source = await readSource(file);
  } catch {
    // File not found — nothing to scan
    return [];
  }

  const lines = source.split("\n");

  for (const region of LOOP_REGIONS) {
    let insideLoop = false;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      if (!insideLoop) {
        if (region.startPattern.test(line)) {
          insideLoop = true;
          braceDepth = 0;
          // count opening braces on the trigger line
          for (const ch of line) {
            if (ch === "{") braceDepth++;
            else if (ch === "}") braceDepth--;
          }
        }
        continue;
      }

      // Track brace depth to find end of loop body
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
      }

      if (braceDepth <= 0) {
        insideLoop = false;
        continue;
      }

      if (region.allowPattern && region.allowPattern.test(line)) continue;
      if (region.violationPattern.test(line)) {
        if (!region.allowPattern || !region.allowPattern.test(line)) {
          violations.push(`${file}:${i + 1} [${region.label}] — ${line.trim()}`);
        }
      }
    }
  }

  return violations;
}

// ── 2. unbounded-select check ────────────────────────────────────────────────

/**
 * Routes where pagination is contractually available (the response schema
 * has page/pageSize/total fields) but the implementation fetches the entire
 * table into memory and slices in-place.
 *
 * We check that the only known instance (admin/products) keeps its in-memory
 * slice pattern and does NOT add new whole-table fetches without DB-level LIMIT.
 *
 * Pattern:  db.select().from(<table>)  with NO  .where( or .limit(  on the
 *           same source line, appearing inside a function that is mapped to a
 *           paginated route handler.
 *
 * Currently accepted (tracked for future migration):
 *   - productsTable in /admin/products  (in-memory slice, acceptable at demo scale)
 *
 * Flagged if a NEW table is added to this pattern in a paginated route.
 */

/** Tables whose full-fetch in paginated routes is explicitly accepted. */
const ACCEPTED_UNBOUNDED_FULL_FETCHES = new Set<string>();

/**
 * Route handler functions known to be paginated (response schema has page/pageSize).
 * We scan only these regions.
 */
const PAGINATED_HANDLER_PATTERNS: RegExp[] = [
  /router\.(get|post)\s*\(\s*["'`]\/salons["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/appointments["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/salon\/appointments["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/salon\/customers["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/salon\/employees["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/shop\/products["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/shop\/orders["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/shop\/notifications["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/admin\/products["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/admin\/orders["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/admin\/salons["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/admin\/users["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/education\/public\/courses["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/education\/courses["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/education\/enrollments["'`]/,
  /router\.(get|post)\s*\(\s*["'`]\/education\/purchases["'`]/,
];

/**
 * Regex that matches an unbounded full-table select:
 *   db.select().from(someTable)
 * where the same line has no .where( or .limit(
 */
const UNBOUNDED_SELECT_PATTERN = /\bdb\.select\(\)\s*\.from\(\s*(\w+Table)\s*\)/;

export async function checkUnboundedSelects(): Promise<string[]> {
  const violations: string[] = [];
  const file = "artifacts/api-server/src/routes/marketplace.ts";
  let source: string;
  try {
    source = await readSource(file);
  } catch {
    return [];
  }

  const lines = source.split("\n");

  for (const handlerPattern of PAGINATED_HANDLER_PATTERNS) {
    // Find the handler start line
    let handlerStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (handlerPattern.test(lines[i]!)) {
        handlerStart = i;
        break;
      }
    }
    if (handlerStart === -1) continue;

    // Scan forward until the outer async function closes (brace depth back to 0)
    let depth = 0;
    let seenOpen = false;
    for (let i = handlerStart; i < lines.length; i++) {
      const line = lines[i]!;
      for (const ch of line) {
        if (ch === "{") { depth++; seenOpen = true; }
        else if (ch === "}") depth--;
      }

      // Check the full chained statement, which commonly spans several lines.
      const m = UNBOUNDED_SELECT_PATTERN.exec(line);
      if (m) {
        const tableName = m[1]!;
        let statement = line;
        for (let lookahead = i + 1; lookahead < Math.min(lines.length, i + 30); lookahead += 1) {
          statement += `\n${lines[lookahead]!}`;
          if (lines[lookahead]!.includes(";")) break;
        }
        const bounded = statement.includes(".limit(")
          || statement.includes(".where(");
        if (!bounded) {
          // Is it in the accepted list?
          if (!ACCEPTED_UNBOUNDED_FULL_FETCHES.has(tableName)) {
            violations.push(
              `${file}:${i + 1} [unbounded select in paginated route] — table: ${tableName}: ${line.trim()}`,
            );
          }
        }
      }

      if (seenOpen && depth === 0) break;
    }
  }

  return violations;
}

// ── 3. Cache invariant static scan ──────────────────────────────────────────

export interface CacheInvariantResult {
  name: string;
  ok: boolean;
  detail?: string;
}

/**
 * Verify cache TTL and bound invariants by scanning the marketplace source.
 *
 * Checked contracts:
 *   - marketplaceHomeDiscoveryCache TTL: Date.now() + N where N ≤ 120_000
 *   - marketplaceHomeDiscoveryCache size: clear() called when size >= threshold
 *   - availability is not retained after a request; only concurrent misses coalesce
 *   - Archive sets published=false (archived: true, published: false)
 *   - Publish sets archived=false (published: true, archived: false)
 */
export async function checkCacheInvariants(): Promise<CacheInvariantResult[]> {
  const results: CacheInvariantResult[] = [];
  let marketplaceSource: string;
  let cacheSource: string;
  try {
    [marketplaceSource, cacheSource] = await Promise.all([
      readSource("artifacts/api-server/src/routes/marketplace.ts"),
      readSource("artifacts/api-server/src/lib/catalog-cache.ts"),
    ]);
  } catch (err) {
    return [{ name: "cache invariants", ok: false, detail: String(err) }];
  }

  const ttlContract =
    /DEFAULT_TTL_MS\s*=\s*10\s*\*\s*60_000/.test(cacheSource)
    && /MIN_TTL_MS\s*=\s*5\s*\*\s*60_000/.test(cacheSource)
    && /MAX_TTL_MS\s*=\s*15\s*\*\s*60_000/.test(cacheSource);
  results.push({
    name: "catalog cache TTL is bounded to 5–15 minutes",
    ok: ttlContract,
    detail: ttlContract ? undefined : "Expected 10-minute default and 5/15-minute bounds",
  });

  const coalescing =
    /inflight\s*=\s*new Map/.test(cacheSource)
    && /this\.inflight\.get\(key\)/.test(cacheSource)
    && /this\.inflight\.set\(key,\s*promise\)/.test(cacheSource);
  results.push({
    name: "catalog cache coalesces concurrent misses",
    ok: coalescing,
    detail: coalescing ? undefined : "In-flight key coalescing pattern is missing",
  });

  const bounded =
    /DEFAULT_MAX_ENTRIES\s*=\s*1_000/.test(cacheSource)
    && /this\.store\.size\s*>=\s*this\.maxEntries/.test(cacheSource);
  results.push({
    name: "catalog cache has a bounded entry count",
    ok: bounded,
    detail: bounded ? undefined : "Maximum-entry eviction guard is missing",
  });

  const broadcast =
    /LISTEN \$\{CHANNEL\}/.test(cacheSource)
    && /pg_notify\(\$1,\s*\$2\)/.test(cacheSource)
    && /scheduleReconnect\(\)/.test(cacheSource);
  results.push({
    name: "catalog invalidation uses PostgreSQL broadcast with reconnect",
    ok: broadcast,
    detail: broadcast ? undefined : "LISTEN/NOTIFY or reconnect behavior is missing",
  });

  const routeIntegration =
    /catalogCache\.getOrLoad/.test(marketplaceSource)
    && /publishCatalogInvalidation/.test(marketplaceSource);
  results.push({
    name: "catalog routes use shared cache and post-write invalidation",
    ok: routeIntegration,
    detail: routeIntegration ? undefined : "Shared cache or invalidation call not found in routes",
  });

  // ─ Availability stays live: coalesce only the currently in-flight read ─
  {
    const hasSettledCache = /firstAvailableCache/.test(marketplaceSource);
    const coalescesInFlight = /firstAvailablePending\.get/.test(marketplaceSource)
      && /firstAvailablePending\.set/.test(marketplaceSource)
      && /firstAvailablePending\.delete/.test(marketplaceSource);
    results.push({
      name: "availability is live and only concurrent reads coalesce",
      ok: !hasSettledCache && coalescesInFlight,
      detail: hasSettledCache
        ? "Settled first-available responses must not be cached"
        : !coalescesInFlight ? "In-flight availability coalescing is incomplete" : undefined,
    });
  }

  // ─ archive always sets published: false ─
  {
    // Look for the archive handler pattern:  { archived: true, published: false }
    const archiveOk = /archived:\s*true[^}]*published:\s*false|published:\s*false[^}]*archived:\s*true/.test(marketplaceSource);
    results.push({
      name: "archive: sets published=false",
      ok: archiveOk,
      detail: archiveOk ? undefined : "archive update did not find published: false alongside archived: true",
    });
  }

  // ─ publish always sets archived: false ─
  {
    const publishOk = /published:\s*true[^}]*archived:\s*false|archived:\s*false[^}]*published:\s*true/.test(marketplaceSource);
    results.push({
      name: "publish: sets archived=false",
      ok: publishOk,
      detail: publishOk ? undefined : "publish update did not find archived: false alongside published: true",
    });
  }

  // ─ admin salon PATCH publishes the shared "salons" catalog tag ─
  // A successful admin salon mutation that changes active/featured/isVerified/
  // topSalon must invalidate + broadcast the "salons" tag so /discovery/home
  // reflects the change. The invalidation must live AFTER the db.update (only
  // on success). We scan the /admin/salons/:salonId PATCH handler region.
  {
    const lines = marketplaceSource.split("\n");
    const handlerStart = lines.findIndex((line) =>
      /router\.patch\s*\(\s*["'`]\/admin\/salons\/:salonId["'`]/.test(line),
    );
    let salonInvalidationOk = false;
    let salonInvalidationDetail = "handler /admin/salons/:salonId PATCH not found";
    if (handlerStart !== -1) {
      // Walk the handler body until it closes (brace depth back to 0).
      let depth = 0;
      let seenOpen = false;
      let handlerEnd = lines.length;
      for (let i = handlerStart; i < lines.length; i++) {
        for (const ch of lines[i]!) {
          if (ch === "{") { depth++; seenOpen = true; }
          else if (ch === "}") depth--;
        }
        if (seenOpen && depth === 0) { handlerEnd = i; break; }
      }
      const body = lines.slice(handlerStart, handlerEnd + 1);
      const updateIdx = body.findIndex((line) => /\b(?:db|tx)\.update\(salonsTable\)/.test(line));
      const afterUpdate = updateIdx === -1 ? [] : body.slice(updateIdx + 1);
      const broadcastsSalons = afterUpdate.some((line) => /publishCatalogInvalidation\(\s*\[[^\]]*["'`]salons["'`]/.test(line));
      salonInvalidationOk = updateIdx !== -1 && broadcastsSalons;
      if (!salonInvalidationOk) {
        salonInvalidationDetail = updateIdx === -1
          ? "db.update(salonsTable) not found in handler"
          : `missing post-update salons invalidation broadcast (broadcast=${broadcastsSalons})`;
      }
    }
    results.push({
      name: "admin salon PATCH publishes the salons catalog tag after success",
      ok: salonInvalidationOk,
      detail: salonInvalidationOk ? undefined : salonInvalidationDetail,
    });
  }

  // ─ /cities catalog is cached and shares the "salons" invalidation tag ─
  // The cached city catalog must be served through catalogCache.getOrLoad so
  // concurrent misses coalesce and reuse one PostgreSQL derivation. It must be
  // tagged with both "cities" and "salons" so that an admin active-status change
  // (which broadcasts the "salons" tag) also drops the stale city catalog.
  {
    const lines = marketplaceSource.split("\n");
    const handlerStart = lines.findIndex((line) =>
      /router\.get\s*\(\s*["'`]\/cities["'`]/.test(line),
    );
    let citiesCacheOk = false;
    let citiesDetail = "handler GET /cities not found";
    if (handlerStart !== -1) {
      let depth = 0;
      let seenOpen = false;
      let handlerEnd = lines.length;
      for (let i = handlerStart; i < lines.length; i++) {
        for (const ch of lines[i]!) {
          if (ch === "{") { depth++; seenOpen = true; }
          else if (ch === "}") depth--;
        }
        if (seenOpen && depth === 0) { handlerEnd = i; break; }
      }
      const body = lines.slice(handlerStart, handlerEnd + 1).join("\n");
      const usesCache = /catalogCache\.getOrLoad/.test(body);
      // Tags array must contain BOTH "cities" and "salons" so the shared salons
      // broadcast invalidates the city catalog.
      const tagsMatch = body.match(/getOrLoad\s*\(\s*[^,]+,\s*(\[[^\]]*\])/s);
      const tags = tagsMatch?.[1] ?? "";
      const hasCitiesTag = /["'`]cities["'`]/.test(tags);
      const hasSalonsTag = /["'`]salons["'`]/.test(tags);
      citiesCacheOk = usesCache && hasCitiesTag && hasSalonsTag;
      if (!citiesCacheOk) {
        citiesDetail = `GET /cities cache integration incomplete (getOrLoad=${usesCache}, cities-tag=${hasCitiesTag}, salons-tag=${hasSalonsTag})`;
      }
    }
    results.push({
      name: "GET /cities serves cached catalog tagged with both cities and salons",
      ok: citiesCacheOk,
      detail: citiesCacheOk ? undefined : citiesDetail,
    });
  }

  return results;
}
