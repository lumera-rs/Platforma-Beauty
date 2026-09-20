/**
 * Authenticated historical startup inventory.
 *
 * The reviewed Git source is an input, never a baseline authority. Owners,
 * startup entrypoint, dependencies and package exports all come from the same
 * authenticated revision. Current startup/removal/readiness gates stay separate.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkProductionStartupDdlInventory,
  EXPECTED_STARTUP_DDL_ROOTS,
  type StartupDdlBaseline,
  type StartupDdlInventoryReport,
} from "./production-startup-ddl-inventory";
import { loadReviewedHistoricalSources } from "./reviewed-historical-source";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export type HistoricalInventoryIssue =
  | "changedSQL"
  | "multiplicityChanged"
  | "wrongExecutionOrder"
  | "missingOwner"
  | "newOwner"
  | "changedOwner"
  | "missingDependency"
  | "newDependency"
  | "unknownEdge"
  | "advisoryLockBoundary";

export interface HistoricalInventoryDiagnostic {
  readonly issue: HistoricalInventoryIssue;
  readonly owner?: string;
  readonly module: string;
  readonly detail: string;
  readonly position?: string;
}

export interface HistoricalStartupDdlInventoryReport {
  readonly authenticatedSourceSha256: string;
  readonly historical: StartupDdlInventoryReport;
  readonly baseline: StartupDdlBaseline;
  readonly diagnostics: readonly HistoricalInventoryDiagnostic[];
  readonly counts: {
    readonly owners: number;
    readonly operations: number;
    readonly modules: number;
    readonly dependencies: number;
  };
}

interface BaselineFile {
  readonly version: 1;
  readonly startupRoot: string;
  readonly owners: readonly HistoricalStartupDdlInventoryReport["baseline"]["owners"][number][];
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function positionOf(source: string, needle: string): string | undefined {
  const index = source.indexOf(needle);
  if (index < 0) return undefined;
  const line = source.slice(0, index).split("\n").length;
  const column = index - source.lastIndexOf("\n", index - 1);
  return `${line}:${column}`;
}

export function validateAdvisoryLockBoundaries(
  source: string,
  module: string,
  owner: string,
): HistoricalInventoryDiagnostic[] {
  const start = source.search(new RegExp(`(?:async\\s+)?function\\s+${owner}\\b`, "u"));
  if (start < 0) return [];
  const open = source.indexOf("{", start);
  if (open < 0) return [];
  let depth = 0;
  let close = open;
  for (; close < source.length; close += 1) {
    if (source[close] === "{") depth += 1;
    else if (source[close] === "}" && --depth === 0) break;
  }
  const body = source.slice(open + 1, close);
  const locks = [...body.matchAll(/pg_advisory_lock(?!\w)/giu)].map((match) => match.index!);
  const unlocks = [...body.matchAll(/pg_advisory_unlock(?!\w)/giu)].map((match) => match.index!);
  if (locks.length === 0 && unlocks.length === 0) return [];
  const ddl = [...body.matchAll(/(?:query|execute)\s*\(\s*[`"']\s*(?:CREATE|ALTER|DROP)\s+/giu)].map((match) => match.index!);
  const lock = locks[0] ?? -1;
  const unlock = unlocks[0] ?? -1;
  const invalid = locks.length !== 1 || unlocks.length !== 1 || lock < 0 || unlock <= lock
    || ddl.some((position) => position <= lock || position >= unlock);
  if (invalid) {
    return [{
      issue: "advisoryLockBoundary",
      owner,
      module,
      detail: "DDL is not wholly between advisory-lock and advisory-unlock boundaries.",
      position: positionOf(source, ddl.length > 0 ? (body.slice(ddl[0]).match(/\b(?:CREATE|ALTER|DROP)\s+/iu)?.[0] ?? "") : (body.match(/pg_advisory_lock/iu)?.[0] ?? "")),
    }];
  }
  return [];
}

export function compareHistoricalInventory(
  historical: StartupDdlInventoryReport,
  current: StartupDdlInventoryReport,
  sources: ReadonlyMap<string, string>,
): HistoricalInventoryDiagnostic[] {
  const diagnostics: HistoricalInventoryDiagnostic[] = [];
  const oldOwners = new Map(historical.owners.map((owner) => [owner.ensureName, owner]));
  const newOwners = new Map(current.owners.map((owner) => [owner.ensureName, owner]));
  for (const name of EXPECTED_STARTUP_DDL_ROOTS) {
    if (!newOwners.has(name)) diagnostics.push({ issue: "missingOwner", owner: name, module: "artifacts/api-server/src/index.ts", detail: name });
  }
  for (const owner of newOwners.values()) {
    if (!EXPECTED_STARTUP_DDL_ROOTS.includes(owner.ensureName)) {
      diagnostics.push({ issue: "newOwner", owner: owner.ensureName, module: owner.ownerModule, detail: owner.ensureName });
    }
  }
  for (const name of EXPECTED_STARTUP_DDL_ROOTS) {
    const oldOwner = oldOwners.get(name);
    const newOwner = newOwners.get(name);
    if (!oldOwner || !newOwner) continue;
    if (oldOwner.ownerModule !== newOwner.ownerModule) {
      diagnostics.push({ issue: "changedOwner", owner: name, module: newOwner.ownerModule, detail: `${oldOwner.ownerModule} -> ${newOwner.ownerModule}` });
    }
    const identity = (operation: typeof oldOwner.operations[number]): string =>
      `${operation.kind}\0${operation.module}\0${operation.summary}`;
    const oldOps = oldOwner.operations.map((operation) => `${identity(operation)}\0${operation.fingerprint}`);
    const newOps = newOwner.operations.map((operation) => `${identity(operation)}\0${operation.fingerprint}`);
    const counts = (items: readonly string[]): Map<string, number> => {
      const result = new Map<string, number>();
      for (const item of items) result.set(item, (result.get(item) ?? 0) + 1);
      return result;
    };
    const oldCounts = counts(oldOps);
    const newCounts = counts(newOps);
    if (JSON.stringify([...oldCounts].sort()) !== JSON.stringify([...newCounts].sort())) {
      const oldIdentities = counts(oldOwner.operations.map(identity));
      const newIdentities = counts(newOwner.operations.map(identity));
      if (JSON.stringify([...oldIdentities].sort()) !== JSON.stringify([...newIdentities].sort())) {
        diagnostics.push({ issue: "multiplicityChanged", owner: name, module: newOwner.ownerModule, detail: "operation multiplicity changed" });
      } else {
        diagnostics.push({ issue: "changedSQL", owner: name, module: newOwner.ownerModule, detail: "operation fingerprint changed" });
      }
    } else if (oldOps.some((value, index) => value !== newOps[index])) {
      diagnostics.push({ issue: "wrongExecutionOrder", owner: name, module: newOwner.ownerModule, detail: "operation execution order changed" });
    }
    const source = sources.get(newOwner.ownerModule);
    if (source) diagnostics.push(...validateAdvisoryLockBoundaries(source, newOwner.ownerModule, name));
  }
  return diagnostics;
}

export async function checkHistoricalStartupDdlInventory(
  repositoryRoot = ROOT,
): Promise<HistoricalStartupDdlInventoryReport> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "historical-startup-ddl-"));
  try {
    const files = loadReviewedHistoricalSources(repositoryRoot);
    // Materialize authenticated package manifests as well as source: workspace
    // export resolution must not consult today's package manifests either.
    for (const [relative, source] of files) {
      const target = path.join(temporary, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    const virtualSources = new Map(files);
    for (const [relative, source] of files) {
      virtualSources.set(path.join(temporary, relative), source);
    }
    const historical = checkProductionStartupDdlInventory({
      repositoryRoot: temporary,
      moduleSources: virtualSources,
      rootFile: "artifacts/api-server/src/index.ts",
    });
    const expected = JSON.parse(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "production-startup-ddl-baseline.json"), "utf8")) as BaselineFile;
    const baseline: StartupDdlBaseline = { version: 1, startupRoot: expected.startupRoot, owners: expected.owners };
    const expectedReport: StartupDdlInventoryReport = { ...historical, owners: baseline.owners };
    const diagnostics = compareHistoricalInventory(expectedReport, historical, files);
    return {
      authenticatedSourceSha256: digest([...files].sort().map(([name, source]) => `${name}\0${digest(source)}`).join("\n")),
      historical,
      baseline,
      diagnostics,
      counts: {
        owners: historical.owners.length,
        operations: historical.owners.reduce((total, owner) => total + owner.operations.length, 0),
        modules: historical.scannedModules,
        dependencies: historical.scannedReferences,
      },
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await checkHistoricalStartupDdlInventory();
  if (report.historical.violations.length > 0) {
    throw new Error(`Authenticated historical inventory has violations: ${JSON.stringify(report.historical.violations)}`);
  }
  if (process.argv.includes("--write-baseline")) {
    const baseline: StartupDdlBaseline = {
      version: 1,
      startupRoot: report.historical.startupRoot,
      owners: report.historical.owners,
    };
    await writeFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "production-startup-ddl-baseline.json"),
      `${JSON.stringify(baseline, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
}