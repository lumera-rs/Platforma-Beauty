import pg from "pg";
import { readPostgresSnapshot } from "./schema-drift/catalog";
import { fingerprintSnapshot, serializeFingerprint } from "./schema-drift/fingerprint";
import { beginFingerprintTransaction } from "./schema-drift/fingerprint-transaction";
import { ownershipExceptions } from "./schema-drift/ownership";
import { readOnlyQueryLayer } from "./schema-drift/read-only-query";

const { Pool } = pg;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
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
      process.stdout.write(serializeFingerprint(result));
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