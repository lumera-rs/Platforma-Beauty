import { isDeploymentRuntime } from "./migrations/development-runtime";
import { parseExpectedTargetIdentity } from "./migrations/cli";

function assertDevelopmentRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  // REPLIT_ENVIRONMENT can have a production-like value in an editor
  // workspace. It is not a deployment indicator by itself; explicit
  // flags and a separately verified target establish the boundary.
  if (isDeploymentRuntime(environment)) {
    throw new Error(
      "Development schema preparation refuses production or deployment runtimes.",
    );
  }
}

export {};

// Keep this check before even importing the configured database pool. The
// wrapper is a development-only entry point and must not turn an ambient
// production DATABASE_URL into a mutating target.
assertDevelopmentRuntime();
const expectedTargetIdentity = parseExpectedTargetIdentity(process.argv.slice(2));

let closePool: (() => Promise<void>) | undefined;
try {
  const [{ pool, closePool: close }, { prepareDevelopmentMigrations }] = await Promise.all([
    import("@workspace/db"),
    import("./migrations/prepare-development"),
  ]);
  closePool = close;

  const client = await pool.connect();
  try {
    const result = await prepareDevelopmentMigrations(client, {
      environment: process.env,
      expectedTargetIdentity,
    });
    console.log(
      `Development migrations ready (${result.eligibility.path}; `
      + `applied=${result.migration.applied.join(",") || "none"}).`,
    );
  } finally {
    client.release();
  }

} finally {
  await closePool?.();
}
