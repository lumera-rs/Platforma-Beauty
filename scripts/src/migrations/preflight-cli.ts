import pg from "pg";
import { readFile } from "node:fs/promises";
import { loadMigrations } from "./files";
import { preflightBaselineAdoption, serializePreflightEvidence } from "./preflight";

export function parsePreflightOptions(argv: readonly string[]): { databaseUrlFile: string } {
  const allowed = new Set(["--confirm-preflight"]);
  const fileArguments = argv.filter((item) => item.startsWith("--database-url-file="));
  for (const item of argv) {
    if (!allowed.has(item) && !item.startsWith("--database-url-file=")) {
      throw new Error("Usage: migrations:preflight-adoption --database-url-file=PATH --confirm-preflight");
    }
  }
  if (fileArguments.length !== 1 || !fileArguments[0]!.slice("--database-url-file=".length).trim()) {
    throw new Error("Production adoption preflight requires exactly one explicit --database-url-file target");
  }
  if (!argv.includes("--confirm-preflight")) {
    throw new Error("Production adoption preflight requires --confirm-preflight");
  }
  return { databaseUrlFile: fileArguments[0]!.slice("--database-url-file=".length) };
}

export function redactPreflightError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/^(?:Usage:|Production adoption preflight requires)/u.test(text)) return text;
  return "Preflight failed; connection details were withheld";
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { databaseUrlFile } = parsePreflightOptions(argv);
  const databaseUrl = (await readFile(databaseUrlFile, "utf8")).trim();
  if (!databaseUrl) throw new Error("Empty preflight target file");
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const client = await pool.connect();
    try {
      const report = await preflightBaselineAdoption(client, await loadMigrations());
      process.stdout.write(serializePreflightEvidence(report));
      if (report.readiness !== "READY") process.exitCode = 2;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("/migrations/preflight-cli.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`Migration preflight failed: ${redactPreflightError(error)}\n`);
    process.exitCode = 3;
  });
}