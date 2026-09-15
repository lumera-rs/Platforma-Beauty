import pg from "pg";
import { adoptBaseline, applyMigrations, migrationStatus } from "./runner";
import { loadMigrations } from "./files";

function argument(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = argv.find((item) => item.startsWith(prefix));
  return value?.slice(prefix.length);
}

function usage(): never {
  throw new Error(
    "Usage: migrations <status|apply|adopt-baseline> "
    + "[--database-url=DATABASE_URL] [--confirm]",
  );
}

function hasConfirmation(argv: readonly string[]): boolean {
  return argv.some((item) => item === "--confirm" || item === "--confirm=true" || item === "--confirm=yes");
}

export interface MigrationCliOptions {
  readonly command: "status" | "apply" | "adopt-baseline";
  readonly databaseUrl: string;
}

export function parseMigrationCliOptions(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): MigrationCliOptions {
  const command = argv[0];
  if (command !== "status" && command !== "apply" && command !== "adopt-baseline") usage();
  const explicitDatabaseUrl = argument(argv, "database-url");
  const mutating = command === "apply" || command === "adopt-baseline";
  if (mutating && !explicitDatabaseUrl?.trim()) {
    throw new Error("Mutating migrations require an explicit --database-url target");
  }
  if (mutating && !hasConfirmation(argv)) {
    throw new Error("Mutating migrations require explicit confirmation with --confirm");
  }
  const databaseUrl = explicitDatabaseUrl ?? environment.DATABASE_URL;
  if (!databaseUrl?.trim()) throw new Error("An explicitly supplied DATABASE_URL is required");
  return { command, databaseUrl };
}

export function safeErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/giu, "<redacted-database-url>");
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { command, databaseUrl } = parseMigrationCliOptions(argv);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      const migrations = await loadMigrations();
      if (command === "status") {
        process.stdout.write(`${JSON.stringify(await migrationStatus(client, migrations), null, 2)}\n`);
      } else if (command === "apply") {
        process.stdout.write(`${JSON.stringify(await applyMigrations(client, { migrations }), null, 2)}\n`);
      } else {
        process.stdout.write(`${JSON.stringify(await adoptBaseline(client, { migrations }), null, 2)}\n`);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]?.endsWith("/migrations/cli.ts") ?? false;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`Migration command failed: ${safeErrorText(error)}\n`);
    process.exitCode = 2;
  });
}
