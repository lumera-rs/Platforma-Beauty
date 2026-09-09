import pg from "pg";
import { readFile } from "node:fs/promises";
import {
  readPostgresFingerprintCompatibility,
  readPostgresSnapshot,
} from "./schema-drift/catalog";
import {
  classifyBaselineEligibility,
  serializeBaselineEligibility,
  type BaselineEligibilityManifest,
} from "./schema-drift/eligibility";
import { fingerprintSnapshot, serializeFingerprint } from "./schema-drift/fingerprint";
import { beginFingerprintTransaction } from "./schema-drift/fingerprint-transaction";
import { ownershipExceptions } from "./schema-drift/ownership";
import { readOnlyQueryLayer } from "./schema-drift/read-only-query";
import { adoptKnownLegacyBaseline } from "./schema-drift/adoption";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const manifestArgument = process.argv.find((argument) =>
    argument.startsWith("--eligibility-manifest="));
  const manifestPath = manifestArgument?.slice("--eligibility-manifest=".length);
  if (manifestArgument && !manifestPath) throw new Error("Eligibility manifest path is required");
  const adoptionArgument = process.argv.find((argument) =>
    argument.startsWith("--adopt-known-legacy="));
  const expectedId = adoptionArgument?.slice("--adopt-known-legacy=".length);
  const actorArgument = process.argv.find((argument) => argument.startsWith("--adoption-actor="));
  const actor = actorArgument?.slice("--adoption-actor=".length);
  if (adoptionArgument && !expectedId) throw new Error("Expected legacy fingerprint id is required");
  if (adoptionArgument && !manifestPath) throw new Error("Adoption requires --eligibility-manifest");
  if (adoptionArgument && !actor) throw new Error("Adoption requires --adoption-actor");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const client = await pool.connect();
    try {
      if (expectedId && actor && manifestPath) {
        const manifestBytes = await readFile(manifestPath, "utf8");
        const adoption = await adoptKnownLegacyBaseline(client, {
          expectedId,
          actor,
          manifestBytes,
        });
        process.stdout.write(`${JSON.stringify(adoption, null, 2)}\n`);
        process.stderr.write(
          `Baseline adoption: ${adoption.outcome}; expected id ${adoption.expectedId}.\n`,
        );
        return;
      }
      await beginFingerprintTransaction(client);
      const readOnlyClient = readOnlyQueryLayer(client);
      const postgresCompatibility = await readPostgresFingerprintCompatibility(readOnlyClient);
      const result = fingerprintSnapshot(
        await readPostgresSnapshot(readOnlyClient),
        ownershipExceptions,
        postgresCompatibility,
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
