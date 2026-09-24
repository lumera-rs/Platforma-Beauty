export const LEDGER = "public.lumera_migration_ledger";
export interface ColumnShape {
  name: string; type: string; notNull: boolean; default: string | null;
  identity: string; generated: string;
}
export interface TableShape { name: string; columns: ColumnShape[]; primaryKey: string[] }
export interface TransferPolicy {
  dropColumns?: string[];
  excludeTables?: string[];
  casts?: Record<string, string>;
}
export interface Blocker { code: string; table?: string; column?: string; constraint?: string; count?: number }
export interface Mapping {
  table: string; shared: string[]; drops: string[]; defaults: string[];
  generated: string[]; ordering: "primary-key" | "row-multiset"; blockers: Blocker[];
}

const widenings = new Set(["smallint->integer", "smallint->bigint", "integer->bigint"]);
export function planMapping(source: TableShape, target: TableShape, policy: TransferPolicy = {}): Mapping {
  const result: Mapping = { table: target.name, shared: [], drops: [], defaults: [],
    generated: [], ordering: target.primaryKey.length ? "primary-key" : "row-multiset", blockers: [] };
  const sources = new Map(source.columns.map(c => [c.name, c]));
  const targets = new Map(target.columns.map(c => [c.name, c]));
  for (const column of source.columns) {
    const other = targets.get(column.name);
    const key = `${target.name}.${column.name}`;
    if (other && /^json(?:\[\])?$/u.test(column.type.replaceAll('"', ""))) {
      // PostgreSQL json preserves duplicate keys, whitespace and numeric lexemes.
      // The JSONB transport cannot preserve that raw text representation.
      result.blockers.push({ code: "RAW_JSON_TRANSPORT_UNSUPPORTED", table: target.name, column: column.name });
    }
    if (!other) {
      if (policy.dropColumns?.includes(key)) result.drops.push(column.name);
      else result.blockers.push({ code: "SOURCE_ONLY_COLUMN", table: target.name, column: column.name });
    } else if (column.type !== other.type) {
      const cast = `${column.type}->${other.type}`;
      if (policy.casts?.[key] !== cast || !widenings.has(cast)) {
        result.blockers.push({ code: "TYPE_DIFFERENCE", table: target.name, column: column.name });
      } else result.shared.push(column.name);
    } else result.shared.push(column.name);
  }
  for (const column of target.columns) {
    if (column.generated) {
      // Never INSERT a stored generated column. Shared generated values remain
      // in the source/target verification hash, so changed recomputation rolls back.
      result.generated.push(column.name);
      continue;
    }
    if (!sources.has(column.name)) {
      if (column.identity || /nextval/iu.test(column.default ?? "")) {
        // nextval is nontransactional; never let an omitted INSERT column consume
        // sequence values before a transactional sequence restart.
        result.blockers.push({ code: "TARGET_SEQUENCE_DEFAULT_UNSUPPORTED", table: target.name, column: column.name });
      } else if (column.notNull && !column.default) {
        result.blockers.push({ code: "TARGET_REQUIRED_COLUMN", table: target.name, column: column.name });
      } else result.defaults.push(column.name);
    }
  }
  if (target.primaryKey.some(c => !result.shared.includes(c))) {
    result.blockers.push({ code: "SHARED_PRIMARY_KEY_REQUIRED", table: target.name });
  }
  return result;
}

export function classifyTable(name: string, seeded: boolean): {
  action: "transfer" | "compare-with-seeded-rows" | "do-not-transfer"; ownerDecision: boolean;
} {
  return {
    action: name === LEDGER ? "do-not-transfer" : seeded ? "compare-with-seeded-rows" : "transfer",
    ownerDecision: /session|outbox|deliver|notification|history|audit|archive|test|demo|token|waitlist|cleanup_report/iu.test(name),
  };
}