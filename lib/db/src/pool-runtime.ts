import type { ClientBase } from "pg";
import { isProductionOrDeploymentRuntime } from "./destructive-test-runtime.ts";

export type DatabaseUrlSelection = {
  connectionString: string;
  variable: "LUMERA_DATABASE_URL" | "DATABASE_URL";
};

export function selectDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseUrlSelection {
  if (environment.LUMERA_DATABASE_URL) {
    return {
      connectionString: environment.LUMERA_DATABASE_URL,
      variable: "LUMERA_DATABASE_URL",
    };
  }
  if (isProductionOrDeploymentRuntime(environment)) {
    throw new Error("LUMERA_DATABASE_URL must be set in deployment runtimes.");
  }
  if (environment.DATABASE_URL) {
    return {
      connectionString: environment.DATABASE_URL,
      variable: "DATABASE_URL",
    };
  }
  throw new Error("DATABASE_URL must be set outside deployment runtimes.");
}

export function assertSupportedDatabaseUrl(selection: DatabaseUrlSelection): void {
  let parsed: URL;
  try {
    parsed = new URL(selection.connectionString);
  } catch {
    throw new Error(`${selection.variable} must be a valid PostgreSQL URL.`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${selection.variable} must use the PostgreSQL URL scheme.`);
  }
  // pg-connection-string gives a non-empty `host` query parameter precedence
  // over the URL authority, and duplicate parameters use the last value.
  // Inspect the same effective host before Pool exists.
  const queryHosts = parsed.searchParams.getAll("host");
  const effectiveHost = (queryHosts.at(-1) || parsed.hostname)
    .replace(/\.+$/, "");
  const neonPooler = effectiveHost
    .toLowerCase()
    .split(".")
    .some((label) => label.endsWith("-pooler"));
  if (neonPooler && /(?:^|\.)neon\.tech$/i.test(effectiveHost)) {
    throw new Error(
      `${selection.variable} must use a direct Neon endpoint; LISTEN does not work through a -pooler endpoint.`,
    );
  }
}

type QueryClient = Pick<ClientBase, "query">;

export function createNewClientInitializer(
  statementTimeoutMs: number,
): (client: QueryClient) => Promise<void> {
  return async (client: QueryClient) => {
    try {
      await client.query(
        "SELECT set_config('statement_timeout', $1, false)",
        [String(statementTimeoutMs)],
      );
    } catch {
      throw new Error(
        "DB_STMT_TIMEOUT_MS could not be applied to a newly established database client.",
      );
    }
  };
}

export function safeIdleClientErrorMessage(): string {
  return "database client failed while idle; connection details redacted";
}