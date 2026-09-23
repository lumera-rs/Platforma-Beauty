import pg from "pg";
import { adoptBaseline, applyMigrations, migrationStatus } from "./runner";
import { loadMigrations } from "./files";
import { validateExpectedTargetIdentity, type ExpectedTargetIdentity } from "./target-identity";

export function parseExpectedTargetIdentity(argv: readonly string[]): ExpectedTargetIdentity {
  for (const name of ["expected-neon-tenant-id", "expected-neon-timeline-id"]) {
    if (argv.includes(`--${name}`)) {
      throw new Error(`Explicit target identity requires --${name}=VALUE syntax`);
    }
  }
  for (const name of ["expected-database", "expected-system-identifier", "expected-transport"]) {
    if (argv.filter((item) => item.startsWith(`--${name}=`)).length !== 1) {
      throw new Error(`Explicit target identity requires exactly one --${name}= value`);
    }
  }
  const neonTenantCount = argv.filter((item) => item.startsWith("--expected-neon-tenant-id=")).length;
  const neonTimelineCount = argv.filter((item) => item.startsWith("--expected-neon-timeline-id=")).length;
  if (neonTenantCount > 1) {
    throw new Error("Explicit target identity permits at most one --expected-neon-tenant-id= value");
  }
  if (neonTimelineCount > 1) {
    throw new Error("Explicit target identity permits at most one --expected-neon-timeline-id= value");
  }
  if ((neonTenantCount === 1) !== (neonTimelineCount === 1)) {
    throw new Error("Explicit target identity requires both --expected-neon-tenant-id and --expected-neon-timeline-id, or neither");
  }
  return validateExpectedTargetIdentity({
    databaseName: argument(argv, "expected-database"),
    systemIdentifier: argument(argv, "expected-system-identifier"),
    transport: argument(argv, "expected-transport"),
    ...(neonTenantCount === 1 ? {
      neon: {
        tenantId: argument(argv, "expected-neon-tenant-id"),
        timelineId: argument(argv, "expected-neon-timeline-id"),
      },
    } : {}),
  });
}

function argument(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = argv.find((item) => item.startsWith(prefix));
  return value?.slice(prefix.length);
}

function usage(): never {
  throw new Error(
    "Usage: migrations <status|apply|adopt-baseline> "
    + "[--database-url=DATABASE_URL] [--confirm] "
    + "[--expected-database=NAME --expected-system-identifier=DECIMAL --expected-transport=encrypted|unencrypted "
    + "[--expected-neon-tenant-id=LOWERCASE32HEX --expected-neon-timeline-id=LOWERCASE32HEX]]",
  );
}

function hasConfirmation(argv: readonly string[]): boolean {
  return argv.some((item) => item === "--confirm" || item === "--confirm=true" || item === "--confirm=yes");
}

export interface MigrationCliOptions {
  readonly command: "status" | "apply" | "adopt-baseline";
  readonly databaseUrl: string;
  readonly expectedTargetIdentity?: ExpectedTargetIdentity;
}

export function parseMigrationCliOptions(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): MigrationCliOptions {
  const command = argv[0];
  if (command !== "status" && command !== "apply" && command !== "adopt-baseline") usage();
  if (command === "status" && argv.some((item) => /^--expected-neon-(?:tenant|timeline)-id(?:=|$)/u.test(item))) {
    throw new Error("Neon target identity declarations require apply or adopt-baseline; status does not verify target identity");
  }
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
  return { command, databaseUrl, ...(mutating ? { expectedTargetIdentity: parseExpectedTargetIdentity(argv) } : {}) };
}

export function safeErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/giu, "<redacted-database-url>");
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { command, databaseUrl, expectedTargetIdentity } = parseMigrationCliOptions(argv);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      const migrations = await loadMigrations();
      if (command === "status") {
        process.stdout.write(`${JSON.stringify(await migrationStatus(client, migrations), null, 2)}\n`);
      } else if (command === "apply") {
        process.stdout.write(`${JSON.stringify(await applyMigrations(client, { migrations, expectedTargetIdentity }), null, 2)}\n`);
      } else {
        process.stdout.write(`${JSON.stringify(await adoptBaseline(client, { migrations, expectedTargetIdentity }), null, 2)}\n`);
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
