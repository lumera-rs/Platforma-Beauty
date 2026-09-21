import pg from "pg";
import { isDeploymentRuntime } from "./development-runtime";
import { inspectDeploymentEligibility } from "./deployment-eligibility";
import { safeErrorText } from "./cli";

function argument(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

export interface DeploymentEligibilityCliOptions {
  readonly databaseUrl: string;
  readonly target: "development";
}

export function assertEligibilityDevelopmentRuntime(environment: NodeJS.ProcessEnv = process.env): void {
  // REPLIT_ENVIRONMENT can have a production-like value in an editor
  // workspace. It is not a deployment indicator by itself; explicit
  // deployment flags establish the runtime boundary (inspection is read-only).
  if (isDeploymentRuntime(environment)) {
    throw new Error("Deployment eligibility is development-only; production readiness is not assessed");
  }
}

export function parseDeploymentEligibilityCliOptions(argv: readonly string[]): DeploymentEligibilityCliOptions {
  const databaseUrl = argument(argv, "database-url");
  if (!databaseUrl?.trim()) throw new Error("Eligibility inspection requires an explicit --database-url target");
  if (argument(argv, "target") !== "development") {
    throw new Error("Eligibility inspection requires explicit --target=development");
  }
  if (!argv.includes("--confirm") && !argv.includes("--confirm=true")) {
    throw new Error("Eligibility inspection requires explicit confirmation with --confirm");
  }
  return { databaseUrl, target: "development" };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  assertEligibilityDevelopmentRuntime();
  const { databaseUrl } = parseDeploymentEligibilityCliOptions(argv);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      process.stdout.write(`${JSON.stringify(await inspectDeploymentEligibility(client), null, 2)}\n`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("/deployment-eligibility-cli.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(`Eligibility inspection failed: ${safeErrorText(error)}\n`);
    process.exitCode = 2;
  });
}