#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Bundle report + budget check for the beauty-marketplace frontend.
//
// Reads the Vite production manifest (dist/public/.vite/manifest.json), maps
// each emitted JavaScript chunk to its raw + gzip size, prints a report, and
// enforces sensible budgets so route-level code splitting cannot silently
// regress into an oversized eager bundle.
//
// Uses only Node built-ins (fs, path, zlib) -- no third-party dependencies.
//
// Usage:
//   node scripts/bundle-report.mjs            # report + enforce budgets
//   node scripts/bundle-report.mjs --json     # machine-readable JSON output
//   node scripts/bundle-report.mjs --no-fail  # report only, never exit non-zero
// ---------------------------------------------------------------------------

import { readFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const distDir = join(projectRoot, 'dist', 'public');
const manifestPath = join(distDir, '.vite', 'manifest.json');

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const noFail = args.has('--no-fail');

// Budgets are expressed in gzipped kilobytes -- what the browser actually
// downloads over the wire. They are intentionally generous headroom over the
// current baseline so ordinary feature work does not trip them, while a
// regression that collapses code splitting (e.g. every page in one chunk) will.
const KB = 1024;
const BUDGETS = {
  // Largest single route/section chunk. Any one lazily-loaded page section.
  maxRouteChunkGzipKb: 100,
  // The eager entry chunk (initial JS the browser must download before the
  // first route can render). Route pages must NOT live here.
  maxEntryGzipKb: 200,
  // Total gzipped JS across every chunk (shared vendor + all route sections).
  maxTotalGzipKb: 750,
  // Minimum number of distinct JS chunks. Guards against a regression that
  // bundles all routes together (code splitting silently disabled).
  minChunkCount: 25,
};

function fail(message) {
  console.error(`\u001b[31mbundle-report: ${message}\u001b[0m`);
  process.exit(noFail ? 0 : 1);
}

if (!existsSync(manifestPath)) {
  fail(
    `manifest not found at ${manifestPath}. Run the production build first ` +
      `(pnpm --filter @workspace/beauty-marketplace run build).`,
  );
}

/** @type {Record<string, { file: string; isEntry?: boolean; name?: string }>} */
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const seen = new Set();
const chunks = [];

for (const [key, entry] of Object.entries(manifest)) {
  const file = entry.file;
  if (!file || !file.endsWith('.js')) continue;
  if (seen.has(file)) continue;
  seen.add(file);

  const abs = join(distDir, file);
  if (!existsSync(abs)) continue;

  const buf = readFileSync(abs);
  const rawBytes = statSync(abs).size;
  const gzipBytes = gzipSync(buf).length;

  chunks.push({
    key,
    file,
    name: entry.name ?? key,
    isEntry: Boolean(entry.isEntry),
    rawBytes,
    gzipBytes,
  });
}

if (chunks.length === 0) {
  fail('no JavaScript chunks found in manifest.');
}

chunks.sort((a, b) => b.gzipBytes - a.gzipBytes);

const totalGzip = chunks.reduce((sum, c) => sum + c.gzipBytes, 0);
const totalRaw = chunks.reduce((sum, c) => sum + c.rawBytes, 0);
const entryChunks = chunks.filter((c) => c.isEntry);
const routeChunks = chunks.filter((c) => !c.isEntry);
const largestRoute = routeChunks[0] ?? null;
const largestEntry = entryChunks.sort((a, b) => b.gzipBytes - a.gzipBytes)[0] ?? null;

const kb = (bytes) => (bytes / KB).toFixed(1);

const violations = [];
if (largestRoute && largestRoute.gzipBytes > BUDGETS.maxRouteChunkGzipKb * KB) {
  violations.push(
    `largest route chunk "${largestRoute.name}" is ${kb(largestRoute.gzipBytes)} KB gzip ` +
      `(budget ${BUDGETS.maxRouteChunkGzipKb} KB).`,
  );
}
if (largestEntry && largestEntry.gzipBytes > BUDGETS.maxEntryGzipKb * KB) {
  violations.push(
    `entry chunk "${largestEntry.name}" is ${kb(largestEntry.gzipBytes)} KB gzip ` +
      `(budget ${BUDGETS.maxEntryGzipKb} KB). Route pages should be lazy, not in the entry.`,
  );
}
if (totalGzip > BUDGETS.maxTotalGzipKb * KB) {
  violations.push(
    `total JS is ${kb(totalGzip)} KB gzip (budget ${BUDGETS.maxTotalGzipKb} KB).`,
  );
}
if (chunks.length < BUDGETS.minChunkCount) {
  violations.push(
    `only ${chunks.length} JS chunks emitted (expected >= ${BUDGETS.minChunkCount}). ` +
      `Route-level code splitting may have regressed.`,
  );
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        budgets: BUDGETS,
        totals: { gzipBytes: totalGzip, rawBytes: totalRaw, chunkCount: chunks.length },
        largestEntry,
        largestRoute,
        chunks,
        violations,
        ok: violations.length === 0,
      },
      null,
      2,
    ),
  );
} else {
  console.log('\nBundle report (dist/public) — gzip / raw');
  console.log('─'.repeat(64));
  for (const c of chunks) {
    const tag = c.isEntry ? '[entry]' : '[route]';
    console.log(
      `${tag} ${kb(c.gzipBytes).padStart(8)} KB / ${kb(c.rawBytes).padStart(8)} KB  ${c.name}`,
    );
  }
  console.log('─'.repeat(64));
  console.log(`chunks: ${chunks.length}`);
  console.log(`total:  ${kb(totalGzip)} KB gzip / ${kb(totalRaw)} KB raw`);
  if (largestEntry) console.log(`entry:  ${kb(largestEntry.gzipBytes)} KB gzip (${largestEntry.name})`);
  if (largestRoute) console.log(`route:  ${kb(largestRoute.gzipBytes)} KB gzip (${largestRoute.name})`);
  console.log('');
  console.log('Budgets (gzip KB):', JSON.stringify(BUDGETS));
  console.log('');
}

if (violations.length > 0) {
  for (const v of violations) console.error(`\u001b[31m✗ budget: ${v}\u001b[0m`);
  process.exit(noFail ? 0 : 1);
}

if (!asJson) {
  console.log('\u001b[32m✓ all bundle budgets satisfied\u001b[0m');
}
