import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  MigrationHeaderError,
  type MigrationMetadata,
  parseMigrationHeader,
} from "./header";

export type { MigrationMetadata, MigrationMode } from "./header";

const DIRECTORY_PATTERN = /^(\d{6})_([a-z][a-z0-9]*(?:_[a-z0-9]+)*)$/;
const GENERIC_PURPOSES = new Set([
  "changes",
  "final",
  "final_fix",
  "fix",
  "new",
  "update",
  "v2",
]);
const GENERIC_PURPOSE_TOKENS = new Set([
  "changes",
  "final",
  "fix",
  "new",
  "update",
]);
const FORBIDDEN_PURPOSE_TOKENS = new Set([
  "branch",
  "issue",
  "main",
  "master",
  "pr",
  "task",
  "ticket",
]);
const DATE_TOKEN_PATTERN = /(?:19|20)\d{2}(?:_?\d{2}){0,2}/;
const TASK_LIKE_PATTERN = /(?:^|_)(?:task|ticket|issue|pr)_?\d+(?:_|$)/;

export interface MigrationRecord {
  directory: string;
  sequence: number;
  purpose: string;
  sha256: string;
  metadata: MigrationMetadata;
}

export interface VerificationResult {
  current: MigrationRecord[];
  reference: MigrationRecord[];
}

export class MigrationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationContractError";
  }
}

export function sha256(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function validateDirectoryName(name: string): { sequence: number; purpose: string } {
  const match = DIRECTORY_PATTERN.exec(name);
  if (!match) {
    throw new MigrationContractError(
      `Invalid migration directory "${name}": expected NNNNNN_lowercase_snake_case`,
    );
  }
  const sequence = Number(match[1]);
  const purpose = match[2]!;
  if (GENERIC_PURPOSES.has(purpose)) {
    throw new MigrationContractError(`Invalid generic migration purpose "${purpose}"`);
  }
  const tokens = purpose.split("_");
  if (tokens.length < 2 || tokens.some((token) => token.length < 2)) {
    throw new MigrationContractError(
      `Migration purpose "${purpose}" must contain at least two descriptive words`,
    );
  }
  if (tokens.some((token) => GENERIC_PURPOSE_TOKENS.has(token) || /^v\d+$/.test(token))) {
    throw new MigrationContractError(`Invalid generic migration purpose "${purpose}"`);
  }
  if (tokens.some((token) => FORBIDDEN_PURPOSE_TOKENS.has(token))
    || TASK_LIKE_PATTERN.test(purpose)) {
    throw new MigrationContractError(`Migration purpose "${purpose}" looks branch/task-like`);
  }
  if (DATE_TOKEN_PATTERN.test(purpose)) {
    throw new MigrationContractError(`Migration purpose "${purpose}" is date-like`);
  }
  return { sequence, purpose };
}

export async function readMigrationSet(root: string): Promise<MigrationRecord[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    throw new MigrationContractError(
      `Migration directory is unavailable: ${root} (${errorMessage(error)})`,
    );
  }

  const records: MigrationRecord[] = [];
  for (const entry of entries) {
    if (entry.name === "README.md" && entry.isFile()) continue;
    if (!entry.isDirectory()) {
      throw new MigrationContractError(`Unexpected migration root entry "${entry.name}"`);
    }
    const { sequence, purpose } = validateDirectoryName(entry.name);
    const directory = path.join(root, entry.name);
    const children = await readdir(directory, { withFileTypes: true });
    if (children.length !== 1 || children[0]?.name !== "migration.sql" || !children[0].isFile()) {
      throw new MigrationContractError(
        `Migration "${entry.name}" must contain exactly one regular migration.sql file`,
      );
    }
    const sqlPath = path.join(directory, "migration.sql");
    const fileInfo = await lstat(sqlPath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      throw new MigrationContractError(
        `Migration "${entry.name}" migration.sql must be a regular non-symlink file`,
      );
    }
    const contents = await readFile(sqlPath);
    let metadata: MigrationMetadata;
    try {
      metadata = parseMigrationHeader(contents, entry.name.slice(0, 6));
    } catch (error) {
      if (!(error instanceof MigrationHeaderError)) throw error;
      throw new MigrationContractError(`Migration "${entry.name}": ${error.message}`);
    }
    records.push({
      directory: entry.name,
      sequence,
      purpose,
      sha256: sha256(contents),
      metadata,
    });
  }

  records.sort((left, right) =>
    left.sequence - right.sequence || left.directory.localeCompare(right.directory));
  validateSequence(records);
  return records;
}

export function validateSequence(records: MigrationRecord[]): void {
  const seen = new Set<number>();
  for (const [index, record] of records.entries()) {
    if (seen.has(record.sequence)) {
      throw new MigrationContractError(
        `Duplicate or reused migration sequence ${formatSequence(record.sequence)}`,
      );
    }
    seen.add(record.sequence);
    const expected = index + 1;
    if (record.sequence !== expected) {
      throw new MigrationContractError(
        `Migration sequence gap: expected ${formatSequence(expected)}, found ${formatSequence(record.sequence)}`,
      );
    }
  }
}

export function compareWithReference(
  current: MigrationRecord[],
  reference: MigrationRecord[],
): void {
  const currentBySequence = new Map(current.map((record) => [record.sequence, record]));
  for (const historical of reference) {
    const candidate = currentBySequence.get(historical.sequence);
    if (!candidate) {
      throw new MigrationContractError(
        `Historical migration removed: ${historical.directory}`,
      );
    }
    if (candidate.directory !== historical.directory) {
      throw new MigrationContractError(
        `Historical migration renamed or sequence reused: ${historical.directory} -> ${candidate.directory}`,
      );
    }
    if (candidate.sha256 !== historical.sha256) {
      throw new MigrationContractError(
        `Historical migration edited or replaced: ${historical.directory}`,
      );
    }
  }
}

export async function verifyMigrationContract(
  currentRoot: string,
  referenceRoot: string,
): Promise<VerificationResult> {
  const [currentPhysicalRoot, referencePhysicalRoot] = await Promise.all([
    physicalRoot(currentRoot, "current"),
    physicalRoot(referenceRoot, "reference"),
  ]);
  if (currentPhysicalRoot === referencePhysicalRoot) {
    throw new MigrationContractError(
      "Current and reference migration directories must be independent physical directories",
    );
  }
  const [current, reference] = await Promise.all([
    readMigrationSet(currentPhysicalRoot),
    readMigrationSet(referencePhysicalRoot),
  ]);
  compareWithReference(current, reference);
  return { current, reference };
}

function formatSequence(sequence: number): string {
  return String(sequence).padStart(6, "0");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function physicalRoot(root: string, role: "current" | "reference"): Promise<string> {
  try {
    return await realpath(root);
  } catch (error) {
    throw new MigrationContractError(
      `${role[0]!.toUpperCase()}${role.slice(1)} migration directory is unavailable: `
      + `${root} (${errorMessage(error)})`,
    );
  }
}