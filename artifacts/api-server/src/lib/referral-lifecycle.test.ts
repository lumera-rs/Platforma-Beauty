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
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { assertNoPgBusyClientWarnings } from "./pg-busy-client.test-support";
import { referralIdempotencyKey, type ReferralChannel } from "./referral-domain";
import { ensureReferralSchema } from "./referral-schema";
import {
  allocateReferralCreditInTx,
  captureReferralAttributionInTx,
  deriveReferralCreditBalance,
  ensureReferralCode,
  recordAppointmentReferralTransitionInTx,
  recordEducationEnrollmentReferralTransitionInTx,
  recordReferralRedemptionInTx,
  runReferralMaintenance,
  type ReferralWalletScope,
} from "./referral-service";

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
      now: at,
    }));
    const duplicate = await db.transaction((tx) => captureReferralAttributionInTx(tx, {
      referralCode: code.code,
      referredUserId: referred.id,
      phoneNormalized: referred.phoneNormalized,
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