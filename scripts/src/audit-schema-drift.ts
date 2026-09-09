import pg from "pg";
import { writeFile } from "node:fs/promises";
import { buildCanonicalSnapshot } from "./schema-drift/canonical";
import { readPostgresSnapshot } from "./schema-drift/catalog";
import { compareSchemas, serializeReport, summarizeReport } from "./schema-drift/compare";
import { ownershipExceptions } from "./schema-drift/ownership";
import { readOnlyQueryLayer } from "./schema-drift/read-only-query";

const { Pool } = pg;

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const outputArgument = process.argv.find((argument) => argument.startsWith("--json-file="));
  const outputFile = outputArgument?.slice("--json-file=".length);
  try {
    const client = await pool.connect();
    let report;
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = '30s'");
      report = compareSchemas(
        buildCanonicalSnapshot(),
        await readPostgresSnapshot(readOnlyQueryLayer(client)),
        ownershipExceptions,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const json = serializeReport(report);
    if (outputFile) await writeFile(outputFile, json, "utf8");
    else process.stdout.write(json);
    process.stderr.write(`${summarizeReport(report)}\n`);
    return report.actionable ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Schema drift audit failed: ${message}\n`);
    process.exitCode = 2;
  },
);