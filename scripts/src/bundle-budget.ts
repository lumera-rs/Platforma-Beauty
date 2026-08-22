/**
 * Frontend bundle budget gate
 *
 * Reads the Vite manifest and the dist/public/assets directory produced by
 * `pnpm --filter @workspace/beauty-marketplace run build` and:
 *
 *   1. Identifies the **initial-entry JS** chunk(s) — those listed directly in
 *      index.html as <script type="module">.
 *   2. Identifies **route-level lazy JS** — every other .js asset.
 *   3. Reports raw and gzip sizes for every chunk, largest first.
 *   4. Detects duplicate React runtime (>1 chunk containing `createElement`
 *      export, which would mean deduplication broke).
 *   5. Enforces a hard budget:
 *        initial entry JS (gzip)  ≤ 150 kB   (was ~1.52 MB monolithic pre-split)
 *        largest single chunk (gzip) ≤ 300 kB
 *
 * Exit 0 = all checks pass.  Exit 1 = budget violation or React duplicate.
 *
 * Run via: pnpm run test:bundle-budget
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ─── paths ──────────────────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname, "../../artifacts/beauty-marketplace");
const DIST = path.join(ROOT, "dist/public");
const ASSETS_DIR = path.join(DIST, "assets");
const INDEX_HTML = path.join(DIST, "index.html");
// Vite writes the manifest into dist/public/.vite/manifest.json when
// manifest:true is set in the build config.
const MANIFEST = path.join(DIST, ".vite/manifest.json");

// ─── budgets (gzip, kibibytes) ───────────────────────────────────────────────

/** Maximum gzip size in bytes for ALL initial-entry JS chunks combined. */
const INITIAL_ENTRY_GZIP_BUDGET = 150 * 1024; // 150 kB

/** Maximum gzip size in bytes for any single JS chunk (entry or lazy). */
const MAX_SINGLE_CHUNK_GZIP = 300 * 1024; // 300 kB

// ─── helpers ────────────────────────────────────────────────────────────────

function gzipSize(filePath: string): number {
  const buf = fs.readFileSync(filePath);
  return zlib.gzipSync(buf, { level: 9 }).byteLength;
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(2) + " kB";
}

// ─── gather all .js assets ──────────────────────────────────────────────────

if (!fs.existsSync(DIST)) {
  console.error(
    `\n  ✗  dist directory not found at ${DIST}\n` +
    `     Run: pnpm --filter @workspace/beauty-marketplace run build\n`
  );
  process.exit(1);
}

if (!fs.existsSync(ASSETS_DIR)) {
  console.error(`  ✗  assets directory not found: ${ASSETS_DIR}`);
  process.exit(1);
}

interface ChunkInfo {
  file: string;       // basename
  rawBytes: number;
  gzipBytes: number;
  isEntry: boolean;
}

type ManifestChunk = {
  file: string;
  isEntry?: boolean;
  imports?: string[];
};

if (!fs.existsSync(MANIFEST)) {
  console.error(`  ✗  Vite manifest not found: ${MANIFEST}`);
  process.exit(1);
}

// Walk every static import reachable from a Vite entry. Dynamic imports are
// intentionally excluded because they are route-level/on-demand JavaScript.
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as Record<string, ManifestChunk>;
const entryFilenames = new Set<string>();
const visitStaticEntry = (key: string): void => {
  const chunk = manifest[key];
  if (!chunk || entryFilenames.has(path.basename(chunk.file))) return;
  entryFilenames.add(path.basename(chunk.file));
  chunk.imports?.forEach(visitStaticEntry);
};
Object.entries(manifest)
  .filter(([, chunk]) => chunk.isEntry)
  .forEach(([key]) => visitStaticEntry(key));

