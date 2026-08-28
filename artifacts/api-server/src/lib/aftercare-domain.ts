import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

type SqlExecutor = Pick<typeof db, "execute">;

export function normalizeTreatmentTaxonomyKey(category: string, name: string): string {
  const normalize = (value: string) => value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("sr-Latn")
    .replace(/đ/g, "dj")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const key = [normalize(category), normalize(name)].filter(Boolean).join("-");
  if (!key) throw new Error("Treatment taxonomy requires a category or name.");
  return key.slice(0, 160).replace(/-$/g, "");
}

export function hashAftercareEntitlement(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Appointment completion routes call this inside the same transaction as the
 * status transition. transitionKey must identify that concrete transition.
 */
export async function enqueueAftercareCompletion(
  executor: SqlExecutor,
  input: { appointmentId: string; transitionKey: string; completedAt?: Date },
): Promise<boolean> {
  const inserted = await executor.execute<{ id: string }>(sql`
    INSERT INTO aftercare_completion_events
      (appointment_id, customer_user_id, transition_key, completed_at)
    SELECT a.id, COALESCE(
      CASE WHEN u.role::text IN ('CUSTOMER', 'JOBSEEKER') AND u.active THEN u.id END,
      CASE WHEN linked.role::text IN ('CUSTOMER', 'JOBSEEKER') AND linked.active THEN linked.id END
    ), ${input.transitionKey}, ${input.completedAt ?? new Date()}
    FROM appointments a
    LEFT JOIN users u ON u.id = a.customer_id
    LEFT JOIN salon_customers sc ON sc.id = a.salon_customer_id
    LEFT JOIN users linked ON linked.id = sc.user_id
    WHERE a.id = ${input.appointmentId}
    ON CONFLICT (appointment_id, transition_key) DO NOTHING
    RETURNING id
  `);
  return inserted.rows.length === 1;
}

export async function enqueueAftercareCompletionDefault(
  input: { appointmentId: string; transitionKey: string; completedAt?: Date },
): Promise<boolean> {
  return enqueueAftercareCompletion(db, input);
}