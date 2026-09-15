import type { MigrationManifestEntry } from "./types";

/**
 * The manifest is deliberately explicit. Filesystem enumeration must never
 * decide which SQL is production migration history.
 */
export const MIGRATION_MANIFEST: readonly MigrationManifestEntry[] = Object.freeze([
  {
    id: "000001",
    directory: "000001_canonical_schema",
    checksum: "643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60",
    mode: "transactional",
    description: "Establish the canonical Lumera schema baseline",
    structuralFingerprint: "b1a8856db289291fee1048c50fbda64a5a6db5c5587bee9cc270b3bb1e62b09e",
    physicalFingerprint: "b0b0e4b73e7bdf710008f8b7de1a1f9c5b9c8fc4962765f0d1c22bb1ed0b7baa",
    fingerprintVersion: 3,
    formatVersion: 2,
    postgresMajor: 16,
    postgresVersionNum: 160010,
    normalizedObjectCount: 5039,
    enumCount: 103,
    triggerCount: 24,
  },
]);

export function assertManifestOrder(
  manifest: readonly MigrationManifestEntry[] = MIGRATION_MANIFEST,
): void {
  let expected = 1;
  for (const entry of manifest) {
    if (entry.id !== String(expected).padStart(6, "0")) {
      throw new Error(`Migration manifest has a numbering gap or unexpected ID: ${entry.id}`);
    }
    if (!/^\d{6}$/.test(entry.id) || !/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(entry.directory)
      || !entry.directory.startsWith(`${entry.id}_`)) {
      throw new Error(`Migration manifest has an invalid directory: ${entry.directory}`);
    }
    expected += 1;
  }
}