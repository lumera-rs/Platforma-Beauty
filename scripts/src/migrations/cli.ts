import pg from "pg";
import { adoptBaseline, applyMigrations, migrationStatus } from "./runner";
import { loadMigrations } from "./files";

function argument(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = argv.find((item) => item.startsWith(prefix));
  return value?.slice(prefix.length);
}

function usage(): never {
  throw new Error("Usage: migrations <status|apply|adopt-baseline> [--database-url=DATABASE_URL]");
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const command = argv[0];
  if (command !== "status" && command !== "apply" && command !== "adopt-baseline") usage();
  const supplied = argument(argv, "database-url") ?? process.env.DATABASE_URL;
  if (!supplied?.trim()) throw new Error("An explicitly supplied DATABASE_URL is required");
  const pool = new pg.Pool({ connectionString: supplied, max: 1 });
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
    process.stderr.write(`Migration command failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}