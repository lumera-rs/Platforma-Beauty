import pg from "pg";
import { buildCanonicalSnapshot } from "./schema-drift/canonical";
import { readPostgresSnapshot } from "./schema-drift/catalog";
import { compareSchemas, serializeReport, summarizeReport } from "./schema-drift/compare";
import { ownershipExceptions } from "./schema-drift/ownership";

const { Pool } = pg;

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const readOnlyClient = {
      async query(text: string, values?: unknown[]) {
        if (!/^\s*(?:SELECT|WITH)\b/i.test(text)) {
          throw new Error("Schema audit refused a non-read-only SQL statement");
        }
        return pool.query(text, values);
      },
    };
    const report = compareSchemas(
      buildCanonicalSnapshot(),
      await readPostgresSnapshot(readOnlyClient),
      ownershipExceptions,
    );
    process.stdout.write(serializeReport(report));
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