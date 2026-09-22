import { pool } from "@workspace/db";
import { logger } from "./logger";

type LedgerRow = {
  mode: string;
  state: string;
  finished_at: Date | null;
  chronological: boolean | null;
};
type Dependencies = {
  read: () => Promise<LedgerRow[]>;
  warn: (reason: string, code?: string) => void;
};

// Only a successful, validated receipt is cached. Store a number rather than a
// mutable Date, and deduplicate concurrent cold reads without caching failures.
export function createJobPublicationCutoffResolver({ read, warn }: Dependencies) {
  let cached: number | undefined;
  let pending: Promise<number | null> | undefined;
  return async (): Promise<Date | null> => {
    if (cached !== undefined) return new Date(cached);
    if (!pending) {
      pending = (async () => {
        try {
          const [row] = await read();
          if (!row) { warn("migration_row_missing"); return null; }
          if (row.mode !== "transactional" || row.state !== "APPLIED"
            || !row.chronological || !(row.finished_at instanceof Date)
            || !Number.isFinite(row.finished_at.getTime())) {
            warn("migration_receipt_invalid");
            return null;
          }
          cached = row.finished_at.getTime();
          return cached;
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
          warn(code === "42P01" ? "ledger_missing"
            : code === "42501" ? "ledger_select_denied" : "ledger_read_failed", code);
          return null;
        }
      })().finally(() => { pending = undefined; });
    }
    const value = await pending;
    return value === null ? null : new Date(value);
  };
}

function runtimeResolver() {
  return createJobPublicationCutoffResolver({
    // Intentionally use the pool, never a moderation transaction's client.
    read: async () => (await pool.query<LedgerRow>(`
      SELECT mode, state, finished_at, finished_at >= started_at AS chronological
      FROM public.lumera_migration_ledger WHERE migration_id = '000004'
    `)).rows,
    warn: (reason, code) => logger.warn({
      event: "job-publication-cutoff-unavailable", migrationId: "000004", reason, ...(code ? { code } : {}),
    }, "Job publication cutoff unavailable; preserving existing publication dates"),
  });
}

let resolve = runtimeResolver();
export function resolveJobPublicationCutoff(): Promise<Date | null> {
  return resolve();
}

export function resetJobPublicationCutoffForTests(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Cutoff cache reset is test-only");
  resolve = runtimeResolver();
}