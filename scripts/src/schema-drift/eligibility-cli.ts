import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  readPostgresFingerprintCompatibility,
  readPostgresSnapshot,
} from "./catalog";
import {
  classifyBaselineEligibility,
  serializeBaselineEligibility,
  type BaselineEligibilityManifest,
} from "./eligibility";
import { fingerprintSnapshot } from "./fingerprint";
import { beginFingerprintTransaction } from "./fingerprint-transaction";
import { ownershipExceptions } from "./ownership";
import { readOnlyQueryLayer } from "./read-only-query";

export const REPOSITORY_BASELINE_MANIFEST_URL = new URL(
  "./baseline-manifest.json",
  import.meta.url,
);

export function validateEligibilityCliArguments(arguments_: readonly string[]): void {
  if (arguments_.length > 0) {
    throw new Error(`Unknown eligibility argument: ${arguments_[0]}`);
  }
}

async function main(): Promise<void> {
  validateEligibilityCliArguments(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const manifestBytes = await readFile(REPOSITORY_BASELINE_MANIFEST_URL, "utf8");
  const manifest = JSON.parse(manifestBytes) as BaselineEligibilityManifest;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await beginFingerprintTransaction(client);
      const readOnly = readOnlyQueryLayer(client);
      const compatibility = await readPostgresFingerprintCompatibility(readOnly);
      const live = fingerprintSnapshot(
        await readPostgresSnapshot(readOnly),
        ownershipExceptions,
        compatibility,
      );
      await client.query("COMMIT");
      process.stdout.write(serializeBaselineEligibility(
        classifyBaselineEligibility(live, manifest),
      ));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

const invokedUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedUrl === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`Baseline eligibility failed: ${
      error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}