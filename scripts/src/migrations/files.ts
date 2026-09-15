import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMigrationHeader } from "../migration-contract/header";
import { MIGRATION_MANIFEST, assertManifestOrder } from "./manifest";
import type { LoadedMigration, MigrationManifestEntry } from "./types";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DEFAULT_MIGRATIONS_DIRECTORY = path.join(REPOSITORY_ROOT, "lib/db/migrations");

export async function loadMigration(
  entry: MigrationManifestEntry,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
): Promise<LoadedMigration> {
  const filePath = path.join(migrationsDirectory, entry.directory, "migration.sql");
  let bytes: Uint8Array;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new Error(`Migration file is missing or unreadable: ${entry.id}`);
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== entry.checksum) {
    throw new Error(`Migration checksum mismatch for ${entry.id}: expected ${entry.checksum}, got ${checksum}`);
  }
  const sql = Buffer.from(bytes).toString("utf8");
  const metadata = parseMigrationHeader(bytes, entry.id);
  if (metadata.mode !== entry.mode || metadata.description !== entry.description) {
    throw new Error(`Migration manifest metadata mismatch for ${entry.id}`);
  }
  return {
    ...entry,
    sql,
    body: metadata.sqlBody,
    preconditions: metadata.preconditions,
    postconditions: metadata.postconditions,
    recovery: metadata.recovery,
  };
}

export async function loadMigrations(
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
  manifest: readonly MigrationManifestEntry[] = MIGRATION_MANIFEST,
): Promise<LoadedMigration[]> {
  assertManifestOrder(manifest);
  const migrations: LoadedMigration[] = [];
  for (const entry of manifest) migrations.push(await loadMigration(entry, migrationsDirectory));
  return migrations;
}