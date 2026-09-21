import assert from "node:assert/strict";
import test from "node:test";
import { migrationReadinessContract } from "@workspace/db/migration-runtime";
import { loadMigrations } from "./files";
import { MIGRATION_MANIFEST } from "./manifest";

test("shared readonly readiness pins match the loaded immutable migration manifest", async () => {
  const baseline = MIGRATION_MANIFEST.find((entry) => entry.id === "000001");
  const data = MIGRATION_MANIFEST.find((entry) => entry.id === "000002");
  const loaded = await loadMigrations();
  const loadedBaseline = loaded.find((entry) => entry.id === "000001");
  const loadedData = loaded.find((entry) => entry.id === "000002");
  const head = loaded.at(-1)!;
  assert.equal(head.id, "000003");
  assert.equal(head.checksum, migrationReadinessContract.salonEntranceMigrationChecksum);
  assert.equal(head.structuralFingerprint, migrationReadinessContract.headStructuralFingerprint);
  assert.equal(head.physicalFingerprint, migrationReadinessContract.headPhysicalFingerprint);
  assert.equal(head.normalizedObjectCount, migrationReadinessContract.headNormalizedObjectCount);
  assert.ok(baseline);
  assert.ok(data);
  assert.ok(loadedBaseline);
  assert.ok(loadedData);
  assert.equal(baseline.checksum, migrationReadinessContract.baselineChecksum);
  assert.equal(data.checksum, migrationReadinessContract.supportedStartupMigrationChecksum);
  assert.equal(loadedBaseline.checksum, migrationReadinessContract.baselineChecksum);
  assert.equal(loadedData.checksum, migrationReadinessContract.supportedStartupMigrationChecksum);
  assert.equal(loadedBaseline.structuralFingerprint, migrationReadinessContract.structuralFingerprint);
  assert.equal(loadedBaseline.physicalFingerprint, migrationReadinessContract.physicalFingerprint);
  assert.equal(loadedBaseline.fingerprintVersion, 4);
  assert.equal(loadedBaseline.formatVersion, 2);
  assert.equal(loadedBaseline.postgresMajor, 16);
  assert.equal(loadedBaseline.postgresVersionNum, 160010);
  assert.equal(loadedBaseline.normalizedObjectCount, 5060);
  assert.equal(loadedBaseline.enumCount, 103);
  assert.equal(loadedBaseline.triggerCount, 24);
  assert.equal(loadedBaseline.functionCount, 21);
  assert.deepEqual(
    migrationReadinessContract.requiredMigrationIds,
    loaded.map((entry) => entry.id),
  );
});