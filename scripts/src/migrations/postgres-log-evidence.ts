import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface PostgresLogSettings {
  readonly databaseName: string;
  readonly logStatement: string;
  readonly logLinePrefix: string;
  readonly logDestination: string;
  readonly logMinMessages: string;
}

export interface ParsedPostgresLogEntry {
  readonly databaseName: string;
  readonly statement: string;
  readonly line: number;
}

export interface ProofOutput {
  readonly directory: string;
  readonly regeneratesVersionedEvidence: boolean;
}

const versionedEvidenceRelativePath = "docs/startup-ddl-equivalence/evidence";

function exactPath(value: string): string {
  return path.resolve(value);
}

function isWithin(directory: string, parent: string): boolean {
  const relative = path.relative(parent, directory);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function argumentValue(argv: readonly string[], name: string): string | undefined {
  const value = argv.find((item) => item.startsWith(`${name}=`));
  return value?.slice(name.length + 1);
}

export function proofOutputFromArgs(
  argv: readonly string[],
  workspaceRoot: string,
): ProofOutput {
  const evidenceArgument = argumentValue(argv, "--evidence-dir");
  const regenerate = argv.includes("--regenerate-versioned-evidence");
  const versionedDirectory = exactPath(path.join(workspaceRoot, versionedEvidenceRelativePath));

  assert.ok(
    !(evidenceArgument && regenerate),
    "Use either --evidence-dir for external output or --regenerate-versioned-evidence, not both.",
  );
  if (regenerate) {
    return { directory: versionedDirectory, regeneratesVersionedEvidence: true };
  }

  const directory = exactPath(evidenceArgument
    ? path.resolve(workspaceRoot, evidenceArgument)
    : path.join(workspaceRoot, ".local/startup-ddl-equivalence-evidence/supported-path-boot"));
  assert.ok(
    !isWithin(directory, versionedDirectory),
    "Refusing to overwrite versioned evidence without --regenerate-versioned-evidence.",
  );
  const localDirectory = exactPath(path.join(workspaceRoot, ".local"));
  assert.ok(
    !isWithin(directory, exactPath(workspaceRoot)) || isWithin(directory, localDirectory),
    "--evidence-dir must be outside the workspace or inside ignored .local/ unless --regenerate-versioned-evidence is supplied.",
  );
  return { directory, regeneratesVersionedEvidence: false };
}

async function canonicalCandidate(directory: string): Promise<string> {
  const absentSegments: string[] = [];
  let existingParent = directory;
  while (true) {
    try {
      await fs.lstat(existingParent);
      break;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(existingParent);
      assert.notEqual(parent, existingParent, `Could not locate an existing parent for evidence directory ${directory}.`);
      absentSegments.unshift(path.basename(existingParent));
      existingParent = parent;
    }
  }
  return path.join(await fs.realpath(existingParent), ...absentSegments);
}

/**
 * Lexical path checks are insufficient: an ignored-looking .local path may be
 * a symlink into versioned source. Check the actual existing parent before any
 * output directory is created.
 */
export async function assertProofOutputDirectorySafe(
  output: ProofOutput,
  workspaceRoot: string,
): Promise<void> {
  if (output.regeneratesVersionedEvidence) return;
  const [candidate, canonicalWorkspace] = await Promise.all([
    canonicalCandidate(output.directory),
    fs.realpath(workspaceRoot),
  ]);
  const canonicalLocal = path.join(canonicalWorkspace, ".local");
  assert.ok(
    !isWithin(candidate, canonicalWorkspace) || isWithin(candidate, canonicalLocal),
    "Refusing evidence output whose canonical path escapes ignored .local/ into the workspace.",
  );
}

/**
 * The supported proof consumes plain stderr-format PostgreSQL logs. Requiring
 * a literal db=%d prefix makes every statement attributable to the disposable
 * child and deliberately rejects an otherwise plausible but untagged file.
 */
export function assertPostgresLogSettings(
  settings: PostgresLogSettings,
  expectedDatabase: string,
): void {
  assert.equal(settings.databaseName, expectedDatabase, "Log settings were not read from the owned child database.");
  assert.match(
    settings.logStatement.trim().toLowerCase(),
    /^(?:ddl|mod|all)$/,
    "PostgreSQL log_statement must log DDL (ddl, mod, or all).",
  );
  assert.match(
    settings.logLinePrefix,
    /(?:^|[^%])db=%d/,
    "PostgreSQL log_line_prefix must include the literal database tag db=%d.",
  );
  assert.match(
    settings.logDestination,
    /(?:^|,)\s*stderr\s*(?:,|$)/i,
    "PostgreSQL log_destination must include stderr for the supplied text log.",
  );
}

function databaseTag(line: string): string | undefined {
  return /(?:^|[\s,])db=([^\s,]+)/u.exec(line)?.[1];
}

/**
 * Parse statement records while retaining untagged continuation lines. Both
 * simple-query "statement:" records and extended-protocol parse/execute
 * records can carry SQL. A multi-line statement normally has the PostgreSQL
 * prefix on its first line only, so line-based grep can otherwise miss DDL on
 * a later line.
 */
export function parsePostgresLogEntries(log: string): ParsedPostgresLogEntry[] {
  assert.ok(log.length > 0, "PostgreSQL log is empty; it cannot prove zero startup DDL.");
  assert.ok(!log.includes("\u0000"), "PostgreSQL log contains a NUL byte and is malformed.");
  assert.ok(log.endsWith("\n"), "PostgreSQL log ends mid-record and may be truncated.");

  const entries: Array<{ databaseName: string; statement: string; line: number }> = [];
  let current: { databaseName: string; statement: string; line: number } | undefined;
  for (const [offset, line] of log.slice(0, -1).split("\n").entries()) {
    const tag = databaseTag(line);
    const statement = (/\bLOG:\s*(?:statement|(?:parse|execute)\s+[^:]+):\s*(.*)$/su.exec(line)
      ?? /\bSTATEMENT:\s*(.*)$/su.exec(line))?.[1];
    if (statement === undefined && /\bstatement:/iu.test(line)) {
      throw new Error(`PostgreSQL statement log line ${offset + 1} has an unsupported or malformed format.`);
    }
    if (statement !== undefined) {
      assert.ok(tag, `PostgreSQL statement log line ${offset + 1} is missing a database tag.`);
      current = { databaseName: tag, statement, line: offset + 1 };
      entries.push(current);
      continue;
    }
    if (tag) {
      assert.match(
        line,
        /\b(?:DEBUG[1-5]?|LOG|INFO|NOTICE|WARNING|ERROR|FATAL|PANIC|DETAIL|HINT|CONTEXT|STATEMENT|LOCATION):/u,
        `Database-tagged PostgreSQL log line ${offset + 1} is malformed.`,
      );
      current = undefined;
      continue;
    }
    if (current) current.statement += `\n${line}`;
  }
  return entries;
}

export function assertProbeLogged(
  log: string,
  databaseName: string,
  probeTable: string,
): ParsedPostgresLogEntry[] {
  const entries = parsePostgresLogEntries(log);
  const ownEntries = entries.filter((entry) => entry.databaseName === databaseName
    && entry.statement.includes(probeTable));
  assert.ok(
    ownEntries.some((entry) => /\bCREATE\s+TABLE\b/isu.test(entry.statement)),
    `Missing database-tagged CREATE probe for ${databaseName}; log may be stale, cross-database-only, or not live.`,
  );
  assert.ok(
    ownEntries.some((entry) => /\bDROP\s+TABLE\b/isu.test(entry.statement)),
    `Missing database-tagged DROP probe for ${databaseName}; log may be stale, cross-database-only, or not flushed.`,
  );
  return entries;
}

export function assertNoDdlInBootWindow(
  log: string,
  databaseName: string,
  excludedProbeTable: string,
): void {
  const entries = parsePostgresLogEntries(log);
  const bootDdl = entries.filter((entry) => entry.databaseName === databaseName
    && !entry.statement.includes(excludedProbeTable)
    && /\b(?:CREATE|ALTER|DROP|TRUNCATE)\b/isu.test(entry.statement));
  assert.equal(
    bootDdl.length,
    0,
    `Actual entrypoint performed startup DDL:\n${bootDdl.map((entry) => entry.statement).join("\n---\n")}`,
  );
}