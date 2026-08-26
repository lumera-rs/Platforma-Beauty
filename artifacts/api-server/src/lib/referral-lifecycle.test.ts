import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  appointmentsTable,
  courseEnrollmentsTable,
  coursesTable,
  db,
  educationCenterSubscriptionsTable,
  educationCentersTable,
  emailDeliveriesTable,
  ordersTable,
  phoneVerificationProofsTable,
  pool,
  referralAttributionsTable,
  referralCodesTable,
  referralCreditLedgerTable,
  referralCreditRedemptionsTable,
  referralMilestoneBenefitsTable,
  referralQualificationEvidenceTable,
  referralQualificationsTable,
  referralReviewsTable,
  salonsTable,
  servicesTable,
  smsDeliveriesTable,
  subscriptionPlansTable,
  subscriptionsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { assertNoPgBusyClientWarnings } from "./pg-busy-client.test-support";
import { qualificationWindow, referralIdempotencyKey, type ReferralChannel } from "./referral-domain";
import { ensureReferralSchema } from "./referral-schema";
import {
  allocateReferralCreditInTx,
  applySalonReferralSubscriptionReduction,
  compensateInvalidatedReferralSourcesInTx,
  projectSalonSubscriptionDue,
  captureReferralAttributionInTx,
  deriveReferralCreditBalance,
  decideReferredBusinessApproval,
  ensureReferralCode,
  recordAppointmentReferralTransitionInTx,
  recordEducationEnrollmentReferralTransitionInTx,
  recordReferralRedemptionInTx,
  referralCreditBalanceInTx,
  restoreReferralCreditForOrderInTx,
  ReferralChannelContextError,
  runReferralMaintenance,
  type ReferralWalletScope,
} from "./referral-service";
import {
  lockEducationCenterFinancials,
  resolveEducationBillingSettingsForChargeInTx,
} from "./education-billing";

const suffix = randomUUID();
const createdUserIds: string[] = [];
const createdSalonIds: string[] = [];
const createdCenterIds: string[] = [];
const createdCourseIds: string[] = [];
const createdAppointmentIds: string[] = [];
const createdEnrollmentIds: string[] = [];
const createdOrderIds: string[] = [];
const testEmails: string[] = [];
const testPhones: string[] = [];
let userSequence = 0;
let server: ReturnType<typeof app.listen> | undefined;

type User = typeof usersTable.$inferSelect;
type Salon = typeof salonsTable.$inferSelect;
type Center = typeof educationCentersTable.$inferSelect;

async function user(role: User["role"] = "CUSTOMER") {
  const number = String(++userSequence).padStart(4, "0");
  const email = `ref-life-${suffix}-${number}@example.test`;
  const phone = `+38167${suffix.replace(/\D/g, "").padEnd(6, "7").slice(0, 6)}${number}`;
  const [row] = await db.insert(usersTable).values({
    firstName: "Referral",
    lastName: `Lifecycle ${number}`,
    email,
    phone,
    phoneNormalized: phone,
    passwordHash: "test-only",
    role,
  }).returning();
  createdUserIds.push(row!.id);
  testEmails.push(email);
  testPhones.push(phone);
  return row!;
}

async function salon(owner: User, label: string) {
  const [row] = await db.insert(salonsTable).values({
    ownerId: owner.id,
    name: `Referral ${label} ${suffix}`,
    slug: `ref-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}`,
    city: "Beograd",
    municipality: "Vračar",
    address: "Test 1",
    phone: owner.phone!,
    email: `salon-${label}-${suffix}@example.test`,
    shortDescription: "Referral lifecycle fixture.",
    description: "Real PostgreSQL referral lifecycle fixture.",
    imageUrl: "/test.jpg",
  }).returning();
  createdSalonIds.push(row!.id);
  return row!;
}

async function center(owner: User, label: string) {
  const [row] = await db.insert(educationCentersTable).values({
    ownerId: owner.id,
    name: `Referral center ${label} ${suffix}`,
    city: "Beograd",
    description: "Real PostgreSQL referral lifecycle fixture.",
    imageUrl: "/test.jpg",
    verificationStatus: "verified",
    verifiedAt: new Date(),
  }).returning();
  createdCenterIds.push(row!.id);
  return row!;
}

const services = new Map<string, string>();
async function appointment(targetSalon: Salon, customer: User) {
  let serviceId = services.get(targetSalon.id);
  if (!serviceId) {
    const [service] = await db.insert(servicesTable).values({
      salonId: targetSalon.id,
      categoryName: "Test",
      name: "Referral evidence",
      description: "Referral evidence fixture.",
      durationMinutes: 30,
      price: 1000,
      imageUrl: "/test.jpg",
    }).returning();
    serviceId = service!.id;
    services.set(targetSalon.id, serviceId);
  }
  const [row] = await db.insert(appointmentsTable).values({
    salonId: targetSalon.id,
    customerId: customer.id,
    serviceId,
    date: "2099-01-01",
    startTime: "10:00",
    endTime: "10:30",
    durationMinutes: 30,
    price: 1000,
    status: "completed",
  }).returning();
  createdAppointmentIds.push(row!.id);
  return row!;
}

async function enrollment(targetCenter: Center, student: User) {
  const [course] = await db.insert(coursesTable).values({
    centerId: targetCenter.id,
    title: `Referral course ${randomUUID()}`,
    description: "Referral evidence fixture.",
    category: "Test",
    format: "online",
    city: "Beograd",
    price: 5000,
    duration: "1 day",
    certification: false,
    imageUrl: "/test.jpg",
    published: true,
  }).returning();
  const courseId = course!.id;
  createdCourseIds.push(courseId);
  const [row] = await db.insert(courseEnrollmentsTable).values({
    courseId,
    userId: student.id,
    purchaserId: student.id,
    status: "completed",
    paymentStatus: "paid",
  }).returning();
  createdEnrollmentIds.push(row!.id);
  return row!;
}

async function proof(target: User) {
  await db.insert(phoneVerificationProofsTable).values({
    userId: target.id,
    phoneNormalized: target.phoneNormalized!,
  });
}

type Source = { owner: User; salon?: Salon; center?: Center };
async function referral(channel: ReferralChannel, source: Source, referred: User, at: Date) {
  const sourceBusiness = source.salon ? "salon" as const : source.center ? "education_center" as const : undefined;
  const sourceBusinessId = source.salon?.id ?? source.center?.id;
  const code = await db.transaction((tx) => ensureReferralCode(tx, {
    channel,
    referrerUserId: source.owner.id,
    ...(sourceBusiness ? { sourceBusiness, sourceBusinessId } : {}),
  }));
  const [attribution] = await db.insert(referralAttributionsTable).values({
    referralCodeId: code.id,
    channel,
    referrerUserId: source.owner.id,
    referredUserId: referred.id,
    referredSalonId: (channel === "A" || channel === "B1") ? source.salon?.id : null,
    referredEducationCenterId: (channel === "A" || channel === "B1") ? source.center?.id : null,
    status: "attributed",
    capturedAt: new Date(at.getTime() - 60_000),
    lockedUntil: new Date(at.getTime() + 30 * 86400_000),
    idempotencyKey: referralIdempotencyKey("life-attribution", referred.id),
  }).returning();
  const required = channel === "B2" ? 3 : channel === "D" ? 1 : 4;
  const [qualification] = await db.insert(referralQualificationsTable).values({
    attributionId: attribution!.id,
    referredSalonId: attribution!.referredSalonId,
    referredEducationCenterId: attribution!.referredEducationCenterId,
    status: "tracking",
    requiredEvidenceCount: required,
    trackingStartedAt: channel === "A" || channel === "B1" ? new Date(at.getTime() - 30_000) : null,
    updatedAt: new Date(at.getTime() - 30_000),
  }).returning();
  return { code, attribution: attribution!, qualification: qualification! };
}

async function appointmentTransition(
  referred: User,
  targetSalon: Salon,
  at: Date,
  valid = true,
  existingId?: string,
) {
  const item = existingId ? { id: existingId } : await appointment(targetSalon, referred);
  return db.transaction((tx) => recordAppointmentReferralTransitionInTx(tx, {
    appointmentId: item.id,
    customerId: referred.id,
    salonId: targetSalon.id,
    occurredAt: at,
    valid,
    reason: valid ? undefined : "cancelled_or_refunded",
  }));
}

async function enrollmentTransition(
  referred: User,
  targetCenter: Center,
  at: Date,
  valid = true,
  existingId?: string,
) {
  const item = existingId ? { id: existingId } : await enrollment(targetCenter, referred);
  return db.transaction((tx) => recordEducationEnrollmentReferralTransitionInTx(tx, {
    enrollmentId: item.id,
    studentUserId: referred.id,
    centerId: targetCenter.id,
    occurredAt: at,
    valid,
    reason: valid ? undefined : "cancelled_or_refunded",
  }));
}

async function qualifyAppointments(referred: User, targetSalon: Salon, count: number, at: Date) {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const item = await appointment(targetSalon, referred);
    ids.push(item.id);
    await appointmentTransition(referred, targetSalon, new Date(at.getTime() + index), true, item.id);
  }
  return ids;
}

async function qualifyEnrollments(referred: User, targetCenter: Center, count: number, at: Date) {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const item = await enrollment(targetCenter, referred);
    ids.push(item.id);
    await enrollmentTransition(referred, targetCenter, new Date(at.getTime() + index), true, item.id);
  }
  return ids;
}

async function waitForAdvisoryWaiters(lockKey: string, expected: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      select count(*)::int as count from pg_locks
      where locktype = 'advisory' and objid = hashtext(${lockKey}) and not granted
    `);
    if (Number((result.rows[0] as { count?: number | string } | undefined)?.count ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected ${expected} waiters for ${lockKey}.`);
}

async function capRace(channel: "B2" | "D", owner: User, sourceSalon: Salon, at: Date) {
  const cap = channel === "B2" ? 20 : 15;
  const candidates: Array<{ referred: User; finalId: string }> = [];
  for (let index = 0; index < cap - 1; index += 1) {
    const referred = await user();
    if (channel === "B2") await proof(referred);
    const made = await referral(channel, channel === "D" ? { owner, salon: sourceSalon } : { owner }, referred, at);
    await db.insert(referralCreditLedgerTable).values({
      walletKind: channel === "D" ? "B2B" : "B2C",
      ownerUserId: owner.id,
      salonId: channel === "D" ? sourceSalon.id : null,
      referralAttributionId: made.attribution.id,
      type: "held",
      amountRsd: 100,
      effectiveAt: at,
      reason: "Cap fixture.",
      idempotencyKey: referralIdempotencyKey("cap-held", made.attribution.id),
    });
    await db.update(referralQualificationsTable).set({ status: "held" })
      .where(eq(referralQualificationsTable.id, made.qualification.id));
  }
  for (let index = 0; index < 2; index += 1) {
    const referred = await user();
    await proof(referred);
    await referral(channel, channel === "D" ? { owner, salon: sourceSalon } : { owner }, referred, at);
    if (channel === "B2") await qualifyAppointments(referred, sourceSalon, 2, at);
    const final = await appointment(sourceSalon, referred);
    candidates.push({ referred, finalId: final.id });
  }
  const period = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  if (channel === "B2") period.setUTCDate(1);
  else period.setUTCDate(period.getUTCDate() - ((period.getUTCDay() + 6) % 7));
  const lockKey = `referral-cap:${owner.id}:${channel}:${period.toISOString()}`;
  let release!: () => void;
  let acquired!: () => void;
  const acquiredPromise = new Promise<void>((resolve) => { acquired = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const holder = db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
    acquired();
    await releasePromise;
  });
  await acquiredPromise;
  const racers = candidates.map(({ referred, finalId }) =>
    appointmentTransition(referred, sourceSalon, at, true, finalId));
  await waitForAdvisoryWaiters(lockKey, 2);
  release();
  await holder;
  const outcomes = await Promise.all(racers);
  assert.equal(outcomes.filter((item) => item.qualified).length, 1, `${channel} competing final qualifications serialize at its cap`);
  const held = await db.select().from(referralCreditLedgerTable).where(and(
    eq(referralCreditLedgerTable.ownerUserId, owner.id),
    eq(referralCreditLedgerTable.type, "held"),
    channel === "D" ? eq(referralCreditLedgerTable.salonId, sourceSalon.id) : sql`${referralCreditLedgerTable.salonId} is null`,
  ));
  assert.equal(held.length, cap, `${channel} hard cap is exactly ${cap}`);
}

