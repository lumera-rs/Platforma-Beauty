import type pg from "pg";
import type { ExpectedTargetIdentity } from "./target-identity";

const identities = new WeakMap<pg.Pool, ExpectedTargetIdentity>();

/**
 * Called only at disposable database creation, on the administrator connection.
 * The expected name is the generated CREATE DATABASE name, not a name read
 * back from the migration target. Never use this helper for operator targets.
 */
export async function registerDisposableTarget(
  admin: pg.Pool,
  pool: pg.Pool,
  databaseName: string,
): Promise<void> {
  const result = await admin.query("SELECT system_identifier::text FROM pg_catalog.pg_control_system()");
  const systemIdentifier = result.rows[0]?.system_identifier;
  if (typeof systemIdentifier !== "string") throw new Error("Disposable cluster identity unavailable");
  identities.set(pool, { databaseName, systemIdentifier, transport: "unencrypted" });
}

export function expectedDisposableTarget(pool: pg.Pool): ExpectedTargetIdentity {
  const identity = identities.get(pool);
  if (!identity) throw new Error("Pool is not a registered owned disposable database");
  return identity;
}