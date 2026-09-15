import type { DatabasePoolClient as PoolClient } from "@workspace/db";

export const STARTUP_DDL_TIMEOUT = "30s";

export interface StartupDdlSessionTimeouts {
  readonly lockTimeout: string;
  readonly statementTimeout: string;
}

export async function readStartupDdlSessionTimeouts(
  client: PoolClient,
): Promise<StartupDdlSessionTimeouts> {
  const lock = await client.query<{ lock_timeout: string }>("SHOW lock_timeout");
  const statement = await client.query<{ statement_timeout: string }>("SHOW statement_timeout");
  return {
    lockTimeout: lock.rows[0]?.lock_timeout ?? "0",
    statementTimeout: statement.rows[0]?.statement_timeout ?? "0",
  };
}

export async function applyStartupDdlSessionTimeouts(client: PoolClient): Promise<void> {
  await client.query(`SET lock_timeout = '${STARTUP_DDL_TIMEOUT}'`);
  await client.query(`SET statement_timeout = '${STARTUP_DDL_TIMEOUT}'`);
}

export async function restoreStartupDdlSessionTimeouts(
  client: PoolClient,
  previous: StartupDdlSessionTimeouts,
): Promise<void> {
  let firstError: unknown;
  try {
    await client.query("SELECT set_config('lock_timeout', $1, false)", [previous.lockTimeout]);
  } catch (error) {
    firstError = error;
  }
  try {
    await client.query("SELECT set_config('statement_timeout', $1, false)", [previous.statementTimeout]);
  } catch (error) {
    firstError ??= error;
  }
  if (firstError) throw firstError;
}

export async function setLocalStartupDdlTimeouts(client: PoolClient): Promise<void> {
  await client.query(`SET LOCAL lock_timeout = '${STARTUP_DDL_TIMEOUT}'`);
  await client.query(`SET LOCAL statement_timeout = '${STARTUP_DDL_TIMEOUT}'`);
}