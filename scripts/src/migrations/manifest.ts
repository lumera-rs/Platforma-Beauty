import type { MigrationManifestEntry } from "./types";
import { supportedStartupMigration } from "./supported-state-contract";

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
    structuralFingerprint: "938c62183adabae9fdab00c5d968c39feb3f216e521b9031d1642575f5875cad",
    physicalFingerprint: "673f3810d49a4be6899482d44281607dac06d3e1012cd001e8348a45fdf5ea1f",
    fingerprintVersion: 4,
    formatVersion: 2,
    postgresMajor: 16,
    postgresVersionNum: 160010,
    normalizedObjectCount: 5060,
    enumCount: 103,
    triggerCount: 24,
    functionCount: 21,
  },
  supportedStartupMigration,
  {
    id: "000003",
    directory: "000003_public_salon_entrance_details",
    checksum: "9bc21ec9bb74182314b498a91c606445d6564d7b070da4f04a22a43b195395c5",
    mode: "transactional",
    description: "Add optional public salon entrance details",
    structuralFingerprint: "4c65ef9a278fb7a41c2830e3c2c51f2d8f7abee08dadcc076fd4c17ddf255b98",
    physicalFingerprint: "39821cf3d682003a804326fa279eed957720f3a4b1458622bf91678abe1d824a",
    fingerprintVersion: 4,
    formatVersion: 2,
    postgresMajor: 16,
    postgresVersionNum: 160010,
    normalizedObjectCount: 5064,
    enumCount: 103,
    triggerCount: 24,
    functionCount: 21,
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