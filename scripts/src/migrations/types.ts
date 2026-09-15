import type { DatabaseClient } from "../backend-standards-database";

export type MigrationMode = "transactional" | "nontransactional";
export type MigrationState = "APPLYING" | "APPLIED" | "FAILED" | "ADOPTED";

export interface MigrationManifestEntry {
  readonly id: string;
  readonly directory: string;
  readonly checksum: string;
  readonly mode: MigrationMode;
  readonly description: string;
  readonly structuralFingerprint: string;
  readonly physicalFingerprint: string;
  readonly fingerprintVersion: number;
  readonly formatVersion: number;
  readonly postgresMajor: number;
  readonly postgresVersionNum: number;
  readonly normalizedObjectCount: number;
  readonly enumCount: number;
  readonly triggerCount: number;
  readonly functionCount: number;
}

export interface LoadedMigration extends MigrationManifestEntry {
  readonly sql: string;
  readonly body: string;
  readonly preconditions: readonly string[];
  readonly postconditions: readonly string[];
  readonly recovery: string;
}

export interface MigrationLedgerRow {
  readonly id: string;
  readonly checksum: string;
  readonly mode: MigrationMode;
  readonly state: MigrationState;
  readonly error: string | null;
}

export interface MigrationRunResult {
  readonly applied: string[];
  readonly skipped: string[];
}

export interface MigrationRunnerOptions {
  readonly lockTimeoutMs?: number;
  readonly lockPollMs?: number;
  readonly migrations?: readonly LoadedMigration[];
  readonly now?: () => Date;
}

export type MigrationDatabaseClient = DatabaseClient & {
  release?: () => void;
};