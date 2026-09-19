import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { StartupEquivalenceCrosswalk } from "../startup-equivalence/crosswalk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Annotates the previously generated inventory; it neither rediscovers startup
 * operations nor upgrades the original crosswalk's UNRESOLVED classifications.
 * This is a scope record, not an equivalence approval or migration receipt.
 */
export function supportedCoverage(archivePath: string) {
  const bytes = readFileSync(archivePath);
  const crosswalk = JSON.parse(bytes.toString("utf8")) as StartupEquivalenceCrosswalk;
  if (crosswalk.operations.length !== 1569 || crosswalk.owners.length !== 8) {
    throw new Error("Unexpected archived crosswalk; review its provenance before annotating it");
  }
  for (const [file, expected] of Object.entries(crosswalk.sourcePin.ownerSourceChecksums)) {
    const actual = createHash("sha256").update(readFileSync(resolve(ROOT, file))).digest("hex");
    if (actual !== expected) throw new Error(`Archived source pin no longer matches ${file}`);
  }
  const referenceLines = new Set([642, 2182, 2359, 2422, 3132, 3331, 4045, 4440]);
  const subscriptionLines = new Set([4605, 4612, 4617, 4620, 4633, 4637, 4638, 4644]);
  const operations = crosswalk.operations
    .filter((operation) => operation.classification !== "schema-ddl")
    .map((operation) => {
      const { source } = operation;
      const line = source.sourcePosition.line;
      const sourceFile = source.path.replace(/:\d+(?::\d+)?$/u, "");
      const businessGrowth = sourceFile === "artifacts/api-server/src/lib/business-growth-schema.ts";
      let scope = "UNRESOLVED_NO_EQUIVALENCE_CLAIM";
      if (businessGrowth && referenceLines.has(line)) scope = "GUARDED_REFERENCE_SUBSET";
      else if (businessGrowth && line === 4628) scope = "EXACT_UNREFERENCED_FALLBACK_SUBSET";
      else if (businessGrowth && subscriptionLines.has(line)) scope = "HISTORICAL_RELATIONSHIPS_REFUSED";
      else if (businessGrowth && line === 4384) scope = "PROVEN_EMPTY_CLEANUP_CANDIDATES_ONLY";
      else if (businessGrowth && line === 5145) scope = "ROLLOUT_COMPLETION_NOT_WRITTEN";
      else if (source.exactSql?.includes("prevent_education_gift_voucher_snapshot_update")) {
        scope = "TWO_PINNED_CATALOG_VARIANTS_CONVERGE";
      }
      return {
        id: operation.id,
        owner: operation.owner,
        classification: operation.classification,
        source: { path: source.path, line, checksum: source.sourceChecksum },
        scope,
        equivalence: "NOT_GLOBALLY_PROVEN",
      };
    });
  return {
    schemaMigration: "000002",
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    inventoryRepeated: false,
    originalOperationCount: crosswalk.operations.length,
    additionalOperationCount: operations.length,
    historicalOperationCount: operations.filter((operation) => operation.classification === "historical-backfill").length,
    overallEquivalence: "BLOCKED",
    eligibilityImplementation: "scripts/src/migrations/supported-state.ts",
    executableProofSuite: "scripts/src/migrations/supported-state.integration.test.ts",
    warning: "This annotation records scope only. Test results are reported separately. Empty inputs do not prove populated historical transitions.",
    operations,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [archive, output] = process.argv.slice(2);
  if (!archive || !output) throw new Error("Usage: supported-coverage.ts <existing-crosswalk.json> <output.json>");
  writeFileSync(output, `${JSON.stringify(supportedCoverage(archive), null, 2)}\n`);
}