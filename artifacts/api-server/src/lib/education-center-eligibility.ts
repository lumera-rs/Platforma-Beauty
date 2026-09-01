import { eq, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  db, educationCentersTable, educationCenterSubscriptionsTable,
} from "@workspace/db";

export type EducationSubscriptionEligibility = {
  status?: string | null;
  currentPeriodEnd?: Date | null;
  trialEndsAt?: Date | null;
  graceEndsAt?: Date | null;
};

/** Canonical runtime interpretation of a center subscription entitlement. */
export function hasActiveEducationSubscription(
  subscription: EducationSubscriptionEligibility | string | null | undefined,
  now = new Date(),
) {
  if (!subscription) return false;
  const normalized = typeof subscription === "string" ? { status: subscription } : subscription;
  const end = normalized.status === "trial" ? normalized.trialEndsAt ?? normalized.currentPeriodEnd
    : normalized.status === "past_due" ? normalized.graceEndsAt
    : normalized.currentPeriodEnd;
  const withinPeriod = !end || end > now;
  return withinPeriod && ["active", "trial", "free_via_loyalty", "past_due"].includes(normalized.status ?? "");
}

/** SQL equivalent of hasActiveEducationSubscription plus center verification. */
export function eligibleEducationCenterSql(centerId: SQLWrapper): SQL<boolean> {
  return sql<boolean>`exists (
    select 1
    from ${educationCentersTable} ec
    join ${educationCenterSubscriptionsTable} ecs on ecs.center_id = ec.id
    where ec.id = ${centerId}
      and ec.verification_status = 'verified'
      and (
        (ecs.status in ('active', 'free_via_loyalty')
          and (ecs.current_period_end is null or ecs.current_period_end > current_timestamp))
        or (ecs.status = 'trial'
          and (coalesce(ecs.trial_ends_at, ecs.current_period_end) is null
            or coalesce(ecs.trial_ends_at, ecs.current_period_end) > current_timestamp))
        or (ecs.status = 'past_due'
          and (ecs.grace_ends_at is null or ecs.grace_ends_at > current_timestamp))
      )
  )`;
}

export async function educationCenterEligibility(centerId: string, store: any = db) {
  const [center, subscription] = await Promise.all([
    store.select().from(educationCentersTable).where(eq(educationCentersTable.id, centerId)).limit(1),
    store.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, centerId)).limit(1),
  ]);
  return {
    center: center[0] ?? null,
    subscription: subscription[0] ?? null,
    eligible: center[0]?.verificationStatus === "verified" && hasActiveEducationSubscription(subscription[0]),
  };
}