import pg from "pg";
import { readFile } from "node:fs/promises";
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
import { adoptKnownLegacyBaseline } from "./adoption";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const manifestArgument = process.argv.find((value) => value.startsWith("--eligibility-manifest="));
  const manifestPath = manifestArgument?.slice("--eligibility-manifest=".length);
  if (!manifestPath) throw new Error("--eligibility-manifest is required");
  const adoptionArgument = process.argv.find((value) => value.startsWith("--adopt-known-legacy="));
  const expectedId = adoptionArgument?.slice("--adopt-known-legacy=".length);
  const actor = process.argv.find((value) => value.startsWith("--adoption-actor="))
    ?.slice("--adoption-actor=".length);
  if (adoptionArgument && (!expectedId || !actor)) {
    throw new Error("Adoption requires a legacy id and --adoption-actor");
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const client = await pool.connect();
    try {
      const manifestBytes = await readFile(manifestPath, "utf8");
      if (expectedId && actor) {
        const result = await adoptKnownLegacyBaseline(client, { expectedId, actor, manifestBytes });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      await beginFingerprintTransaction(client);
      const readOnly = readOnlyQueryLayer(client);
      const compatibility = await readPostgresFingerprintCompatibility(readOnly);
      const live = fingerprintSnapshot(
        await readPostgresSnapshot(readOnly), ownershipExceptions, compatibility,
      );
      await client.query("COMMIT");
      const manifest = JSON.parse(manifestBytes) as BaselineEligibilityManifest;
      process.stdout.write(serializeBaselineEligibility(classifyBaselineEligibility(live, manifest)));
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
  process.stderr.write(`Baseline eligibility/adoption failed: ${
    error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});