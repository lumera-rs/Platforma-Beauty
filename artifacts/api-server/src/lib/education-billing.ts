import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  educationPlatformSettingsTable,
  referralMilestoneBenefitsTable,
} from "@workspace/db";

export const educationBillingOverrideColumns = {
  commissionPercent: "commissionPercentOverride",
  reservePercent: "reservePercentOverride",
  onlineRefundDays: "onlineRefundDaysOverride",
  liveAppealDays: "liveAppealDaysOverride",
  featuredCoursePrice: "featuredCoursePriceOverride",
} as const;

export type EducationBillingKey = keyof typeof educationBillingOverrideColumns;
type EducationCenterRow = typeof educationCentersTable.$inferSelect;

export async function getEducationPlatformSettings(client: any = db) {
  const [existing] = await client.select()
    .from(educationPlatformSettingsTable)
    .orderBy(asc(educationPlatformSettingsTable.createdAt))
    .limit(1);
  if (existing) return existing;
  const [created] = await client.insert(educationPlatformSettingsTable).values({}).returning();
  return created!;
}

export async function resolveEducationBillingSettings(
  centerId: string | null | undefined,
  client: any = db,
  knownCenter?: EducationCenterRow | null,
) {
  const globalSettings = await getEducationPlatformSettings(client);
  const center = knownCenter !== undefined
    ? knownCenter
    : centerId
      ? (await client.select().from(educationCentersTable)
          .where(eq(educationCentersTable.id, centerId))
          .limit(1))[0] ?? null
      : null;
  const billingSettings = {} as Record<EducationBillingKey, {
    override: number | null;
    globalDefault: number;
    effectiveValue: number;
    source: "global" | "custom";
  }>;
  for (const key of Object.keys(educationBillingOverrideColumns) as EducationBillingKey[]) {
    const override = center?.[educationBillingOverrideColumns[key]] ?? null;
    const globalDefault = globalSettings[key];
    billingSettings[key] = {
      override,
      globalDefault,
      effectiveValue: override ?? globalDefault,
      source: override === null ? "global" : "custom",
    };
  }
  return {
    globalSettings,
    billingSettings,
    effective: Object.fromEntries(
      (Object.keys(billingSettings) as EducationBillingKey[])
        .map((key) => [key, billingSettings[key].effectiveValue]),
    ) as Record<EducationBillingKey, number>,
  };
}

/**
 * Resolve and snapshot the commission for an actual enrollment charge. Exactly
 * one queued A/C education benefit is consumed for a subscription cycle; every
 * later charge in that same cycle reuses the already-applied 12% period.
 * Callers must hold the center financial lock.
 */
export async function resolveEducationBillingSettingsForChargeInTx(
  centerId: string,
  tx: any,
  knownCenter?: EducationCenterRow | null,
  now = new Date(),
) {
  const settings = await resolveEducationBillingSettings(centerId, tx, knownCenter);
  const [subscription] = await tx.select().from(educationCenterSubscriptionsTable)
    .where(eq(educationCenterSubscriptionsTable.centerId, centerId))
    .for("update")
    .limit(1);
  const cycleStart = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (subscription?.currentPeriodEnd) cycleStart.setUTCMonth(cycleStart.getUTCMonth() - 1);

  const [alreadyApplied] = await tx.select().from(referralMilestoneBenefitsTable)
    .where(and(
      eq(referralMilestoneBenefitsTable.benefitEducationCenterId, centerId),
      eq(referralMilestoneBenefitsTable.kind, "education_commission_reduction"),
      eq(referralMilestoneBenefitsTable.billingCycleStart, cycleStart),
    ))
    .orderBy(asc(referralMilestoneBenefitsTable.qualifyingCount))
    .for("update")
    .limit(1);
  let benefit = alreadyApplied;
  if (!benefit) {
    const [queued] = await tx.select().from(referralMilestoneBenefitsTable)
      .where(and(
        eq(referralMilestoneBenefitsTable.benefitEducationCenterId, centerId),
        inArray(referralMilestoneBenefitsTable.channel, ["A", "C"]),
        eq(referralMilestoneBenefitsTable.kind, "education_commission_reduction"),
        isNull(referralMilestoneBenefitsTable.appliedAt),
      ))
      .orderBy(asc(referralMilestoneBenefitsTable.qualifyingCount), asc(referralMilestoneBenefitsTable.createdAt))
      .for("update")
      .limit(1);
    if (queued) {
      [benefit] = await tx.update(referralMilestoneBenefitsTable).set({
        billingCycleStart: cycleStart,
        appliedAt: now,
      }).where(and(eq(referralMilestoneBenefitsTable.id, queued.id),
        isNull(referralMilestoneBenefitsTable.appliedAt))).returning();
    }
  }
  return benefit
    ? { ...settings, effective: { ...settings.effective, commissionPercent: 12 }, referralMilestoneBenefitId: benefit.id }
    : { ...settings, referralMilestoneBenefitId: null };
}

export async function lockEducationCenterFinancials(tx: any, centerId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`education-center:${centerId}`}))`);
}

export async function lockEducationBillingRules(tx: any, mode: "shared" | "exclusive") {
  if (mode === "exclusive") {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('education-billing-rules:global'))`);
    return;
  }
  await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext('education-billing-rules:global'))`);
}