async function insertAvailable(scope: ReferralWalletScope, amountRsd: number, expiresAt: Date, key: string) {
  const [row] = await db.insert(referralCreditLedgerTable).values({
    ...scope,
    type: "available",
    amountRsd,
    effectiveAt: new Date(Math.min(Date.now() - 60_000, expiresAt.getTime() - 86400_000)),
    expiresAt,
    reason: "Wallet concurrency fixture.",
    idempotencyKey: key,
  }).returning();
  return row!;
}

async function order(targetSalon: Salon) {
  const [row] = await db.insert(ordersTable).values({
    salonId: targetSalon.id,
    total: 1000,
    subtotal: 1000,
    shippingName: "Referral test",
    shippingAddress: "Test 1",
    paymentMethod: "BANK_TRANSFER",
    paymentStatus: "unpaid",
    deliveryMethod: "courier",
  }).returning();
  createdOrderIds.push(row!.id);
  return row!;
}

async function run() {
  await ensureBusinessGrowthSchema();
  await ensureReferralSchema();
  const at = new Date(Date.now() + 120_000);

  // Scoped issuance and the actual dashboard endpoint.
  const owner = await user("SALON_OWNER");
  const salonOne = await salon(owner, "owner-one");
  const salonTwo = await salon(owner, "owner-two");
  const education = await center(owner, "owner-education");
  const outsider = await user("SALON_OWNER");
  const outsiderSalon = await salon(outsider, "outsider");
  const session = await createSession(owner.id);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const referralDashboard = async (dashboardUser: User) => {
    const dashboardSession = await createSession(dashboardUser.id);
    const dashboardResponse = await fetch(`http://127.0.0.1:${port}/api/referrals/dashboard`, {
      headers: { cookie: `${sessionCookieName}=${dashboardSession}` },
    });
    assert.equal(dashboardResponse.status, 200);
    const body = await dashboardResponse.json() as { availableRsd: number; expiringSoonRsd: number };
    return { availableRsd: body.availableRsd, expiringSoonRsd: body.expiringSoonRsd };
  };
  const reviewAdmin = await user("ADMIN");
  const reviewAdminSession = await createSession(reviewAdmin.id);
  const reviewRequest = (reviewId: string, status: "approved" | "rejected" | "dismissed", detail?: string) =>
    fetch(`http://127.0.0.1:${port}/api/admin/referrals/reviews/${reviewId}`, {
      method: "PATCH",
      headers: {
        cookie: `${sessionCookieName}=${reviewAdminSession}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ status, ...(detail ? { detail } : {}) }),
    });
  const addReview = async (
    made: Awaited<ReturnType<typeof referral>>,
    reasonCode: string,
  ) => {
    const [review] = await db.insert(referralReviewsTable).values({
      attributionId: made.attribution.id,
      qualificationId: made.qualification.id,
      reasonCode,
      detail: "Real PostgreSQL fraud review fixture.",
      score: 50,
    }).returning();
    return review!;
  };

  // Fraud review decisions are lifecycle transitions, not queue-only updates.
  const reviewOwner = await user();
  const approvedB2User = await user();
  const approvedB2 = await referral("B2", { owner: reviewOwner }, approvedB2User, at);
  await db.update(referralAttributionsTable).set({
    status: "under_review", rejectionReason: "normalized_phone_overlap",
  }).where(eq(referralAttributionsTable.id, approvedB2.attribution.id));
  const approvedB2Review = await addReview(approvedB2, "normalized_phone_overlap");
  assert.equal((await reviewRequest(approvedB2Review.id, "approved", "Verified distinct people.")).status, 200);
  const [approvedB2Attribution] = await db.select().from(referralAttributionsTable)
    .where(eq(referralAttributionsTable.id, approvedB2.attribution.id));
  const [approvedB2Qualification] = await db.select().from(referralQualificationsTable)
    .where(eq(referralQualificationsTable.id, approvedB2.qualification.id));
  assert.equal(approvedB2Attribution!.status, "attributed");
  assert.equal(approvedB2Attribution!.rejectionReason, null);
  assert.equal(approvedB2Qualification!.status, "tracking");

  const approvedBusinessUser = await user("SALON_OWNER");
  const approvedBusiness = await referral("B1", { owner: reviewOwner }, approvedBusinessUser, at);
  await db.update(referralAttributionsTable).set({
    status: "under_review", rejectionReason: "legal_entity_overlap",
  }).where(eq(referralAttributionsTable.id, approvedBusiness.attribution.id));
  const approvedBusinessReview = await addReview(approvedBusiness, "legal_entity_overlap");
  assert.equal((await reviewRequest(approvedBusinessReview.id, "approved")).status, 200);
  const [approvedBusinessQualification] = await db.select().from(referralQualificationsTable)
    .where(eq(referralQualificationsTable.id, approvedBusiness.qualification.id));
  assert.equal(approvedBusinessQualification!.status, "pending_verification");
  assert.equal(
    approvedBusinessQualification!.trackingStartedAt?.getTime(),
    approvedBusiness.qualification.trackingStartedAt?.getTime(),
  );

  const blockedUser = await user();
  const blocked = await referral("B2", { owner: reviewOwner }, blockedUser, at);
  await db.update(referralAttributionsTable).set({ status: "under_review" })
    .where(eq(referralAttributionsTable.id, blocked.attribution.id));
  const blockingReview = await addReview(blocked, "normalized_phone_overlap");
  assert.equal((await reviewRequest(blockingReview.id, "dismissed")).status, 409,
    "sole blocking review cannot strand an under-review referral");
  assert.equal((await db.select().from(referralReviewsTable)
    .where(eq(referralReviewsTable.id, blockingReview.id)))[0]!.status, "open");

  const duplicateUser = await user();
  const duplicate = await referral("B2", { owner: reviewOwner }, duplicateUser, at);
  const duplicateReview = await addReview(duplicate, "cap_adjacent_activity");
  assert.equal((await reviewRequest(duplicateReview.id, "dismissed")).status, 200);
  assert.equal((await db.select().from(referralQualificationsTable)
    .where(eq(referralQualificationsTable.id, duplicate.qualification.id)))[0]!.status, "tracking");

  const rejectedUser = await user();
  await proof(rejectedUser);
  const rejected = await referral("B2", { owner: reviewOwner }, rejectedUser, at);
  const rejectedReview = await addReview(rejected, "missing_durable_phone_proof");
  assert.equal((await reviewRequest(rejectedReview.id, "rejected", "Proof could not be established.")).status, 200);
  await qualifyAppointments(rejectedUser, salonOne, 3, at);
  assert.equal((await db.select().from(referralQualificationEvidenceTable)
    .where(eq(referralQualificationEvidenceTable.qualificationId, rejected.qualification.id))).length, 0);
  assert.equal((await db.select().from(referralCreditLedgerTable)
    .where(eq(referralCreditLedgerTable.referralAttributionId, rejected.attribution.id))).length, 0);

  // A late rejection compensates append-only wallet facts exactly once.
  const heldReviewUser = await user();
  const heldReviewReferral = await referral("B2", { owner: reviewOwner }, heldReviewUser, at);
  await db.update(referralQualificationsTable).set({ status: "held" })
    .where(eq(referralQualificationsTable.id, heldReviewReferral.qualification.id));
  await db.insert(referralCreditLedgerTable).values({
    walletKind: "B2C", ownerUserId: reviewOwner.id,
    referralAttributionId: heldReviewReferral.attribution.id,
    type: "held", amountRsd: 100, effectiveAt: new Date(),
    reason: "Fraud review held fixture.",
    idempotencyKey: referralIdempotencyKey("review-held", heldReviewReferral.attribution.id),
  });
  const heldReview = await addReview(heldReviewReferral, "late_fraud_signal");
  assert.equal((await reviewRequest(heldReview.id, "rejected")).status, 200);
  const heldReviewLedger = await db.select().from(referralCreditLedgerTable)
    .where(eq(referralCreditLedgerTable.referralAttributionId, heldReviewReferral.attribution.id));
  assert.equal(heldReviewLedger.filter((entry) => entry.type === "reversed").length, 1);
  assert.equal(deriveReferralCreditBalance(heldReviewLedger), 0);

  const availableReviewUser = await user();
  const availableReviewReferral = await referral("B2", { owner: reviewOwner }, availableReviewUser, at);
  await db.update(referralQualificationsTable).set({ status: "available" })
    .where(eq(referralQualificationsTable.id, availableReviewReferral.qualification.id));
  await db.insert(referralCreditLedgerTable).values({
    walletKind: "B2C", ownerUserId: reviewOwner.id,
    referralAttributionId: availableReviewReferral.attribution.id,
    type: "available", amountRsd: 100, effectiveAt: new Date(Date.now() - 1000),
    reason: "Fraud review unredeemed fixture.",
    idempotencyKey: referralIdempotencyKey("review-unredeemed", availableReviewReferral.attribution.id),
  });
  const availableReview = await addReview(availableReviewReferral, "late_fraud_signal");
  assert.equal((await reviewRequest(availableReview.id, "rejected")).status, 200);
  const availableReviewLedger = await db.select().from(referralCreditLedgerTable)
    .where(eq(referralCreditLedgerTable.referralAttributionId, availableReviewReferral.attribution.id));
  assert.equal(deriveReferralCreditBalance(availableReviewLedger), 0);

  async function fraudSourceLifecycle(
    label: string,
    redemptionAmounts: number[],
    restoredRedemptionIndexes: number[],
    expireBeforeReview: boolean,
  ) {
    const sourceOwner = await user();
    const referred = await user();
    const made = await referral("B2", { owner: sourceOwner }, referred, at);
    await db.update(referralQualificationsTable).set({ status: "available" })
      .where(eq(referralQualificationsTable.id, made.qualification.id));
    const scope: ReferralWalletScope = { walletKind: "B2C", ownerUserId: sourceOwner.id };
    const expiresAt = expireBeforeReview
      ? new Date(Date.now() - 1000)
      : new Date(Date.now() + 86400_000);
    const [source] = await db.insert(referralCreditLedgerTable).values({
      ...scope,
      referralAttributionId: made.attribution.id,
      type: "available",
      amountRsd: 100,
      effectiveAt: new Date(Date.now() - 10_000),
      expiresAt,
      reason: `Fraud source lifecycle fixture: ${label}.`,
      idempotencyKey: referralIdempotencyKey("fraud-source-lifecycle", suffix, label),
    }).returning();
    const redemptionOrders: Array<typeof ordersTable.$inferSelect> = [];
    for (const [index, amountRsd] of redemptionAmounts.entries()) {
      const redemptionOrder = await order(salonOne);
      redemptionOrders.push(redemptionOrder);
      await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
        scope,
        orderId: redemptionOrder.id,
        allocations: [{ ledgerEntryId: source!.id, amountRsd }],
        idempotencyKey: `fraud-source-${suffix}-${label}-${index}`,
        now: new Date(Date.now() - 5000 + index),
      }));
    }
    for (const index of restoredRedemptionIndexes) {
      await db.transaction((tx) => restoreReferralCreditForOrderInTx(tx, {
        scope,
        orderId: redemptionOrders[index]!.id,
        eventKey: `fraud-source-restore-${suffix}-${label}-${index}`,
        now: new Date(Date.now() - 3000 + index),
      }));
    }
    if (expireBeforeReview) await runReferralMaintenance(new Date());
    const review = await addReview(made, "late_fraud_signal");
    assert.equal((await reviewRequest(review.id, "rejected")).status, 200);
    const sourceFacts = await db.select().from(referralCreditLedgerTable).where(
      sql`${referralCreditLedgerTable.metadata}->>'sourceLedgerEntryId' = ${source!.id}`,
    );
    return {
      balance: await db.transaction((tx) => referralCreditBalanceInTx(tx, scope)),
      expired: sourceFacts.filter((entry) => entry.type === "expired"),
      reversed: sourceFacts.filter((entry) => entry.type === "reversed"),
    };
  }

  const expiredUnspentReview = await fraudSourceLifecycle("expired-unspent", [], [], true);
  assert.equal(expiredUnspentReview.balance, 0);
  assert.equal(expiredUnspentReview.expired[0]!.amountRsd, -100);
  assert.equal(expiredUnspentReview.reversed.length, 0,
    "already-expired unspent value creates no additional fraud debt");

  const partialExpiredReview = await fraudSourceLifecycle("partial-expired", [40], [], true);
  assert.equal(partialExpiredReview.expired[0]!.amountRsd, -60);
  assert.equal(partialExpiredReview.reversed[0]!.amountRsd, -40);
  assert.equal(partialExpiredReview.balance, -40,
    "only consumed, unrestored value remains as fraud debt after remainder expiry");

  const fullyRestoredReview = await fraudSourceLifecycle("fully-restored", [100], [0], true);
  assert.equal(fullyRestoredReview.expired[0]!.amountRsd, -100);
  assert.equal(fullyRestoredReview.reversed.length, 0);
  assert.equal(fullyRestoredReview.balance, 0);

  const partiallyRestoredReview = await fraudSourceLifecycle("partially-restored", [40, 60], [0], true);
  assert.equal(partiallyRestoredReview.expired[0]!.amountRsd, -40);
  assert.equal(partiallyRestoredReview.reversed[0]!.amountRsd, -60);
  assert.equal(partiallyRestoredReview.balance, -60);

  const liveUnspentReview = await fraudSourceLifecycle("live-unspent", [], [], false);
  assert.equal(liveUnspentReview.reversed[0]!.amountRsd, -100);
  assert.equal(liveUnspentReview.balance, 0, "rejection removes live reusable capacity");

  const redeemedReviewUser = await user();
  const redeemedReviewReferral = await referral("B2", { owner: reviewOwner }, redeemedReviewUser, at);
  await db.update(referralQualificationsTable).set({ status: "available" })
    .where(eq(referralQualificationsTable.id, redeemedReviewReferral.qualification.id));
  const [redeemedSource] = await db.insert(referralCreditLedgerTable).values({
    walletKind: "B2C", ownerUserId: reviewOwner.id,
    referralAttributionId: redeemedReviewReferral.attribution.id,
    type: "available", amountRsd: 100, effectiveAt: new Date(Date.now() - 1000),
    reason: "Fraud review available fixture.",
    idempotencyKey: referralIdempotencyKey("review-available", redeemedReviewReferral.attribution.id),
  }).returning();
  const redeemedOrder = await order(salonOne);
  await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
    scope: { walletKind: "B2C", ownerUserId: reviewOwner.id },
    orderId: redeemedOrder.id,
    allocations: [{ ledgerEntryId: redeemedSource!.id, amountRsd: 100 }],
    idempotencyKey: `review-redemption:${redeemedReviewReferral.attribution.id}`,
  }));
  const redeemedReview = await addReview(redeemedReviewReferral, "late_fraud_signal");
  const replayedDecisions = await Promise.all([
    reviewRequest(redeemedReview.id, "rejected"),
    reviewRequest(redeemedReview.id, "rejected"),
  ]);
  assert.deepEqual(replayedDecisions.map((response) => response.status).sort(), [200, 409]);
  const redeemedReviewLedger = await db.select().from(referralCreditLedgerTable)
    .where(eq(referralCreditLedgerTable.referralAttributionId, redeemedReviewReferral.attribution.id));
  assert.equal(redeemedReviewLedger.filter((entry) => entry.type === "reversed").length, 1);
  assert.equal(await db.transaction((tx) => referralCreditBalanceInTx(tx, {
    walletKind: "B2C",
    ownerUserId: reviewOwner.id,
  })), -100);

  // Milestone neutralization is limited to the rejected referral's source.
  const fraudMilestoneOwner = await user("SALON_OWNER");
  const milestoneSource = await salon(fraudMilestoneOwner, "review-milestone-source");
  const milestoneOtherSource = await salon(fraudMilestoneOwner, "review-milestone-other");
  const milestoneReferred = await user();
  const milestoneReferral = await referral(
    "A", { owner: fraudMilestoneOwner, salon: milestoneSource }, milestoneReferred, at,
  );
  await db.update(referralQualificationsTable).set({ status: "held" })
    .where(eq(referralQualificationsTable.id, milestoneReferral.qualification.id));
  const milestoneRows = await db.insert(referralMilestoneBenefitsTable).values([
    {
      referrerUserId: fraudMilestoneOwner.id,
      channel: "A",
      benefitSalonId: milestoneSource.id,
      qualifyingCount: 10,
      kind: "salon_subscription_reduction",
      idempotencyKey: referralIdempotencyKey("review-milestone", milestoneSource.id),
    },
    {
      referrerUserId: fraudMilestoneOwner.id,
      channel: "A",
      benefitSalonId: milestoneOtherSource.id,
      qualifyingCount: 10,
      kind: "salon_subscription_reduction",
      idempotencyKey: referralIdempotencyKey("review-milestone", milestoneOtherSource.id),
    },
  ]).returning();
  const milestoneReview = await addReview(milestoneReferral, "late_fraud_signal");
  assert.equal((await reviewRequest(milestoneReview.id, "rejected")).status, 200);
  const neutralizedMilestones = await db.select().from(referralMilestoneBenefitsTable)
    .where(inArray(referralMilestoneBenefitsTable.id, milestoneRows.map((row) => row.id)));
  assert.ok(neutralizedMilestones.find((row) => row.benefitSalonId === milestoneSource.id)!.neutralizedAt);
  assert.equal(neutralizedMilestones.find((row) => row.benefitSalonId === milestoneOtherSource.id)!.neutralizedAt, null);

  const response = await fetch(`http://127.0.0.1:${port}/api/referrals/dashboard`, {
    headers: { cookie: `${sessionCookieName}=${session}` },
  });
  assert.equal(response.status, 200);
  const dashboard = await response.json() as { channels: Array<{ channel: string; sourceBusinessId: string | null; code: string }> };
  assert.equal(dashboard.channels.length, 7, "same owner receives account plus per-location salon and education codes");
  assert.equal(new Set(dashboard.channels.map((item) => item.code)).size, 7, "every source scope receives a distinct stable code");
  assert.deepEqual(
    new Set(dashboard.channels.filter((item) => item.channel === "A").map((item) => item.sourceBusinessId)),
    new Set([salonOne.id, salonTwo.id, education.id]),
  );
  assert.ok(!dashboard.channels.some((item) => item.sourceBusinessId === outsiderSalon.id), "dashboard excludes another owner's business");

  // Every registration surface (including the contexts used by OAuth customer
  // creation and OAuth business completion) has an explicit channel matrix.
  const matrixSource = await user("SALON_OWNER");
  const matrixSalon = await salon(matrixSource, "matrix-source");
  const matrixCenter = await center(matrixSource, "matrix-source");
  const matrixCodes = {
    A: await db.transaction((tx) => ensureReferralCode(tx, {
      channel: "A", referrerUserId: matrixSource.id, sourceBusiness: "salon", sourceBusinessId: matrixSalon.id,
    })),
    B1: await db.transaction((tx) => ensureReferralCode(tx, { channel: "B1", referrerUserId: matrixSource.id })),
    B2: await db.transaction((tx) => ensureReferralCode(tx, { channel: "B2", referrerUserId: matrixSource.id })),
    C: await db.transaction((tx) => ensureReferralCode(tx, {
      channel: "C", referrerUserId: matrixSource.id, sourceBusiness: "education_center", sourceBusinessId: matrixCenter.id,
    })),
    D: await db.transaction((tx) => ensureReferralCode(tx, {
      channel: "D", referrerUserId: matrixSource.id, sourceBusiness: "salon", sourceBusinessId: matrixSalon.id,
    })),
  };
  const allowedMatrix: Record<string, ReferralChannel[]> = {
    customer: ["B2", "D"],
    oauth_customer: ["B2", "D"],
    jobseeker: [],
    student: ["C"],
    business_salon: ["A", "B1"],
    business_education: ["A", "B1"],
    oauth_business_salon: ["A", "B1"],
    oauth_business_education: ["A", "B1"],
  };
  for (const [registrationContext, allowed] of Object.entries(allowedMatrix)) {
    for (const channel of ["A", "B1", "B2", "C", "D"] as ReferralChannel[]) {
      assert.equal(matrixCodes[channel].channel, channel);
      const referred = await user(registrationContext === "student" ? "STUDENT"
        : registrationContext === "jobseeker" ? "JOBSEEKER" : "CUSTOMER");
      const targetSalon = registrationContext.endsWith("business_salon")
        ? await salon(referred, `matrix-${registrationContext}-${channel}`)
        : null;
      const targetCenter = registrationContext.endsWith("business_education")
        ? await center(referred, `matrix-${registrationContext}-${channel}`)
        : null;
      const capture = db.transaction((tx) => captureReferralAttributionInTx(tx, {
        referralCode: matrixCodes[channel].code,
        referredUserId: referred.id,
        phoneNormalized: referred.phoneNormalized,
        registrationContext: registrationContext as Parameters<typeof captureReferralAttributionInTx>[1]["registrationContext"],
        referredSalonId: targetSalon?.id,
        referredEducationCenterId: targetCenter?.id,
        now: at,
      }));
      if (allowed.includes(channel)) {
        assert.ok(await capture, `${registrationContext} allows ${channel}`);
      } else {
        await assert.rejects(capture, (error) =>
          error instanceof ReferralChannelContextError
          && error.code === "REFERRAL_CHANNEL_CONTEXT_INVALID",
        `${registrationContext} rejects ${channel}`);
      }
    }
  }

  // Evidence idempotency and source isolation for both authoritative source kinds.
  const dStudent = await user();
  await proof(dStudent);
  const dReferral = await referral("D", { owner, salon: salonOne }, dStudent, at);
  const wrongAppointment = await appointment(salonTwo, dStudent);
  const wrongD = await appointmentTransition(dStudent, salonTwo, at, true, wrongAppointment.id);
  assert.equal(wrongD.matched, false);
  const dAppointment = await appointment(salonOne, dStudent);
  await Promise.all([
    appointmentTransition(dStudent, salonOne, at, true, dAppointment.id),
    appointmentTransition(dStudent, salonOne, at, true, dAppointment.id),
  ]);
  assert.equal((await db.select().from(referralQualificationEvidenceTable)
    .where(eq(referralQualificationEvidenceTable.qualificationId, dReferral.qualification.id))).length, 1);

  const cStudent = await user();
  const cReferral = await referral("C", { owner, center: education }, cStudent, at);
  const otherCenter = await center(outsider, "other-education");
  const wrongEnrollment = await enrollment(otherCenter, cStudent);
  assert.equal((await enrollmentTransition(cStudent, otherCenter, at, true, wrongEnrollment.id)).matched, false);
  const cEnrollment = await enrollment(education, cStudent);
  await Promise.all([
    enrollmentTransition(cStudent, education, at, true, cEnrollment.id),
    enrollmentTransition(cStudent, education, at, true, cEnrollment.id),
  ]);
  assert.equal((await db.select().from(referralQualificationEvidenceTable)
    .where(eq(referralQualificationEvidenceTable.qualificationId, cReferral.qualification.id))).length, 1);

  // Fixed capture-based windows use [start, deadline): activity before capture,
  // exactly at deadline, after it, or in a years-late burst never qualifies.
  const boundaryOwner = await user();
  const b2BoundaryUser = await user();
  await proof(b2BoundaryUser);
  const b2Boundary = await referral("B2", { owner: boundaryOwner }, b2BoundaryUser, at);
  const b2Window = qualificationWindow("B2", b2Boundary.attribution.capturedAt);
  await appointmentTransition(b2BoundaryUser, salonOne, new Date(b2Window.start.getTime() - 1));
  const b2ValidIds = await qualifyAppointments(b2BoundaryUser, salonOne, 2, b2Window.start);
  await appointmentTransition(b2BoundaryUser, salonOne, b2Window.deadline);
  await appointmentTransition(b2BoundaryUser, salonOne, new Date(b2Window.deadline.getTime() + 1));
  await appointmentTransition(b2BoundaryUser, salonOne,
    new Date(b2Window.deadline.getTime() + 5 * 365 * 86400_000));
  assert.equal((await db.select().from(referralQualificationEvidenceTable).where(eq(
    referralQualificationEvidenceTable.qualificationId, b2Boundary.qualification.id,
  ))).length, 2);
  await appointmentTransition(b2BoundaryUser, salonOne,
    new Date(b2Window.deadline.getTime() + 1000), false, b2ValidIds[0]);
  assert.equal((await db.select().from(referralQualificationEvidenceTable).where(and(
    eq(referralQualificationEvidenceTable.qualificationId, b2Boundary.qualification.id),
    sql`${referralQualificationEvidenceTable.invalidatedAt} is null`,
  ))).length, 1, "cancellation after the deadline still invalidates in-window evidence");

  const dBoundaryUser = await user();
  await proof(dBoundaryUser);
  const dBoundary = await referral("D", { owner, salon: salonOne }, dBoundaryUser, at);
  const dWindow = qualificationWindow("D", dBoundary.attribution.capturedAt);
  assert.equal((await appointmentTransition(dBoundaryUser, salonOne, dWindow.deadline)).qualified, false);
  assert.equal((await appointmentTransition(dBoundaryUser, salonOne,
    new Date(dWindow.deadline.getTime() + 10 * 365 * 86400_000))).qualified, false);

  const cBoundaryUser = await user();
  const cBoundary = await referral("C", { owner, center: education }, cBoundaryUser, at);
  const cWindow = qualificationWindow("C", cBoundary.attribution.capturedAt);
  await qualifyEnrollments(cBoundaryUser, education, 3, cWindow.start);
  assert.equal((await enrollmentTransition(cBoundaryUser, education, cWindow.deadline)).qualified, false);
  assert.equal((await enrollmentTransition(cBoundaryUser, education,
    new Date(cWindow.deadline.getTime() + 4 * 365 * 86400_000))).qualified, false);

  // Business evidence is locked until approval, then uses that immutable
  // approval instant rather than the event's occurredAt as a rolling anchor.
  const businessBoundaryUser = await user("SALON_OWNER");
  const businessBoundary = await referral(
    "A", { owner, salon: salonTwo }, businessBoundaryUser, new Date(Date.now() - 86400_000),
  );
  await db.update(referralQualificationsTable).set({
    status: "pending_verification", trackingStartedAt: null,
  }).where(eq(referralQualificationsTable.id, businessBoundary.qualification.id));
  await appointmentTransition(
    businessBoundaryUser, salonTwo, new Date(businessBoundary.attribution.capturedAt.getTime() + 1),
  );
  assert.equal((await db.select().from(referralQualificationEvidenceTable).where(eq(
    referralQualificationEvidenceTable.qualificationId, businessBoundary.qualification.id,
  ))).length, 0, "A evidence before approval is not counted");
  const approvalAdmin = await user("ADMIN");
  await decideReferredBusinessApproval(approvalAdmin.id, businessBoundary.attribution.id, "approve");
  const [approvedQualification] = await db.select().from(referralQualificationsTable)
    .where(eq(referralQualificationsTable.id, businessBoundary.qualification.id));
  assert.ok(approvedQualification?.trackingStartedAt);
  const businessWindow = qualificationWindow(
    "A", businessBoundary.attribution.capturedAt, approvedQualification!.trackingStartedAt,
  );
  await qualifyAppointments(businessBoundaryUser, salonTwo, 3, businessWindow.start);
  assert.equal((await appointmentTransition(
    businessBoundaryUser, salonTwo, businessWindow.deadline,
  )).qualified, false, "A evidence exactly at the deadline is excluded");
  assert.equal((await appointmentTransition(
    businessBoundaryUser, salonTwo, new Date(businessWindow.deadline.getTime() - 1),
  )).qualified, true, "A evidence immediately before the deadline qualifies");

  const b1BusinessUser = await user("SALON_OWNER");
  const b1BusinessSalon = await salon(b1BusinessUser, "b1-window-target");
  const b1Code = await db.transaction((tx) => ensureReferralCode(tx, {
    channel: "B1", referrerUserId: boundaryOwner.id,
  }));
  const [b1Attribution] = await db.insert(referralAttributionsTable).values({
    referralCodeId: b1Code.id, channel: "B1", referrerUserId: boundaryOwner.id,
    referredUserId: b1BusinessUser.id, referredSalonId: b1BusinessSalon.id,
    status: "attributed", capturedAt: new Date(Date.now() - 86400_000),
    lockedUntil: new Date(Date.now() + 30 * 86400_000),
    idempotencyKey: referralIdempotencyKey("b1-window-attribution", b1BusinessUser.id),
  }).returning();
  const [b1Qualification] = await db.insert(referralQualificationsTable).values({
    attributionId: b1Attribution!.id, referredSalonId: b1BusinessSalon.id,
    status: "pending_verification", requiredEvidenceCount: 4,
  }).returning();
  await appointmentTransition(b1BusinessUser, b1BusinessSalon, new Date());
  assert.equal((await db.select().from(referralQualificationEvidenceTable).where(eq(
    referralQualificationEvidenceTable.qualificationId, b1Qualification!.id,
  ))).length, 0, "B1 evidence before approval is not counted");
  await decideReferredBusinessApproval(approvalAdmin.id, b1Attribution!.id, "approve");
  const [approvedB1] = await db.select().from(referralQualificationsTable)
    .where(eq(referralQualificationsTable.id, b1Qualification!.id));
  const b1Window = qualificationWindow("B1", b1Attribution!.capturedAt, approvedB1!.trackingStartedAt);
  await qualifyAppointments(b1BusinessUser, b1BusinessSalon, 3, b1Window.start);
  assert.equal((await appointmentTransition(b1BusinessUser, b1BusinessSalon, b1Window.deadline)).qualified, false);
  assert.equal((await appointmentTransition(
    b1BusinessUser, b1BusinessSalon, new Date(b1Window.deadline.getTime() - 1),
  )).qualified, true);

  // Hard caps: hold the exact production lock and prove both contenders queue.
  await capRace("B2", await user(), salonOne, at);
  await capRace("D", await user("SALON_OWNER"), salonTwo, at);

  // Concurrent held release is a single available fact and single event per outbox.
  const releaseOwner = await user();
  await proof(releaseOwner);
  const releaseReferred = await user();
  await proof(releaseReferred);
  const held = await referral("B2", { owner: releaseOwner }, releaseReferred, at);
  await qualifyAppointments(releaseReferred, salonOne, 3, at);
  const releaseAt = new Date(at.getTime() + 15 * 86400_000);
  await Promise.all([runReferralMaintenance(releaseAt), runReferralMaintenance(releaseAt)]);
  const availableRows = await db.select().from(referralCreditLedgerTable).where(and(
    eq(referralCreditLedgerTable.referralAttributionId, held.attribution.id),
    eq(referralCreditLedgerTable.type, "available"),
  ));
  assert.equal(availableRows.length, 1);
  const availableEvent = `referral-credit-available:${held.attribution.id}`;
  assert.equal((await db.select().from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, availableEvent))).length, 1);
  assert.equal((await db.select().from(smsDeliveriesTable).where(eq(smsDeliveriesTable.eventKey, availableEvent))).length, 1);

  // Appointment invalidation while held writes one inert compensation.
  const heldCancelOwner = await user();
  const heldCancelUser = await user();
  await proof(heldCancelUser);
  const heldCancel = await referral("B2", { owner: heldCancelOwner }, heldCancelUser, at);
  const heldEvidence = await qualifyAppointments(heldCancelUser, salonOne, 3, at);
  await Promise.all([
    appointmentTransition(heldCancelUser, salonOne, new Date(at.getTime() + 1000), false, heldEvidence[0]),
    appointmentTransition(heldCancelUser, salonOne, new Date(at.getTime() + 1000), false, heldEvidence[0]),
  ]);
  const heldCancelLedger = await db.select().from(referralCreditLedgerTable)
    .where(eq(referralCreditLedgerTable.referralAttributionId, heldCancel.attribution.id));
  assert.equal(heldCancelLedger.filter((entry) => entry.type === "reversed").length, 1);
  assert.equal(deriveReferralCreditBalance(heldCancelLedger, new Date(at.getTime() + 2000)), 0);

  // Appointment cancellation after partial spend produces one clawback and a negative wallet.
  const partialOwner = await user();
  const partialUser = await user();
  await proof(partialUser);
  const partial = await referral("B2", { owner: partialOwner }, partialUser, at);
  const partialEvidence = await qualifyAppointments(partialUser, salonOne, 3, at);
  await runReferralMaintenance(releaseAt);
  const partialSource = (await db.select().from(referralCreditLedgerTable).where(and(
    eq(referralCreditLedgerTable.referralAttributionId, partial.attribution.id),
    eq(referralCreditLedgerTable.type, "available"),
  )))[0]!;
  const partialScope: ReferralWalletScope = { ownerUserId: partialOwner.id, walletKind: "B2C" };
  const partialOrder = await order(salonOne);
  await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
    scope: partialScope,
    orderId: partialOrder.id,
    allocations: [{ ledgerEntryId: partialSource.id, amountRsd: 40 }],
    idempotencyKey: `partial-${suffix}`,
    now: releaseAt,
  }));
  await Promise.all([
    appointmentTransition(partialUser, salonOne, new Date(releaseAt.getTime() + 1000), false, partialEvidence[0]),
    appointmentTransition(partialUser, salonOne, new Date(releaseAt.getTime() + 1000), false, partialEvidence[0]),
  ]);
  const partialLedger = await db.select().from(referralCreditLedgerTable)
    .where(eq(referralCreditLedgerTable.ownerUserId, partialOwner.id));
  assert.equal(partialLedger.filter((entry) => entry.type === "reversed").length, 1);
  assert.equal(deriveReferralCreditBalance(partialLedger, new Date(releaseAt.getTime() + 2000)), -40);

  // Enrollment refund after full spend follows the same source-backed clawback path.
  const fullOwner = await user("EDUKATIVNI_CENTAR");
  const fullCenter = await center(fullOwner, "full-redemption");
  const fullUser = await user();
  const full = await referral("C", { owner: fullOwner, center: fullCenter }, fullUser, at);
  const fullEvidence = await qualifyEnrollments(fullUser, fullCenter, 4, at);
  await runReferralMaintenance(releaseAt);
  const fullSource = (await db.select().from(referralCreditLedgerTable).where(and(
    eq(referralCreditLedgerTable.referralAttributionId, full.attribution.id),
    eq(referralCreditLedgerTable.type, "available"),
  )))[0]!;
  const fullScope: ReferralWalletScope = { ownerUserId: fullOwner.id, walletKind: "B2B", educationCenterId: fullCenter.id };
  const fullOrder = await order(salonOne);
  await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
    scope: fullScope,
    orderId: fullOrder.id,
    allocations: [{ ledgerEntryId: fullSource.id, amountRsd: 500 }],
    idempotencyKey: `full-${suffix}`,
    now: releaseAt,
  }));
  await Promise.all([
    enrollmentTransition(fullUser, fullCenter, new Date(releaseAt.getTime() + 1000), false, fullEvidence[0]),
    enrollmentTransition(fullUser, fullCenter, new Date(releaseAt.getTime() + 1000), false, fullEvidence[0]),
  ]);
  const fullLedger = await db.select().from(referralCreditLedgerTable)
    .where(eq(referralCreditLedgerTable.ownerUserId, fullOwner.id));
  assert.equal(fullLedger.filter((entry) => entry.type === "reversed").length, 1);
  assert.equal(deriveReferralCreditBalance(fullLedger, new Date(releaseAt.getTime() + 2000)), -500);

  // Expiry is source-remainder based and duplicate workers cannot duplicate it.
  const expiryOwner = await user();
  const expiryScope: ReferralWalletScope = { ownerUserId: expiryOwner.id, walletKind: "B2C" };
  const expiryAt = new Date(at.getTime() + 86400_000);
  const expirySource = await insertAvailable(expiryScope, 100, expiryAt, `expiry-source-${suffix}`);
  const expiryOrder = await order(salonOne);
  await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
    scope: expiryScope,
    orderId: expiryOrder.id,
    allocations: [{ ledgerEntryId: expirySource.id, amountRsd: 35 }],
    idempotencyKey: `expiry-spend-${suffix}`,
    now: new Date(expiryAt.getTime() - 1000),
  }));
  await Promise.all([runReferralMaintenance(expiryAt), runReferralMaintenance(expiryAt)]);
  const expiryFacts = await db.select().from(referralCreditLedgerTable).where(and(
    eq(referralCreditLedgerTable.type, "expired"),
    sql`${referralCreditLedgerTable.metadata}->>'sourceLedgerEntryId' = ${expirySource.id}`,
  ));
  assert.equal(expiryFacts.length, 1);
  assert.equal(expiryFacts[0]!.amountRsd, -65);

  // Two real checkout transactions share the wallet lock and cannot overspend.
  const checkoutOwner = await user();
  const checkoutScope: ReferralWalletScope = { ownerUserId: checkoutOwner.id, walletKind: "B2C" };
  await insertAvailable(checkoutScope, 100, new Date(at.getTime() + 30 * 86400_000), `checkout-source-${suffix}`);
  const checkoutOrders = [await order(salonOne), await order(salonOne)];
  const spend = (index: number) => db.transaction(async (tx) => {
    const allocation = await allocateReferralCreditInTx(tx, checkoutScope, 80, 80, at);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await recordReferralRedemptionInTx(tx, {
      scope: checkoutScope,
      orderId: checkoutOrders[index]!.id,
      allocations: allocation.allocations,
      idempotencyKey: `checkout-${suffix}-${index}`,
      now: at,
    });
    return allocation.appliedRsd;
  });
  const applied = await Promise.all([spend(0), spend(1)]);
  assert.deepEqual([...applied].sort((a, b) => a - b), [20, 80]);

  // A restored allocation returns to its exact source, can be spent again, and
  // each later order cancellation restores that new redemption exactly once.
  const reuseOwner = await user();
  const reuseScope: ReferralWalletScope = { ownerUserId: reuseOwner.id, walletKind: "B2C" };
  const reuseSource = await insertAvailable(
    reuseScope, 100, new Date(at.getTime() + 30 * 86400_000), `reuse-source-${suffix}`,
  );
  const reuseOrderOne = await order(salonOne);
  await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
    scope: reuseScope,
    orderId: reuseOrderOne.id,
    allocations: [{ ledgerEntryId: reuseSource.id, amountRsd: 100 }],
    idempotencyKey: `reuse-first-${suffix}`,
    now: at,
  }));
  await db.transaction((tx) => restoreReferralCreditForOrderInTx(tx, {
    scope: reuseScope, orderId: reuseOrderOne.id, eventKey: `cancel-first-${suffix}`, now: at,
  }));
  await db.transaction((tx) => restoreReferralCreditForOrderInTx(tx, {
    scope: reuseScope, orderId: reuseOrderOne.id, eventKey: `cancel-first-replay-${suffix}`, now: at,
  }));
  const afterFirstRestore = await db.transaction((tx) =>
    allocateReferralCreditInTx(tx, reuseScope, 100, 100, at));
  assert.deepEqual(afterFirstRestore.allocations, [{ ledgerEntryId: reuseSource.id, amountRsd: 100 }]);
  const reuseOrderTwo = await order(salonOne);
  await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
    scope: reuseScope, orderId: reuseOrderTwo.id, allocations: afterFirstRestore.allocations,
    idempotencyKey: `reuse-second-${suffix}`, now: at,
  }));
  await db.transaction((tx) => restoreReferralCreditForOrderInTx(tx, {
    scope: reuseScope, orderId: reuseOrderTwo.id, eventKey: `refund-second-${suffix}`, now: at,
  }));
  const afterSecondRestore = await db.transaction((tx) =>
    allocateReferralCreditInTx(tx, reuseScope, 100, 100, at));
  assert.equal(afterSecondRestore.appliedRsd, 100);
  const reuseRestorations = await db.select().from(referralCreditLedgerTable).where(and(
    eq(referralCreditLedgerTable.type, "restored"),
    sql`${referralCreditLedgerTable.metadata}->>'sourceLedgerEntryId' = ${reuseSource.id}`,
  ));
  assert.equal(reuseRestorations.length, 2, "one exact restoration exists for each distinct redemption");
  const reuseRaceOrders = [await order(salonOne), await order(salonOne)];
  const reuseRace = (index: number) => db.transaction(async (tx) => {
    const allocation = await allocateReferralCreditInTx(tx, reuseScope, 100, 100, at);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await recordReferralRedemptionInTx(tx, {
      scope: reuseScope, orderId: reuseRaceOrders[index]!.id, allocations: allocation.allocations,
      idempotencyKey: `reuse-race-${suffix}-${index}`, now: at,
    });
    return allocation.appliedRsd;
  });
  assert.deepEqual((await Promise.all([reuseRace(0), reuseRace(1)])).sort((a, b) => a - b), [0, 100],
    "concurrent recheckout cannot double-spend restored capacity");

  const multiOwner = await user();
  const multiScope: ReferralWalletScope = { ownerUserId: multiOwner.id, walletKind: "B2C" };
  const multiSourceOne = await insertAvailable(
    multiScope, 60, new Date(at.getTime() + 30 * 86400_000), `multi-source-one-${suffix}`,
  );
  const multiSourceTwo = await insertAvailable(
    multiScope, 40, new Date(at.getTime() + 30 * 86400_000), `multi-source-two-${suffix}`,
  );
  const multiOrder = await order(salonOne);
  const originalMultiAllocations = (await db.transaction((tx) =>
    allocateReferralCreditInTx(tx, multiScope, 100, 100, at))).allocations;
  assert.deepEqual(new Map(originalMultiAllocations.map((item) => [item.ledgerEntryId, item.amountRsd])),
    new Map([[multiSourceOne.id, 60], [multiSourceTwo.id, 40]]));
  await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
    scope: multiScope, orderId: multiOrder.id, allocations: originalMultiAllocations,
    idempotencyKey: `multi-spend-${suffix}`, now: at,
  }));
  await db.transaction((tx) => restoreReferralCreditForOrderInTx(tx, {
    scope: multiScope, orderId: multiOrder.id, eventKey: `multi-cancel-${suffix}`, now: at,
  }));
  const restoredMultiAllocation = await db.transaction((tx) =>
    allocateReferralCreditInTx(tx, multiScope, 100, 100, at));
  assert.deepEqual(restoredMultiAllocation.allocations, originalMultiAllocations,
    "multi-source cancellation restores each exact allocation to its source");

  // Terminal source facts are enforced per source rather than inferred from the
  // aggregate wallet. A later valid grant can offset debt, but cannot make the
  // earlier invalid source selectable again.
  const terminalOwner = await user();
  const terminalScope: ReferralWalletScope = { ownerUserId: terminalOwner.id, walletKind: "B2C" };
  const terminalExpiry = new Date(at.getTime() + 30 * 86400_000);
  const invalidUnspent = await insertAvailable(
    terminalScope, 100, terminalExpiry, `terminal-unspent-${suffix}`,
  );
  await db.insert(referralCreditLedgerTable).values({
    ...terminalScope,
    type: "reversed",
    amountRsd: -100,
    effectiveAt: at,
    reason: "Terminal source allocation fixture.",
    idempotencyKey: `terminal-unspent-reversed-${suffix}`,
    metadata: { sourceLedgerEntryId: invalidUnspent.id },
  });
  const validAfterInvalidation = await insertAvailable(
    terminalScope, 100, terminalExpiry, `terminal-valid-${suffix}`,
  );
  const terminalFirst = await db.transaction((tx) =>
    allocateReferralCreditInTx(tx, terminalScope, 100, 100, at));
  assert.deepEqual(terminalFirst.allocations, [
    { ledgerEntryId: validAfterInvalidation.id, amountRsd: 100 },
  ], "checkout skips an unspent invalidated FIFO source");
  const terminalOrder = await order(salonOne);
  await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
    scope: terminalScope,
    orderId: terminalOrder.id,
    allocations: terminalFirst.allocations,
    idempotencyKey: `terminal-valid-spend-${suffix}`,
    now: at,
  }));
  await db.transaction((tx) => restoreReferralCreditForOrderInTx(tx, {
    scope: terminalScope,
    orderId: terminalOrder.id,
    eventKey: `terminal-valid-refund-${suffix}`,
    now: at,
  }));
  const terminalRecheckout = await db.transaction((tx) =>
    allocateReferralCreditInTx(tx, terminalScope, 100, 100, at));
  assert.deepEqual(terminalRecheckout.allocations, [
    { ledgerEntryId: validAfterInvalidation.id, amountRsd: 100 },
  ], "refund and recheckout continue to use only the valid source");

  const debtOwner = await user();
  const debtScope: ReferralWalletScope = { ownerUserId: debtOwner.id, walletKind: "B2C" };
  const debtSource = await insertAvailable(debtScope, 100, terminalExpiry, `debt-source-${suffix}`);
  const debtOrder = await order(salonOne);
  await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
    scope: debtScope,
    orderId: debtOrder.id,
    allocations: [{ ledgerEntryId: debtSource.id, amountRsd: 40 }],
    idempotencyKey: `debt-source-spend-${suffix}`,
    now: at,
  }));
  await db.insert(referralCreditLedgerTable).values({
    ...debtScope,
    type: "reversed",
    amountRsd: -100,
    effectiveAt: at,
    reason: "Consumed invalid source debt fixture.",
    idempotencyKey: `debt-source-reversed-${suffix}`,
    metadata: { sourceLedgerEntryId: debtSource.id },
  });
  const debtValidSource = await insertAvailable(
    debtScope, 100, terminalExpiry, `debt-valid-source-${suffix}`,
  );
  const debtAllocation = await db.transaction((tx) =>
    allocateReferralCreditInTx(tx, debtScope, 100, 100, at));
  assert.equal(debtAllocation.availableRsd, 60, "unrestored invalid value remains wallet debt");
  assert.deepEqual(debtAllocation.allocations, [
    { ledgerEntryId: debtValidSource.id, amountRsd: 60 },
  ], "debt offsets the later source before it can be spent");

  const restoredInvalidOwner = await user();
  const restoredInvalidScope: ReferralWalletScope = {
    ownerUserId: restoredInvalidOwner.id, walletKind: "B2C",
  };
  const restoredInvalidSource = await insertAvailable(
    restoredInvalidScope, 100, terminalExpiry, `restored-invalid-source-${suffix}`,
  );
  const restoredInvalidOrder = await order(salonOne);
  await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
    scope: restoredInvalidScope,
    orderId: restoredInvalidOrder.id,
    allocations: [{ ledgerEntryId: restoredInvalidSource.id, amountRsd: 100 }],
    idempotencyKey: `restored-invalid-spend-${suffix}`,
    now: at,
  }));
  await db.transaction((tx) => restoreReferralCreditForOrderInTx(tx, {
    scope: restoredInvalidScope,
    orderId: restoredInvalidOrder.id,
    eventKey: `restored-invalid-refund-${suffix}`,
    now: at,
  }));
  await db.insert(referralCreditLedgerTable).values({
    ...restoredInvalidScope,
    type: "reversed",
    amountRsd: -100,
    effectiveAt: at,
    reason: "Restored then invalidated source fixture.",
    idempotencyKey: `restored-invalid-reversed-${suffix}`,
    metadata: { sourceLedgerEntryId: restoredInvalidSource.id },
  });
  const validAfterRestoreInvalidation = await insertAvailable(
    restoredInvalidScope, 100, terminalExpiry, `restored-invalid-valid-${suffix}`,
  );
  const restoredInvalidAllocation = await db.transaction((tx) =>
    allocateReferralCreditInTx(tx, restoredInvalidScope, 100, 100, at));
  assert.deepEqual(restoredInvalidAllocation.allocations, [
    { ledgerEntryId: validAfterRestoreInvalidation.id, amountRsd: 100 },
  ], "a restoration cannot revive a subsequently invalidated source");

  const raceOwner = await user();
  const raceReferred = await user();
  const raceReferral = await referral("B2", { owner: raceOwner }, raceReferred, at);
  const raceScope: ReferralWalletScope = { ownerUserId: raceOwner.id, walletKind: "B2C" };
  const [raceSource] = await db.insert(referralCreditLedgerTable).values({
    ...raceScope,
    referralAttributionId: raceReferral.attribution.id,
    type: "available",
    amountRsd: 100,
    effectiveAt: new Date(at.getTime() - 1000),
    expiresAt: terminalExpiry,
    reason: "Checkout and invalidation race fixture.",
    idempotencyKey: `terminal-race-source-${suffix}`,
  }).returning();
  const raceOrder = await order(salonOne);
  const raceCheckout = db.transaction(async (tx) => {
    const allocation = await allocateReferralCreditInTx(tx, raceScope, 100, 100, at);
    await recordReferralRedemptionInTx(tx, {
      scope: raceScope,
      orderId: raceOrder.id,
      allocations: allocation.allocations,
      idempotencyKey: `terminal-race-checkout-${suffix}`,
      now: at,
    });
    return allocation.appliedRsd;
  });
  const raceInvalidation = db.transaction((tx) => compensateInvalidatedReferralSourcesInTx(tx, {
    attributionId: raceReferral.attribution.id,
    scope: raceScope,
    now: at,
    reason: "Concurrent invalidation fixture.",
  }));
  const [raceApplied] = await Promise.all([raceCheckout, raceInvalidation]);
  assert.ok(raceApplied === 0 || raceApplied === 100,
    "checkout/invalidation resolves to one complete serial outcome");
  const afterRace = await db.transaction((tx) =>
    allocateReferralCreditInTx(tx, raceScope, 100, 100, at));
  assert.equal(afterRace.appliedRsd, 0);
  assert.equal(afterRace.allocations.some((allocation) => allocation.ledgerEntryId === raceSource!.id), false,
    "the invalidated race source is unavailable after either serial outcome");

  // The same source rules are scoped to a concrete B2B wallet; credits owned by
  // another salon of the same tenant are neither counted nor allocated.
  const scopedOwner = await user("SALON_OWNER");
  const scopedSalon = await salon(scopedOwner, "terminal-scope");
  const otherScopedSalon = await salon(scopedOwner, "terminal-other-scope");
  const b2bScope: ReferralWalletScope = {
    ownerUserId: scopedOwner.id, walletKind: "B2B", salonId: scopedSalon.id,
  };
  const otherB2bScope: ReferralWalletScope = {
    ownerUserId: scopedOwner.id, walletKind: "B2B", salonId: otherScopedSalon.id,
  };
  const b2bInvalid = await insertAvailable(b2bScope, 100, terminalExpiry, `b2b-invalid-${suffix}`);
  await db.insert(referralCreditLedgerTable).values({
    ...b2bScope,
    type: "expired",
    amountRsd: -100,
    effectiveAt: at,
    reason: "B2B terminal source fixture.",
    idempotencyKey: `b2b-invalid-expired-${suffix}`,
    metadata: { sourceLedgerEntryId: b2bInvalid.id },
  });
  const b2bValid = await insertAvailable(b2bScope, 75, terminalExpiry, `b2b-valid-${suffix}`);
  await insertAvailable(otherB2bScope, 500, terminalExpiry, `b2b-other-wallet-${suffix}`);
  const b2bAllocation = await db.transaction((tx) =>
    allocateReferralCreditInTx(tx, b2bScope, 500, 500, at));
  assert.equal(b2bAllocation.availableRsd, 75);
  assert.deepEqual(b2bAllocation.allocations, [{ ledgerEntryId: b2bValid.id, amountRsd: 75 }]);

  // Dashboard wallet projections use the same source identities and terminal
  // semantics as checkout, including exact expiring capacity.
  const dashboardFactAt = new Date(Date.now() - 5_000);
  const dashboardExpiry = new Date(Date.now() + 7 * 86400_000);

  const expiredRestoredOwner = await user();
  const expiredRestoredScope: ReferralWalletScope = {
    ownerUserId: expiredRestoredOwner.id, walletKind: "B2C",
  };
  const expiredRestoredSource = await insertAvailable(
    expiredRestoredScope, 100, dashboardExpiry, `dashboard-expired-source-${suffix}`,
  );
  const expiredRestoredOrder = await order(salonOne);
  await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
    scope: expiredRestoredScope,
    orderId: expiredRestoredOrder.id,
    allocations: [{ ledgerEntryId: expiredRestoredSource.id, amountRsd: 40 }],
    idempotencyKey: `dashboard-expired-spend-${suffix}`,
    now: dashboardFactAt,
  }));
  await db.insert(referralCreditLedgerTable).values({
    ...expiredRestoredScope,
    type: "expired",
    amountRsd: -60,
    effectiveAt: dashboardFactAt,
    reason: "Dashboard terminal expiry fixture.",
    idempotencyKey: `dashboard-expired-fact-${suffix}`,
    metadata: { sourceLedgerEntryId: expiredRestoredSource.id },
  });
  await db.transaction((tx) => restoreReferralCreditForOrderInTx(tx, {
    scope: expiredRestoredScope,
    orderId: expiredRestoredOrder.id,
    eventKey: `dashboard-expired-refund-${suffix}`,
    now: dashboardFactAt,
  }));
  assert.deepEqual(await referralDashboard(expiredRestoredOwner), {
    availableRsd: 0,
    expiringSoonRsd: 0,
  }, "a restoration cannot revive an expired dashboard source");

  const partialDashboardOwner = await user();
  const partialDashboardScope: ReferralWalletScope = {
    ownerUserId: partialDashboardOwner.id, walletKind: "B2C",
  };
  const partialDashboardSource = await insertAvailable(
    partialDashboardScope, 100, dashboardExpiry, `dashboard-partial-source-${suffix}`,
  );
  const partialDashboardOrder = await order(salonOne);
  await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
    scope: partialDashboardScope,
    orderId: partialDashboardOrder.id,
    allocations: [{ ledgerEntryId: partialDashboardSource.id, amountRsd: 40 }],
    idempotencyKey: `dashboard-partial-spend-${suffix}`,
    now: dashboardFactAt,
  }));
  assert.deepEqual(await referralDashboard(partialDashboardOwner), {
    availableRsd: 60,
    expiringSoonRsd: 60,
  }, "dashboard reports the exact reusable remainder of a live source");

  const dashboardDebtOwner = await user();
  const dashboardDebtScope: ReferralWalletScope = {
    ownerUserId: dashboardDebtOwner.id, walletKind: "B2C",
  };
  const invalidDashboardSource = await insertAvailable(
    dashboardDebtScope, 100, dashboardExpiry, `dashboard-debt-source-${suffix}`,
  );
  const dashboardDebtOrder = await order(salonOne);
  await db.transaction((tx) => recordReferralRedemptionInTx(tx, {
    scope: dashboardDebtScope,
    orderId: dashboardDebtOrder.id,
    allocations: [{ ledgerEntryId: invalidDashboardSource.id, amountRsd: 40 }],
    idempotencyKey: `dashboard-debt-spend-${suffix}`,
    now: dashboardFactAt,
  }));
  await db.insert(referralCreditLedgerTable).values({
    ...dashboardDebtScope,
    type: "reversed",
    amountRsd: -100,
    effectiveAt: dashboardFactAt,
    reason: "Dashboard invalidation debt fixture.",
    idempotencyKey: `dashboard-debt-reversed-${suffix}`,
    metadata: { sourceLedgerEntryId: invalidDashboardSource.id },
  });
  assert.deepEqual(await referralDashboard(dashboardDebtOwner), {
    availableRsd: -40,
    expiringSoonRsd: 0,
  }, "negative invalidation debt stays visible and cannot be spent");
  const validDashboardSource = await insertAvailable(
    dashboardDebtScope, 100, dashboardExpiry, `dashboard-valid-source-${suffix}`,
  );
  const dashboardCheckout = await db.transaction((tx) =>
    allocateReferralCreditInTx(tx, dashboardDebtScope, 1_000, 1_000, new Date()));
  assert.deepEqual(dashboardCheckout.allocations, [
    { ledgerEntryId: validDashboardSource.id, amountRsd: 60 },
  ]);
  assert.deepEqual(await referralDashboard(dashboardDebtOwner), {
    availableRsd: dashboardCheckout.availableRsd,
    expiringSoonRsd: 60,
  }, "dashboard and checkout apply invalidation debt to the same valid capacity");

  const scopedDashboardOwner = await user("SALON_OWNER");
  const scopedDashboardSalon = await salon(scopedDashboardOwner, "dashboard-salon");
  const scopedDashboardCenter = await center(scopedDashboardOwner, "dashboard-center");
  const salonDashboardScope: ReferralWalletScope = {
    ownerUserId: scopedDashboardOwner.id, walletKind: "B2B", salonId: scopedDashboardSalon.id,
  };
  const centerDashboardScope: ReferralWalletScope = {
    ownerUserId: scopedDashboardOwner.id, walletKind: "B2B", educationCenterId: scopedDashboardCenter.id,
  };
  const salonDashboardSource = await insertAvailable(
    salonDashboardScope, 100, dashboardExpiry, `dashboard-salon-source-${suffix}`,
  );
  await insertAvailable(
    centerDashboardScope, 200, dashboardExpiry, `dashboard-center-source-${suffix}`,
  );
  await db.insert(referralCreditLedgerTable).values({
    ...centerDashboardScope,
    type: "reversed",
    amountRsd: -100,
    effectiveAt: dashboardFactAt,
    reason: "Cross-scope source identity fixture.",
    idempotencyKey: `dashboard-center-debt-${suffix}`,
    metadata: { sourceLedgerEntryId: salonDashboardSource.id },
  });
  assert.deepEqual(await referralDashboard(scopedDashboardOwner), {
    availableRsd: 200,
    expiringSoonRsd: 200,
  }, "salon and education B2B facts remain in their exact wallet scopes");

  // Bulk admin cancellation/refund uses the same append-only restoration and
  // order stamp as the single-order path, including replay and contention.
  const bulkAdmin = await user("ADMIN");
  const bulkSession = await createSession(bulkAdmin.id);
  const bulkScope: ReferralWalletScope = {
    ownerUserId: owner.id, walletKind: "B2B", salonId: salonOne.id,
  };
  const bulkSource = await insertAvailable(
    bulkScope,
    1000,
    new Date(at.getTime() + 30 * 86400_000),
    `bulk-source-${suffix}`,
  );
  async function creditedBulkOrder(amountRsd: number) {
    const item = await order(salonOne);
    await db.transaction(async (tx) => {
      await recordReferralRedemptionInTx(tx, {
        scope: bulkScope,
        orderId: item.id,
        allocations: [{ ledgerEntryId: bulkSource.id, amountRsd }],
        idempotencyKey: `bulk-redemption-${item.id}`,
        now: at,
      });
      await tx.update(ordersTable).set({ referralCreditAppliedRsd: amountRsd })
        .where(eq(ordersTable.id, item.id));
    });
    return item;
  }
  async function bulkUpdate(orderIds: string[], update: { status?: "cancelled"; paymentStatus?: "refunded" }) {
    return fetch(`http://127.0.0.1:${port}/api/admin/orders/bulk`, {
      method: "PATCH",
      headers: {
        cookie: `${sessionCookieName}=${bulkSession}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ orderIds, ...update }),
    });
  }
  const bulkCancelled = await creditedBulkOrder(100);
  const bulkNoCredit = await order(salonOne);
  assert.equal((await bulkUpdate([bulkNoCredit.id, bulkCancelled.id], { status: "cancelled" })).status, 200);
  const [cancelledStamped, noCreditStamped] = await Promise.all([
    db.select().from(ordersTable).where(eq(ordersTable.id, bulkCancelled.id)).limit(1),
    db.select().from(ordersTable).where(eq(ordersTable.id, bulkNoCredit.id)).limit(1),
  ]);
  assert.ok(cancelledStamped[0]!.referralCreditRestoredAt, "bulk cancellation stamps credited order");
  assert.equal(noCreditStamped[0]!.referralCreditRestoredAt, null, "mixed no-credit order is not stamped");

  const bulkRefunded = await creditedBulkOrder(110);
  assert.equal((await bulkUpdate([bulkRefunded.id], { paymentStatus: "refunded" })).status, 200);
  const firstRefundStamp = (await db.select().from(ordersTable)
    .where(eq(ordersTable.id, bulkRefunded.id)).limit(1))[0]!.referralCreditRestoredAt!;
  assert.equal((await bulkUpdate([bulkRefunded.id], { paymentStatus: "refunded" })).status, 200);
  assert.equal((await db.select().from(ordersTable)
    .where(eq(ordersTable.id, bulkRefunded.id)).limit(1))[0]!.referralCreditRestoredAt!.getTime(), firstRefundStamp.getTime(),
  "bulk refund replay retains the original restoration stamp");

  const concurrentBulkA = await creditedBulkOrder(120);
  const concurrentBulkB = await creditedBulkOrder(130);
  const concurrentResponses = await Promise.all([
    bulkUpdate([concurrentBulkB.id, concurrentBulkA.id], { paymentStatus: "refunded" }),
    bulkUpdate([concurrentBulkA.id, concurrentBulkB.id], { paymentStatus: "refunded" }),
  ]);
  assert.deepEqual(concurrentResponses.map((item) => item.status), [200, 200]);
  const bulkRestorations = await db.select().from(referralCreditLedgerTable).where(and(
    eq(referralCreditLedgerTable.type, "restored"),
    inArray(
      sql`${referralCreditLedgerTable.metadata}->>'orderId'`,
      [bulkCancelled.id, bulkRefunded.id, concurrentBulkA.id, concurrentBulkB.id],
    ),
  ));
  assert.equal(bulkRestorations.length, 4, "cancel, refund, replay, and concurrent bulk requests restore each credited order once");
  assert.deepEqual(
    [...bulkRestorations.map((entry) => entry.amountRsd)].sort((a, b) => a - b),
    [100, 110, 120, 130],
  );

  // A/C every-ten milestones count only the concrete source business.
  async function milestone(channel: "A" | "C", source: Source, other: Source) {
    const target = channel === "A" ? source.salon! : source.center!;
    for (const selected of [source, other]) {
      for (let index = 0; index < 9; index += 1) {
        const referred = await user();
        const made = await referral(channel, selected, referred, at);
        await db.update(referralQualificationsTable).set({ status: "held" })
          .where(eq(referralQualificationsTable.id, made.qualification.id));
      }
    }
    const referred = await user();
    await referral(channel, source, referred, at);
    if (channel === "A") {
      const ids = await qualifyAppointments(referred, target as Salon, 3, at);
      const final = await appointment(target as Salon, referred);
      await Promise.all([
        appointmentTransition(referred, target as Salon, at, true, final.id),
        appointmentTransition(referred, target as Salon, at, true, final.id),
      ]);
      assert.equal(ids.length, 3);
    } else {
      await qualifyEnrollments(referred, target as Center, 3, at);
      const final = await enrollment(target as Center, referred);
      await Promise.all([
        enrollmentTransition(referred, target as Center, at, true, final.id),
        enrollmentTransition(referred, target as Center, at, true, final.id),
      ]);
    }
    const sourceId = source.salon?.id ?? source.center!.id;
    const otherId = other.salon?.id ?? other.center!.id;
    const rows = await db.select().from(referralMilestoneBenefitsTable).where(and(
      eq(referralMilestoneBenefitsTable.channel, channel),
      or(
        source.salon ? eq(referralMilestoneBenefitsTable.benefitSalonId, sourceId) : eq(referralMilestoneBenefitsTable.benefitEducationCenterId, sourceId),
        other.salon ? eq(referralMilestoneBenefitsTable.benefitSalonId, otherId) : eq(referralMilestoneBenefitsTable.benefitEducationCenterId, otherId),
      ),
    ));
    assert.equal(rows.filter((row) => row.qualifyingCount === 10).length, 1);
    assert.equal(rows[0]!.benefitSalonId ?? rows[0]!.benefitEducationCenterId, sourceId);
  }
  const milestoneOwner = await user("SALON_OWNER");
  const milestoneSalonA = await salon(milestoneOwner, "milestone-a");
  const milestoneSalonB = await salon(milestoneOwner, "milestone-b");
  await milestone("A", { owner: milestoneOwner, salon: milestoneSalonA }, { owner: milestoneOwner, salon: milestoneSalonB });
  const milestoneEducationOwner = await user("EDUKATIVNI_CENTAR");
  const milestoneCenterA = await center(milestoneEducationOwner, "milestone-c-a");
  const milestoneCenterB = await center(milestoneEducationOwner, "milestone-c-b");
  await milestone("C", { owner: milestoneEducationOwner, center: milestoneCenterA }, { owner: milestoneEducationOwner, center: milestoneCenterB });

  // Salon Type A is serialized on the canonical owner subscription, even when
  // benefits came from different locations. Scheduling and activation are safe
  // under duplicate worker runs and each monthly cycle consumes only one row.
  const billingOwner = await user("SALON_OWNER");
  const billingSalonA = await salon(billingOwner, "billing-a");
  const billingSalonB = await salon(billingOwner, "billing-b");
  const planName = `Referral billing ${suffix}`;
  const [billingPlan] = await db.insert(subscriptionPlansTable).values({
    name: planName, price: 2499,
  }).returning();
  const firstBoundary = new Date(Date.now() - 100);
  await db.insert(subscriptionsTable).values({
    salonId: billingSalonA.id,
    planId: billingPlan!.id,
    status: "active",
    dueAmount: 2499,
    currentPeriodEnd: firstBoundary,
  });
  const [firstBenefit, secondBenefit] = await db.insert(referralMilestoneBenefitsTable).values([
    {
      referrerUserId: billingOwner.id, channel: "A", benefitSalonId: billingSalonA.id,
      qualifyingCount: 10, kind: "salon_subscription_reduction",
      idempotencyKey: referralIdempotencyKey("billing-benefit", billingOwner.id, "1"),
      createdAt: new Date(firstBoundary.getTime() - 2000),
    },
    {
      referrerUserId: billingOwner.id, channel: "A", benefitSalonId: billingSalonB.id,
      qualifyingCount: 10, kind: "salon_subscription_reduction",
      idempotencyKey: referralIdempotencyKey("billing-benefit", billingOwner.id, "2"),
      createdAt: new Date(firstBoundary.getTime() - 1000),
    },
  ]).returning();
  const activation = new Date(firstBoundary.getTime() + 100);
  await Promise.all([runReferralMaintenance(activation), runReferralMaintenance(activation)]);
  let billedBenefits = await db.select().from(referralMilestoneBenefitsTable)
    .where(inArray(referralMilestoneBenefitsTable.id, [firstBenefit!.id, secondBenefit!.id]))
    .orderBy(referralMilestoneBenefitsTable.createdAt);
  assert.equal(billedBenefits[0]!.discountPercent, 20);
  assert.equal(billedBenefits[0]!.billingCycleStart!.getTime(), firstBoundary.getTime());
  assert.equal(billedBenefits[0]!.appliedAt?.getTime(), activation.getTime(), "duplicate activation writes appliedAt once");
  assert.equal(billedBenefits[1]!.appliedAt, null);
  assert.equal(billedBenefits[1]!.billingCycleStart!.getTime(), billedBenefits[0]!.billingCycleEnd!.getTime(),
    "two salon locations cannot stack benefits on an owner cycle");
  const secondActivation = new Date(billedBenefits[1]!.billingCycleStart!.getTime() + 100);
  await runReferralMaintenance(secondActivation);
  billedBenefits = await db.select().from(referralMilestoneBenefitsTable)
    .where(inArray(referralMilestoneBenefitsTable.id, [firstBenefit!.id, secondBenefit!.id]))
    .orderBy(referralMilestoneBenefitsTable.createdAt);
  assert.equal((billedBenefits[1]!.appliedAt as Date | null)?.getTime(), secondActivation.getTime());
  assert.equal(applySalonReferralSubscriptionReduction(2499), 1999, "integer RSD rounds the 20% cycle price");
  assert.equal(applySalonReferralSubscriptionReduction(2490), 1992);
  assert.equal(projectSalonSubscriptionDue(2499, { freeSubscription: true, discountPercent: 0 }, 20), 0,
    "loyalty free subscription takes precedence");
  assert.equal(projectSalonSubscriptionDue(2499, { freeSubscription: false, discountPercent: 10 }, 20), 2249,
    "loyalty discount takes precedence and referral discounts never stack");

  // Education A/C milestones earned mid-period are scheduled for the next
  // explicit one-month cycle and never alter current-period enrollment charges.
  const educationBillingOwner = await user("EDUKATIVNI_CENTAR");
  const educationBillingCenter = await center(educationBillingOwner, "next-cycle");
  await db.update(educationCentersTable).set({ commissionPercentOverride: 18 })
    .where(eq(educationCentersTable.id, educationBillingCenter.id));
  const educationPeriodEnd = new Date(at.getTime() + 10 * 86400_000);
  await db.insert(educationCenterSubscriptionsTable).values({
    centerId: educationBillingCenter.id,
    planId: billingPlan!.id,
    status: "active",
    currentPeriodEnd: educationPeriodEnd,
  });
  for (let index = 0; index < 9; index += 1) {
    const referred = await user("STUDENT");
    const made = await referral("C", { owner: educationBillingOwner, center: educationBillingCenter }, referred, at);
    await db.update(referralQualificationsTable).set({ status: "held" })
      .where(eq(referralQualificationsTable.id, made.qualification.id));
  }
  const tenthEducationStudent = await user("STUDENT");
  await referral("C", { owner: educationBillingOwner, center: educationBillingCenter }, tenthEducationStudent, at);
  await qualifyEnrollments(tenthEducationStudent, educationBillingCenter, 4, at);
  const [scheduledEducationBenefit] = await db.select().from(referralMilestoneBenefitsTable).where(and(
    eq(referralMilestoneBenefitsTable.benefitEducationCenterId, educationBillingCenter.id),
    eq(referralMilestoneBenefitsTable.qualifyingCount, 10),
  )).limit(1);
  assert.equal(scheduledEducationBenefit!.billingCycleStart!.getTime(), educationPeriodEnd.getTime());
  const educationCycleEnd = new Date(educationPeriodEnd);
  educationCycleEnd.setUTCMonth(educationCycleEnd.getUTCMonth() + 1);
  assert.equal(scheduledEducationBenefit!.billingCycleEnd!.getTime(), educationCycleEnd.getTime());

  async function educationCharge(centerId: string, chargeAt: Date) {
    return db.transaction(async (tx) => {
      await lockEducationCenterFinancials(tx, centerId);
      return resolveEducationBillingSettingsForChargeInTx(centerId, tx, undefined, chargeAt);
    });
  }
  const currentPeriodCharge = await educationCharge(
    educationBillingCenter.id,
    new Date(at.getTime() + 1000),
  );
  assert.equal(currentPeriodCharge.effective.commissionPercent, 18);
  assert.equal(currentPeriodCharge.referralMilestoneBenefitId, null);
  const [concurrentEducationChargeA, concurrentEducationChargeB] = await Promise.all([
    educationCharge(educationBillingCenter.id, new Date(educationPeriodEnd.getTime() + 1000)),
    educationCharge(educationBillingCenter.id, new Date(educationPeriodEnd.getTime() + 1000)),
  ]);
  assert.equal(concurrentEducationChargeA.effective.commissionPercent, 12);
  assert.equal(concurrentEducationChargeB.effective.commissionPercent, 12);
  assert.equal(concurrentEducationChargeA.referralMilestoneBenefitId, scheduledEducationBenefit!.id);
  assert.equal(concurrentEducationChargeB.referralMilestoneBenefitId, scheduledEducationBenefit!.id);
  assert.equal((await educationCharge(educationBillingCenter.id, educationCycleEnd)).effective.commissionPercent, 18,
    "commission returns to normal at the exclusive cycle end");

  const queuedEducationCenter = await center(educationBillingOwner, "two-queued-cycles");
  await db.update(educationCentersTable).set({ commissionPercentOverride: 18 })
    .where(eq(educationCentersTable.id, queuedEducationCenter.id));
  await db.insert(educationCenterSubscriptionsTable).values({
    centerId: queuedEducationCenter.id,
    planId: billingPlan!.id,
    status: "active",
    currentPeriodEnd: educationPeriodEnd,
  });
  const secondEducationCycleEnd = new Date(educationCycleEnd);
  secondEducationCycleEnd.setUTCMonth(secondEducationCycleEnd.getUTCMonth() + 1);
  const queuedEducationBenefits = await db.insert(referralMilestoneBenefitsTable).values([
    {
      referrerUserId: educationBillingOwner.id,
      channel: "C",
      benefitEducationCenterId: queuedEducationCenter.id,
      qualifyingCount: 10,
      kind: "education_commission_reduction",
      billingCycleStart: educationPeriodEnd,
      billingCycleEnd: educationCycleEnd,
      idempotencyKey: referralIdempotencyKey("education-two-cycle", queuedEducationCenter.id, "1"),
    },
    {
      referrerUserId: educationBillingOwner.id,
      channel: "C",
      benefitEducationCenterId: queuedEducationCenter.id,
      qualifyingCount: 20,
      kind: "education_commission_reduction",
      billingCycleStart: educationCycleEnd,
      billingCycleEnd: secondEducationCycleEnd,
      idempotencyKey: referralIdempotencyKey("education-two-cycle", queuedEducationCenter.id, "2"),
    },
  ]).returning();
  const firstQueuedCharge = await educationCharge(queuedEducationCenter.id, new Date(educationPeriodEnd.getTime() + 1000));
  const secondQueuedCharge = await educationCharge(queuedEducationCenter.id, new Date(educationCycleEnd.getTime() + 1000));
  assert.equal(firstQueuedCharge.referralMilestoneBenefitId, queuedEducationBenefits[0]!.id);
  assert.equal(secondQueuedCharge.referralMilestoneBenefitId, queuedEducationBenefits[1]!.id);
  assert.equal(firstQueuedCharge.effective.commissionPercent, 12);
  assert.equal(secondQueuedCharge.effective.commissionPercent, 12);

  // Signup outbox keys dedupe retries and retain the source tenant.
  const notifyOwner = await user("SALON_OWNER");
  const notifySalonA = await salon(notifyOwner, "notify-a");
  const notifySalonB = await salon(notifyOwner, "notify-b");
  await proof(notifyOwner);
  for (const sourceSalon of [notifySalonA, notifySalonB]) {
    const referred = await user();
    const code = await db.transaction((tx) => ensureReferralCode(tx, {
      channel: "D",
      referrerUserId: notifyOwner.id,
      sourceBusiness: "salon",
      sourceBusinessId: sourceSalon.id,
    }));
    const first = await db.transaction((tx) => captureReferralAttributionInTx(tx, {
      referralCode: code.code,
      referredUserId: referred.id,
      phoneNormalized: referred.phoneNormalized,
      registrationContext: "customer",
      now: at,
    }));
    const duplicate = await db.transaction((tx) => captureReferralAttributionInTx(tx, {
      referralCode: code.code,
      referredUserId: referred.id,
      phoneNormalized: referred.phoneNormalized,
      registrationContext: "customer",
      now: at,
    }));
    assert.ok(first, `first attribution capture must succeed for ${sourceSalon.id} / ${referred.id} / ${code.code}`);
    assert.equal(duplicate, null);
    const eventKey = `referral-signup-attributed:${first!.id}`;
    assert.equal((await db.select().from(emailDeliveriesTable).where(eq(emailDeliveriesTable.eventKey, eventKey))).length, 1);
    const sms = await db.select().from(smsDeliveriesTable).where(eq(smsDeliveriesTable.eventKey, eventKey));
    assert.equal(sms.length, 1);
    assert.equal(sms[0]!.salonId, sourceSalon.id);
  }
}

async function cleanup() {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  if (!createdUserIds.length) return;
  await db.delete(emailDeliveriesTable).where(inArray(emailDeliveriesTable.recipientEmail, testEmails));
  await db.delete(smsDeliveriesTable).where(inArray(smsDeliveriesTable.recipientPhone, testPhones));
  await db.transaction(async (tx) => {
    await tx.execute(sql`alter table referral_attributions disable trigger referral_attributions_append_only`);
    await tx.execute(sql`alter table referral_credit_ledger disable trigger referral_credit_ledger_append_only`);
    await tx.execute(sql`alter table referral_credit_redemptions disable trigger referral_credit_redemptions_append_only`);
    try {
      await tx.delete(referralReviewsTable).where(or(
        inArray(referralReviewsTable.attributionId, tx.select({ id: referralAttributionsTable.id }).from(referralAttributionsTable)
          .where(or(inArray(referralAttributionsTable.referrerUserId, createdUserIds), inArray(referralAttributionsTable.referredUserId, createdUserIds)))),
        inArray(referralReviewsTable.qualificationId, tx.select({ id: referralQualificationsTable.id }).from(referralQualificationsTable)
          .innerJoin(referralAttributionsTable, eq(referralQualificationsTable.attributionId, referralAttributionsTable.id))
          .where(or(inArray(referralAttributionsTable.referrerUserId, createdUserIds), inArray(referralAttributionsTable.referredUserId, createdUserIds)))),
      ));
      const attributionIds = tx.select({ id: referralAttributionsTable.id }).from(referralAttributionsTable)
        .where(or(inArray(referralAttributionsTable.referrerUserId, createdUserIds), inArray(referralAttributionsTable.referredUserId, createdUserIds)));
      await tx.delete(referralCreditRedemptionsTable).where(inArray(
        referralCreditRedemptionsTable.ledgerEntryId,
        tx.select({ id: referralCreditLedgerTable.id }).from(referralCreditLedgerTable)
          .where(inArray(referralCreditLedgerTable.ownerUserId, createdUserIds)),
      ));
      await tx.delete(referralCreditLedgerTable).where(inArray(referralCreditLedgerTable.ownerUserId, createdUserIds));
      await tx.delete(referralMilestoneBenefitsTable).where(inArray(referralMilestoneBenefitsTable.referrerUserId, createdUserIds));
      await tx.delete(referralQualificationEvidenceTable).where(inArray(
        referralQualificationEvidenceTable.qualificationId,
        tx.select({ id: referralQualificationsTable.id }).from(referralQualificationsTable)
          .where(inArray(referralQualificationsTable.attributionId, attributionIds)),
      ));
      await tx.delete(referralQualificationsTable).where(inArray(referralQualificationsTable.attributionId, attributionIds));
      await tx.delete(referralAttributionsTable).where(or(
        inArray(referralAttributionsTable.referrerUserId, createdUserIds),
        inArray(referralAttributionsTable.referredUserId, createdUserIds),
      ));
    } finally {
      await tx.execute(sql`alter table referral_attributions enable trigger referral_attributions_append_only`);
      await tx.execute(sql`alter table referral_credit_ledger enable trigger referral_credit_ledger_append_only`);
      await tx.execute(sql`alter table referral_credit_redemptions enable trigger referral_credit_redemptions_append_only`);
    }
  });
  await db.delete(referralCodesTable).where(inArray(referralCodesTable.referrerUserId, createdUserIds));
  if (createdOrderIds.length) await db.delete(ordersTable).where(inArray(ordersTable.id, createdOrderIds));
  if (createdAppointmentIds.length) await db.delete(appointmentsTable).where(inArray(appointmentsTable.id, createdAppointmentIds));
  if (createdEnrollmentIds.length) await db.delete(courseEnrollmentsTable).where(inArray(courseEnrollmentsTable.id, createdEnrollmentIds));
  if (createdCourseIds.length) await db.delete(coursesTable).where(inArray(coursesTable.id, createdCourseIds));
  if (createdSalonIds.length) await db.delete(salonsTable).where(inArray(salonsTable.id, createdSalonIds));
  if (createdCenterIds.length) await db.delete(educationCentersTable).where(inArray(educationCentersTable.id, createdCenterIds));
  await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.name, `Referral billing ${suffix}`));
  await db.delete(phoneVerificationProofsTable).where(inArray(phoneVerificationProofsTable.userId, createdUserIds));
  await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
}

try {
  await assertNoPgBusyClientWarnings(run);
  console.log("Real PostgreSQL referral lifecycle and concurrency coverage passed.");
} finally {
  await cleanup();
  await pool.end();
}