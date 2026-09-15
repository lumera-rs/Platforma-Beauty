import type { DatabaseClient } from "../backend-standards-database";
import type { MigrationLedgerRow, MigrationMode, MigrationState } from "./types";

export async function readLedgerForPreflight(client: DatabaseClient): Promise<MigrationLedgerRow[]> {
  const shape = await client.query(`
    SELECT c.relkind,
      COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'name', a.attname,
          'type', t.typname,
          'notNull', a.attnotnull,
          'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid, true)
        ) ORDER BY a.attname)
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
        LEFT JOIN pg_catalog.pg_attrdef d
          ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      ), '[]'::jsonb) AS columns,
      COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'type', con.contype,
          'definition', pg_catalog.pg_get_constraintdef(con.oid, true)
        ) ORDER BY con.contype, pg_catalog.pg_get_constraintdef(con.oid, true))
        FROM pg_catalog.pg_constraint con
        WHERE con.conrelid=c.oid
      ), '[]'::jsonb) AS constraints
    FROM pg_catalog.pg_class c
    WHERE c.oid='public.lumera_migration_ledger'::pg_catalog.regclass
  `);
  const row = shape.rows[0];
  const columns = row?.["columns"];
  const constraints = row?.["constraints"];
  const normalizedColumns = Array.isArray(columns) ? columns.map((value) => {
    const column = value as Record<string, unknown>;
    const defaultExpression = column["default"];
    return {
      name: column["name"],
      type: column["type"],
      notNull: column["notNull"],
      default: defaultExpression === `"clock_timestamp"()` ? "clock_timestamp()" : defaultExpression,
    };
  }) : [];
  const expectedColumns = [
    { name: "checksum", type: "text", notNull: true, default: null },
    { name: "error", type: "text", notNull: false, default: null },
    { name: "finished_at", type: "timestamptz", notNull: false, default: null },
    { name: "migration_id", type: "text", notNull: true, default: null },
    { name: "mode", type: "text", notNull: true, default: null },
    { name: "started_at", type: "timestamptz", notNull: true, default: "clock_timestamp()" },
    { name: "state", type: "text", notNull: true, default: null },
  ];
  if (
    row?.["relkind"] !== "r"
    || JSON.stringify(normalizedColumns) !== JSON.stringify(expectedColumns)
    || !Array.isArray(constraints)
    || constraints.length !== 3
  ) {
    throw new Error("Ledger relation does not match the canonical shape");
  }
  const definitions = constraints.map((value) =>
    typeof value === "object" && value !== null
      ? String((value as Record<string, unknown>)["definition"])
      : "").sort();
  const expectedDefinitions = [
    `CHECK ("mode" = ANY (ARRAY['transactional'::"text", 'nontransactional'::"text"]))`,
    `CHECK ("state" = ANY (ARRAY['APPLYING'::"text", 'APPLIED'::"text", 'FAILED'::"text", 'ADOPTED'::"text"]))`,
    `PRIMARY KEY ("migration_id")`,
  ].sort();
  if (JSON.stringify(definitions) !== JSON.stringify(expectedDefinitions)) {
    throw new Error("Ledger constraints do not match the canonical shape");
  }
  const result = await client.query(`
    SELECT pg_catalog.to_jsonb(ledger) AS ledger_row
    FROM public.lumera_migration_ledger ledger
  `);
  return result.rows.map((resultRow) => {
    const row = resultRow["ledger_row"];
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("Ledger row is not a JSON object");
    }
    const value = row as Record<string, unknown>;
    const state = value["state"];
    const mode = value["mode"];
    if (!["APPLYING", "APPLIED", "FAILED", "ADOPTED"].includes(String(state))) {
      throw new Error("Ledger contains an unsupported state");
    }
    if (mode !== "transactional" && mode !== "nontransactional") {
      throw new Error("Ledger contains an unsupported mode");
    }
    if (typeof value["migration_id"] !== "string" || typeof value["checksum"] !== "string") {
      throw new Error("Ledger contains malformed identity fields");
    }
    return {
      id: value["migration_id"],
      checksum: value["checksum"],
      mode: mode as MigrationMode,
      state: state as MigrationState,
      error: value["error"] == null ? null : String(value["error"]),
    };
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}