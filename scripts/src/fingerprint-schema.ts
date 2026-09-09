import pg from "pg";
import { readFile } from "node:fs/promises";
import { readPostgresSnapshot } from "./schema-drift/catalog";
import {
  classifyBaselineEligibility,
  serializeBaselineEligibility,
  type BaselineEligibilityManifest,
} from "./schema-drift/eligibility";
import { fingerprintSnapshot, serializeFingerprint } from "./schema-drift/fingerprint";
import { beginFingerprintTransaction } from "./schema-drift/fingerprint-transaction";
import { ownershipExceptions } from "./schema-drift/ownership";
import { readOnlyQueryLayer } from "./schema-drift/read-only-query";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const manifestArgument = process.argv.find((argument) =>
    argument.startsWith("--eligibility-manifest="));
  const manifestPath = manifestArgument?.slice("--eligibility-manifest=".length);
  if (manifestArgument && !manifestPath) throw new Error("Eligibility manifest path is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await beginFingerprintTransaction(client);
       const result = fingerprintSnapshot(
        await readPostgresSnapshot(readOnlyQueryLayer(client)),
        ownershipExceptions,
      );
      await client.query("COMMIT");
       if (manifestPath) {
         const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BaselineEligibilityManifest;
         const eligibility = classifyBaselineEligibility(result, manifest);
         process.stdout.write(serializeBaselineEligibility(eligibility));
         process.stderr.write(
           `Baseline eligibility: ${eligibility.code}; metadata adoption `
           + `${eligibility.eligibleForMetadataAdoption ? "allowed" : "refused"}.\n`,
         );
       } else {
         process.stdout.write(serializeFingerprint(result));
       }
      process.stderr.write(
        `Schema fingerprint: ${result.normalizedObjectCount} normalized object(s), `
        + `${result.ownershipExceptions.length} ownership exception(s) excluded.\n`,
      );
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Schema fingerprint failed: ${message}\n`);
  process.exitCode = 2;
});