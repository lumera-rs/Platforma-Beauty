import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { courseEnrollmentsTable, db } from "@workspace/db";

/** Immutable legal evidence attached to every immediate online-content supply. */
export const DIGITAL_CONTENT_CONSENT_VERSION = "online-digital-content-v1";
export const DIGITAL_CONTENT_CONSENT_TEXT = "Saglasan/saglasna sam da pristup digitalnom sadržaju online kursa počne odmah po potvrdi uplate i potvrđujem da zbog početka isporuke gubim zakonsko pravo na odustanak od ugovora.";
export const ACTIVE_EDUCATION_ENTITLEMENT_CONFLICT =
  "Sadržaj nije moguće trajno obrisati dok najmanje jedan polaznik ima važeći kupljeni pristup.";

type EducationEntitlementTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Returns one currently valid purchased entitlement and locks that enrollment.
 * Online expiry is compared with PostgreSQL time so every API process agrees on
 * the deletion boundary. Non-online snapshots have no content-expiry deadline.
 */
export async function lockCurrentPurchasedEducationEntitlement(
  tx: EducationEntitlementTransaction,
  courseIds: string[],
) {
  const uniqueCourseIds = [...new Set(courseIds)].sort();
  if (!uniqueCourseIds.length) return null;
  const [entitlement] = await tx.select({
    id: courseEnrollmentsTable.id,
    courseId: courseEnrollmentsTable.courseId,
  }).from(courseEnrollmentsTable).where(and(
    inArray(courseEnrollmentsTable.courseId, uniqueCourseIds),
    eq(courseEnrollmentsTable.paymentStatus, "paid"),
    inArray(courseEnrollmentsTable.status, ["active", "completed"]),
    or(
      isNull(courseEnrollmentsTable.accessDaysSnapshot),
      and(
        isNotNull(courseEnrollmentsTable.accessExpiresAt),
        gt(courseEnrollmentsTable.accessExpiresAt, sql`current_timestamp`),
      ),
    ),
  )).orderBy(courseEnrollmentsTable.courseId, courseEnrollmentsTable.id).for("update").limit(1);
  return entitlement ?? null;
}

export function onlineAccessExpiry(accessGrantedAt: Date, accessDays: number) {
  if (!Number.isInteger(accessDays) || accessDays < 1) throw new Error("ONLINE_ACCESS_POLICY_MISSING");
  return new Date(accessGrantedAt.getTime() + accessDays * 86_400_000);
}

/** Immutable classification: an issued online snapshot outlives course edits. */
export function isOnlineEnrollmentSnapshot(enrollment: { accessDaysSnapshot?: number | null }) {
  return enrollment.accessDaysSnapshot != null;
}

export type OnlineCourseTerms = {
  price: number;
  duration: string;
  onlineAccessDays: number | null;
  extensionPrice1Month: number | null;
  extensionPrice3Months: number | null;
  extensionPrice6Months: number | null;
};

export type EnrollmentCourseTerms = OnlineCourseTerms & {
  format: "online" | "in-person" | "hybrid";
};

/** Validates consent and policy against the exact course row held for issuance. */
export function assertOnlineEnrollmentRequest(
  terms: EnrollmentCourseTerms,
  digitalContentConsent: boolean | undefined,
) {
  if (terms.format !== "online") return;
  if (digitalContentConsent !== true) throw new Error("ONLINE_CONTENT_CONSENT_REQUIRED");
  const accessDays = terms.onlineAccessDays;
  if (typeof accessDays !== "number" || !Number.isInteger(accessDays) || accessDays < 1
    || terms.extensionPrice1Month == null || terms.extensionPrice1Month <= 0
    || terms.extensionPrice3Months == null || terms.extensionPrice3Months <= 0
    || terms.extensionPrice6Months == null || terms.extensionPrice6Months <= 0) {
    throw new Error("ONLINE_ACCESS_POLICY_MISSING");
  }
}

/**
 * Creates the immutable evidence carried by an online enrollment. The caller
 * supplies the terms captured at purchase and the server-recorded consent
 * actor/time; expiry is deliberately issued only once access is granted.
 */
export function issueOnlineEnrollmentFields(
  terms: OnlineCourseTerms,
  consent: { userId: string; acceptedAt: Date; textSnapshot?: string; versionSnapshot?: string },
  accessGrantedAt?: Date,
) {
  const accessDays = terms.onlineAccessDays;
  if (typeof accessDays !== "number" || !Number.isInteger(accessDays) || accessDays < 1
    || terms.extensionPrice1Month == null || terms.extensionPrice1Month <= 0
    || terms.extensionPrice3Months == null || terms.extensionPrice3Months <= 0
    || terms.extensionPrice6Months == null || terms.extensionPrice6Months <= 0) {
    throw new Error("ONLINE_ACCESS_POLICY_MISSING");
  }
  return {
    coursePriceSnapshot: terms.price,
    durationSnapshot: terms.duration,
    accessDaysSnapshot: accessDays,
    extensionPricesSnapshot: {
      oneMonth: terms.extensionPrice1Month,
      threeMonths: terms.extensionPrice3Months,
      sixMonths: terms.extensionPrice6Months,
    },
    ...(accessGrantedAt ? { accessExpiresAt: onlineAccessExpiry(accessGrantedAt, accessDays) } : {}),
    digitalContentConsentAt: new Date(consent.acceptedAt),
    digitalContentConsentUserId: consent.userId,
    digitalContentConsentTextSnapshot: consent.textSnapshot ?? DIGITAL_CONTENT_CONSENT_TEXT,
    digitalContentConsentVersionSnapshot: consent.versionSnapshot ?? DIGITAL_CONTENT_CONSENT_VERSION,
  };
}