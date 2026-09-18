import type { DatabaseClient } from "../backend-standards-database";

interface PlanRow {
  id: string;
  name: string;
  price: number;
  trial_days: number;
  audience: string;
  course_limit: number | null;
  vat_included: boolean;
  price_copy: string | null;
  active: boolean;
  limits: Record<string, unknown> | null;
}
interface SalonSubscriptionRow { id: string; salon_id: string | null; plan_id: string }
interface CenterSubscriptionRow {
  id: string;
  center_id: string;
  plan_id: string;
  pending_plan_id: string | null;
  status: string;
  course_limit_override: number | null;
  current_price_snapshot: number | null;
  current_course_limit_snapshot: number | null;
}
interface PaymentRow {
  id: string;
  center_id: string;
  subscription_id: string | null;
  plan_id_snapshot: string | null;
}
interface ForeignKeyRow { schema_name: string; table_name: string; constraint_name: string; definition: string }
export interface Finding {
  code: string;
  entityId: string;
  relatedIds?: string[];
}

/**
 * A bounded read-only evidence report, not a migration planner or authorization.
 * No mapping is chosen from a name, rank or current price. Every historical
 * write remains disabled until a replacement contract is explicitly accepted.
 */
export async function inspectPlanReconciliation(client: DatabaseClient) {
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1"
    || process.env.REPLIT_DEPLOYMENT_ID) throw new Error("Historical inspection is development-disposable only");
  const identity = (await client.query(
    "SELECT current_database() AS name, pg_catalog.host(inet_server_addr()) AS host, inet_server_port() AS port",
  )).rows[0];
  if (!identity || !/^lumera_startup_equivalence_\d+_[a-f0-9]{16}$/.test(String(identity.name))
    || !["127.0.0.1", "::1"].includes(String(identity.host)) || Number(identity.port) === 5432) {
    throw new Error("Historical inspection requires an owned loopback disposable fixture");
  }
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='2s'; SET LOCAL search_path=pg_catalog,public");
    const read = async <T>(sql: string): Promise<T[]> => {
      const result = await client.query(sql);
      if (result.rows.length > 10_000) throw new Error("Historical inspection row budget exceeded");
      return result.rows as T[];
    };
    const plans = await read<PlanRow>("SELECT * FROM public.subscription_plans ORDER BY id LIMIT 10001");
    const salons = await read<SalonSubscriptionRow>("SELECT id,salon_id,plan_id FROM public.subscriptions ORDER BY id LIMIT 10001");
    const centers = await read<CenterSubscriptionRow>(`SELECT id,center_id,plan_id,pending_plan_id,status,course_limit_override,
      current_price_snapshot,current_course_limit_snapshot
      FROM public.education_center_subscriptions ORDER BY id LIMIT 10001`);
    const payments = await read<PaymentRow>(`SELECT id,center_id,subscription_id,plan_id_snapshot
      FROM public.education_payment_obligations ORDER BY id LIMIT 10001`);
    const foreignKeys = await read<ForeignKeyRow>(`
      SELECT n.nspname AS schema_name,c.relname AS table_name,con.conname AS constraint_name,
        pg_get_constraintdef(con.oid,true) AS definition
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE con.contype='f' AND con.confrelid='public.subscription_plans'::regclass
      ORDER BY n.nspname,c.relname,con.conname`);
    const uniqueConstraints = await read<{ name: string; definition: string }>(`
      SELECT conname AS name,pg_get_constraintdef(oid,true) AS definition
      FROM pg_constraint WHERE conrelid='public.subscription_plans'::regclass
        AND contype='u' ORDER BY conname`);
    const findings: Finding[] = [];
    const add = (code: string, entityId: string, relatedIds?: string[]) => findings.push({ code, entityId, relatedIds });
    const byId = new Map(plans.map((p) => [p.id, p]));
    for (const p of plans) {
      const educationRefs = centers.filter((e) => e.plan_id === p.id);
      const salonRefs = salons.filter((s) => s.plan_id === p.id);
      const shared = educationRefs.length > 0 && salonRefs.length > 0;
      if (shared) {
        add("SHARED_PLAN_SPLIT_REQUIRES_APPROVED_MAPPING", p.id, educationRefs.map((e) => e.id));
        const clones = plans.filter((candidate) => candidate.name === `Education legacy ${p.id}`);
        if (clones.length) add(clones.length > 1 ? "NONUNIQUE_CLONE_NAME" : "UNPROVEN_CLONE_PROVENANCE", p.id, clones.map((c) => c.id));
        const courses = p.limits?.courses;
        if (courses == null) add("SOURCE_INVENTS_FIVE_COURSE_FALLBACK", p.id);
        else if (!/^\+?\d+$/.test(String(courses)) || Number(courses) < 1 || Number(courses) > 2_147_483_647) {
          add("INVALID_OR_NONPOSITIVE_LEGACY_COURSES", p.id);
        }
      }
      const becomesEducation = p.audience === "education" || (educationRefs.length > 0 && salonRefs.length === 0);
      if (educationRefs.length > 0 && salonRefs.length === 0 && p.audience !== "education") add("GLOBAL_PLAN_AUDIENCE_WOULD_CHANGE", p.id);
      if (becomesEducation) {
        if (p.course_limit == null) add("PRICE_UUID_RANK_CANNOT_PROVE_TIER", p.id);
        if (Number(p.price) <= 0 && p.active) add("SOURCE_WOULD_DEACTIVATE_PLAN", p.id);
        if (p.course_limit != null && p.limits?.courses !== p.course_limit) add("SOURCE_WOULD_REWRITE_LIMITS", p.id);
        if (["Education Start", "Education Growth", "Education Academy"].includes(p.name)
          && p.course_limit !== null && [5, 15, 30].includes(p.course_limit)
          && (p.trial_days !== 30 || !p.vat_included || p.price_copy !== "Cena uključuje PDV.")) {
          add("SOURCE_WOULD_OVERWRITE_NAMED_TIER_TERMS", p.id);
        }
      }
      if (salonRefs.length && p.audience === "education") add("SALON_REFERENCE_TO_EDUCATION_AUDIENCE", p.id);
    }
    for (const e of centers) {
      if (["trial", "active", "free_via_loyalty"].includes(e.status)
        && (e.current_price_snapshot == null || e.current_course_limit_snapshot == null)) {
        add("CURRENT_PLAN_CANNOT_PROVE_MISSING_HISTORICAL_SNAPSHOT", e.id, [e.plan_id]);
      }
      if (e.pending_plan_id && byId.get(e.pending_plan_id)?.audience !== "education") {
        add("PENDING_PLAN_NOT_RELINKED_BY_SOURCE", e.id, [e.pending_plan_id]);
      }
    }
    for (const p of payments) {
      if (p.plan_id_snapshot) add("PRESERVE_HISTORICAL_PAYMENT_PLAN_ID", p.id, [p.plan_id_snapshot]);
    }
    const report = {
      status: "BLOCKED_PENDING_CONTRACT_ACCEPTANCE" as const,
      historicalWritesEnabled: false as const,
      findings, foreignKeys, uniqueConstraints,
      ownership: {
        salons: salons.map((s) => ({ subscriptionId: s.id, salonId: s.salon_id, planId: s.plan_id })),
        centers: centers.map((e) => ({ subscriptionId: e.id, centerId: e.center_id, planId: e.plan_id, pendingPlanId: e.pending_plan_id })),
      },
    };
    await client.query("COMMIT");
    return report;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Inspection and rollback failed");
    }
    throw error;
  }
}