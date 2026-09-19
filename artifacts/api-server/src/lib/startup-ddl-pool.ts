import type { pool as productionPool } from "@workspace/db";

export type StartupDdlPool = Pick<typeof productionPool, "connect">;

export async function resolveStartupDdlPool(
  override?: StartupDdlPool,
): Promise<StartupDdlPool> {
  return override ?? (await import("@workspace/db")).pool;
}