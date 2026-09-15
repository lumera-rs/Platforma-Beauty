import { closePool } from "@workspace/db";
import { ensureRetailCartIndexDevelopmentSchema } from "./retail-cart-index-development-schema";

function assertIsolatedCiTarget(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.CI !== "true" || environment.NODE_ENV !== "test") {
    throw new Error("Retail cart CI reconciliation requires CI=true and NODE_ENV=test.");
  }

  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Retail cart CI reconciliation requires an isolated loopback database.");
  }

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error("Retail cart CI reconciliation requires an isolated loopback database.");
  }

  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\/+/, ""));
  if (
    !loopbackHosts.has(parsedDatabaseUrl.hostname.toLowerCase())
    || !["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)
    || parsedDatabaseUrl.search !== ""
    || parsedDatabaseUrl.hash !== ""
    || databaseName !== "lumera_ci_database"
  ) {
    throw new Error("Retail cart CI reconciliation is restricted to the isolated CI database.");
  }
}

try {
  assertIsolatedCiTarget();
  await ensureRetailCartIndexDevelopmentSchema();
} finally {
  await closePool();
}