// Keep an index.html fallback for older Vite manifests while accepting any
// BASE_PATH prefix (for example /beauty-marketplace/assets/...).
if (entryFilenames.size === 0) {
  const indexHtml = fs.existsSync(INDEX_HTML) ? fs.readFileSync(INDEX_HTML, "utf8") : "";
  const scriptSrcRe = /src="[^"]*\/assets\/([^"]+\.js)"/g;
  let match: RegExpExecArray | null;
  while ((match = scriptSrcRe.exec(indexHtml)) !== null) {
    entryFilenames.add(match[1]);
  }
}

const chunks: ChunkInfo[] = fs
  .readdirSync(ASSETS_DIR)
  .filter((f) => f.endsWith(".js"))
  .map((file) => {
    const fullPath = path.join(ASSETS_DIR, file);
    const rawBytes = fs.statSync(fullPath).size;
    const gzipBytes = gzipSize(fullPath);
    return { file, rawBytes, gzipBytes, isEntry: entryFilenames.has(file) };
  })
  .sort((a, b) => b.gzipBytes - a.gzipBytes);

// ─── report ─────────────────────────────────────────────────────────────────

const WIDTH = 80;
const SEP = "─".repeat(WIDTH);

console.log(`\n${SEP}`);
console.log("  BUNDLE REPORT — beauty-marketplace");
console.log(SEP);

const entryChunks = chunks.filter((c) => c.isEntry);
const lazyChunks = chunks.filter((c) => !c.isEntry);

function printSection(title: string, items: ChunkInfo[]) {
  console.log(`\n  ${title} (${items.length} chunk${items.length !== 1 ? "s" : ""})`);
  console.log("  " + "·".repeat(WIDTH - 2));
  const header = `  ${"Chunk".padEnd(52)} ${"Raw".padStart(10)} ${"Gzip".padStart(10)}`;
  console.log(header);
  for (const c of items) {
    const name = c.file.length > 50 ? "…" + c.file.slice(-49) : c.file;
    const row =
      `  ${name.padEnd(52)} ${kb(c.rawBytes).padStart(10)} ${kb(c.gzipBytes).padStart(10)}`;
    console.log(row);
  }
}

printSection("INITIAL ENTRY JS (eagerly loaded)", entryChunks);
printSection("ROUTE-LEVEL LAZY JS (loaded on demand)", lazyChunks.slice(0, 30));

if (lazyChunks.length > 30) {
  console.log(`\n  … and ${lazyChunks.length - 30} more lazy chunks (all < ${kb(lazyChunks[29].gzipBytes)} gzip)`);
}

// ─── summary totals ─────────────────────────────────────────────────────────

const totalEntryGzip = entryChunks.reduce((s, c) => s + c.gzipBytes, 0);
const totalEntryRaw = entryChunks.reduce((s, c) => s + c.rawBytes, 0);
const totalLazyGzip = lazyChunks.reduce((s, c) => s + c.gzipBytes, 0);
const totalLazyRaw = lazyChunks.reduce((s, c) => s + c.rawBytes, 0);

console.log(`\n${SEP}`);
console.log("  TOTALS");
console.log(`  Initial entry JS : ${kb(totalEntryRaw).padStart(10)} raw  ${kb(totalEntryGzip).padStart(10)} gzip`);
console.log(`  Lazy route JS    : ${kb(totalLazyRaw).padStart(10)} raw  ${kb(totalLazyGzip).padStart(10)} gzip`);
console.log(`  Grand total JS   : ${kb(totalEntryRaw + totalLazyRaw).padStart(10)} raw  ${kb(totalEntryGzip + totalLazyGzip).padStart(10)} gzip`);

// ─── React duplication check ─────────────────────────────────────────────────
// A legitimate build has exactly one chunk exporting createElement. If dedupe
// breaks, React boots twice and hooks silently fail.

console.log(`\n${SEP}`);
console.log("  REACT RUNTIME DEDUPLICATION CHECK");

const reactChunks: string[] = [];
for (const chunk of chunks) {
  const content = fs.readFileSync(path.join(ASSETS_DIR, chunk.file), "utf8");
  // The minified React entry exports a function literally named createElement
  // and registers the global __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
  if (
    content.includes("__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED") ||
    content.includes("reactRootContainer")
  ) {
    reactChunks.push(chunk.file);
  }
}

const reactDuplicated = reactChunks.length > 1;
if (reactDuplicated) {
  console.log(`  ✗  React runtime found in ${reactChunks.length} chunks — deduplication broken!`);
  for (const f of reactChunks) console.log(`       • ${f}`);
} else if (reactChunks.length === 1) {
  console.log(`  ✓  React runtime is in exactly 1 chunk: ${reactChunks[0]}`);
} else {
  console.log(`  ✓  React runtime sentinel not found (may be tree-shaken stub) — OK`);
}

// ─── budget gate ─────────────────────────────────────────────────────────────

console.log(`\n${SEP}`);
console.log("  BUDGET GATE");

type GateResult = { name: string; ok: boolean; detail: string };
const gates: GateResult[] = [];

gates.push({
  name: "Entry and lazy route chunks detected",
  ok: entryChunks.length > 0 && lazyChunks.length > 0,
  detail: `${entryChunks.length} eager / ${lazyChunks.length} lazy chunks`,
});

// Gate 1: initial entry JS total gzip
{
  const ok = totalEntryGzip <= INITIAL_ENTRY_GZIP_BUDGET;
  gates.push({
    name: "Initial-entry JS total (gzip)",
    ok,
    detail: `${kb(totalEntryGzip)} / budget ${kb(INITIAL_ENTRY_GZIP_BUDGET)}`,
  });
}

// Gate 2: no single chunk exceeds max
{
  const worst = chunks[0]; // already sorted by gzip desc
  const ok = !worst || worst.gzipBytes <= MAX_SINGLE_CHUNK_GZIP;
  gates.push({
    name: "Largest single chunk (gzip)",
    ok,
    detail: worst
      ? `${worst.file}: ${kb(worst.gzipBytes)} / budget ${kb(MAX_SINGLE_CHUNK_GZIP)}`
      : "no chunks found",
  });
}

// Gate 3: React not duplicated
gates.push({
  name: "React runtime not duplicated",
  ok: !reactDuplicated,
  detail: reactDuplicated
    ? `Found in ${reactChunks.length} chunks`
    : "single runtime ✓",
});

// Gate 4: monolithic bundle is gone — initial entry must be < 500 kB raw
//         (prior to route lazy-loading it was ~1.52 MB raw)
{
  const RAW_MONOLITH_LIMIT = 500 * 1024;
  const ok = totalEntryRaw <= RAW_MONOLITH_LIMIT;
  gates.push({
    name: "Monolithic bundle eliminated (raw < 500 kB)",
    ok,
    detail: `initial entry raw: ${kb(totalEntryRaw)} / limit ${kb(RAW_MONOLITH_LIMIT)}`,
  });
}

let allPass = true;
for (const g of gates) {
  const icon = g.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`\n  ${icon}  ${g.name}`);
  console.log(`       ${g.detail}`);
  if (!g.ok) allPass = false;
}

console.log(`\n${SEP}`);
if (allPass) {
  console.log("  \x1b[32mAll bundle budget checks PASSED\x1b[0m");
} else {
  console.log("  \x1b[31mBundle budget checks FAILED — see above\x1b[0m");
}
console.log(`${SEP}\n`);

process.exit(allPass ? 0 : 1);
