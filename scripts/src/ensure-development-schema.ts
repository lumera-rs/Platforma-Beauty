function assertDevelopmentRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (
    environment.NODE_ENV === "production"
    || environment.REPLIT_DEPLOYMENT === "1"
    || environment.REPLIT_DEPLOYMENT_ID
    || environment.REPLIT_ENVIRONMENT === "production"
  ) {
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
