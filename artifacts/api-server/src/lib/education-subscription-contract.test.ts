import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import { createSession, sessionCookieName } from "./auth";
import {
  db, educationCenterSubscriptionsTable, educationCentersTable, educationFinancialAuditLogTable,
  educationPaymentObligationsTable, educationPlatformSettingsTable, educationTrialClaimsTable,
  salonsTable, sessionsTable, subscriptionPlansTable, usersTable,
} from "@workspace/db";
import { addEducationBillingPeriod } from "./education-subscription-domain";
import { runEducationSubscriptionLifecycle } from "./education-subscription-worker";

const marker = `edu-contract-${randomUUID()}`;
const emails = [`owner-a-${marker}@example.test`, `owner-b-${marker}@example.test`];
const userIds: string[] = [];
const centerIds: string[] = [];
const planIds: string[] = [];
let adminId: string | undefined;
let server: ReturnType<typeof app.listen> | undefined;
let settingsRestore: typeof educationPlatformSettingsTable.$inferSelect | null = null;
let insertedSettingsId: string | undefined;

const call = async (base: string, path: string, method = "GET", body?: unknown, cookie?: string) => {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() as any };
};

const registration = (email: string, planId?: string) => ({
  firstName: "Education", lastName: marker, email, password: "StrongPass123!",
  phone: "+381 64 111 22 33", businessType: "EDUCATION_CENTER", businessName: `Centar ${email}`,
  pib: `${Math.abs(email.length * 7919)}12345`.slice(0, 9), city: "Beograd", municipality: "Vračar",
  address: "Test 1", postalCode: "11000", description: `Programi i sertifikacije ${marker}`,
  planId, billingCycle: "monthly",
});

try {
  const belgradeClock = (value: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(value);
  const beforeDst = new Date("2026-03-28T13:30:00.000Z");
  assert.equal(belgradeClock(addEducationBillingPeriod(beforeDst, "monthly")), belgradeClock(beforeDst), "Calendar billing must preserve the Belgrade wall-clock time across DST.");
  const [low, high] = await db.insert(subscriptionPlansTable).values([
    { name: `Osnovni ${marker}`, price: 10_000, trialDays: 30, active: true },
    { name: `Napredni ${marker}`, price: 30_000, trialDays: 30, active: true },
  ]).returning();
  planIds.push(low!.id, high!.id);
  const [admin] = await db.insert(usersTable).values({
    firstName: "Admin", lastName: marker, email: `admin-${marker}@example.test`,
    passwordHash: "fixture", passwordSetAt: new Date(), role: "SUPER_ADMIN",
  }).returning();
  adminId = admin!.id; userIds.push(admin!.id);

  const [currentSettings] = await db.select().from(educationPlatformSettingsTable).orderBy(educationPlatformSettingsTable.createdAt).limit(1);
  if (currentSettings) {
    settingsRestore = currentSettings;
    await db.update(educationPlatformSettingsTable).set({
      ipsRecipientName: `LUMERA ${marker}`, ipsRecipientAccount: "840000000000000000", ipsPurpose: "Education pretplata",
    }).where(eq(educationPlatformSettingsTable.id, currentSettings.id));
  } else {
    const [created] = await db.insert(educationPlatformSettingsTable).values({
      ipsRecipientName: `LUMERA ${marker}`, ipsRecipientAccount: "840000000000000000", ipsPurpose: "Education pretplata",
    }).returning();
    insertedSettingsId = created!.id;
  }

  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const missingPlan = await call(base, "/auth/business-register", "POST", registration(`missing-${marker}@example.test`));
  assert.equal(missingPlan.status, 400);
  assert.equal((await db.select().from(usersTable).where(eq(usersTable.email, `missing-${marker}@example.test`))).length, 0);

  const firstRegistration = await call(base, "/auth/business-register", "POST", registration(emails[0]!, low!.id));
  assert.equal(firstRegistration.status, 201);
  const [ownerA] = await db.select().from(usersTable).where(eq(usersTable.email, emails[0]!));
  assert.ok(ownerA); userIds.push(ownerA.id);
  const [centerA] = await db.select().from(educationCentersTable).where(eq(educationCentersTable.ownerId, ownerA.id));
  assert.ok(centerA); centerIds.push(centerA.id);
  assert.equal((await db.select().from(salonsTable).where(eq(salonsTable.ownerId, ownerA.id))).length, 0);
  let [subscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, centerA.id));
  assert.equal(subscription!.status, "trial");
  assert.equal(subscription!.billingCycle, "monthly");
  const [claim] = await db.select().from(educationTrialClaimsTable).where(eq(educationTrialClaimsTable.centerId, centerA.id));
  assert.ok(claim?.normalizedEmailHash && claim.normalizedPhoneHash && claim.normalizedPibHash);

  const secondInput = registration(emails[1]!, low!.id);
  secondInput.pib = "987654321";
  const secondRegistration = await call(base, "/auth/business-register", "POST", secondInput);
  assert.equal(secondRegistration.status, 201);
  const [ownerB] = await db.select().from(usersTable).where(eq(usersTable.email, emails[1]!));
  assert.ok(ownerB); userIds.push(ownerB.id);
  const [centerB] = await db.select().from(educationCentersTable).where(eq(educationCentersTable.ownerId, ownerB.id));
  assert.ok(centerB); centerIds.push(centerB.id);
  const [secondSubscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, centerB.id));
  assert.equal(secondSubscription!.status, "past_due", "Reusing a durable phone identity must not grant another trial.");

  const ownerCookie = `${sessionCookieName}=${await createSession(ownerA.id)}`;
  const secondOwnerCookie = `${sessionCookieName}=${await createSession(ownerB.id)}`;
  const adminCookie = `${sessionCookieName}=${await createSession(admin!.id)}`;
  assert.equal((await call(base, `/admin/education/centers/${centerA.id}`, "PATCH", { subscriptionStatus: "trial" }, adminCookie)).status, 409);
  const now = new Date();
  await db.update(educationCenterSubscriptionsTable).set({
    status: "past_due", trialStartedAt: null, trialEndsAt: null, currentPeriodStart: null,
    currentPeriodEnd: null, billingCycle: "yearly", dueAmount: low!.price * 12,
  }).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  const [yearlyInstructions, repeatedInstructions] = await Promise.all([
    call(base, "/education/subscription/renewal-instructions", "POST", undefined, ownerCookie),
    call(base, "/education/subscription/renewal-instructions", "POST", undefined, ownerCookie),
  ]);
  assert.equal(yearlyInstructions.status, 200);
  assert.equal(yearlyInstructions.body.amount, low!.price * 12);
  assert.equal(repeatedInstructions.body.reference, yearlyInstructions.body.reference, "Pending renewal instructions must be idempotent.");
  const [yearlyObligation] = await db.select().from(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.referenceSnapshot, yearlyInstructions.body.reference));
  assert.equal(yearlyObligation!.billingCycleSnapshot, "yearly");
  assert.equal((await call(base, `/admin/education/payment-obligations/${yearlyObligation!.id}/settle`, "POST", {
    confirmedAmountRsd: yearlyObligation!.expectedAmount, reason: "Godišnja uplata potvrđena",
  }, adminCookie)).status, 200);
  [subscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  assert.equal(subscription!.status, "active");
  assert.ok(subscription!.currentPeriodEnd!.getTime() - subscription!.currentPeriodStart!.getTime() > 360 * 86_400_000);
  const rejectedCurrentContract = await call(base, `/admin/education/centers/${centerA.id}/custom-contract`, "POST", {
    amountRsd: 222_222, billingCycle: "yearly", contractEndsAt: new Date(Date.now() + 400 * 86_400_000).toISOString(), reason: "Ne sme prekinuti tekući plaćeni period",
  }, adminCookie);
  assert.equal(rejectedCurrentContract.status, 409, "A custom contract must not revoke the current paid period.");

  await db.update(educationCenterSubscriptionsTable).set({
    planId: high!.id, billingCycle: "monthly", status: "active",
    currentPeriodStart: new Date(Date.now() - 10 * 86_400_000),
    currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
  }).where(eq(educationCenterSubscriptionsTable.id, secondSubscription!.id));
  const prepaidHighInstructions = await call(base, "/education/subscription/renewal-instructions", "POST", undefined, secondOwnerCookie);
  const [prepaidHigh] = await db.select().from(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.referenceSnapshot, prepaidHighInstructions.body.reference));
  await call(base, `/admin/education/payment-obligations/${prepaidHigh!.id}/settle`, "POST", {
    confirmedAmountRsd: prepaidHigh!.expectedAmount, reason: "Viši plan plaćen unapred",
  }, adminCookie);
  const repeatedPrepaidHigh = await call(base, "/education/subscription/renewal-instructions", "POST", undefined, secondOwnerCookie);
  assert.equal(repeatedPrepaidHigh.body.reference, prepaidHigh!.referenceSnapshot, "A paid future renewal must remain idempotent for its service period.");
  assert.equal(prepaidHigh!.planIdSnapshot, high!.id, "The purchased plan must be immutable on the renewal obligation.");
  const reverseOrderDowngrade = await call(base, "/education/subscription/select-plan", "POST", { planId: low!.id, billingCycle: "yearly" }, secondOwnerCookie);
  assert.equal(new Date(reverseOrderDowngrade.body.pendingPlanEffectiveAt).getTime(), prepaidHigh!.servicePeriodEnd!.getTime(), "Downgrade after prepayment must wait until the paid future period ends.");
  const rejectedPaidContract = await call(base, `/admin/education/centers/${centerB.id}/custom-contract`, "POST", {
    amountRsd: 333_333, billingCycle: "yearly", contractEndsAt: new Date(Date.now() + 400 * 86_400_000).toISOString(), reason: "Ne sme prekinuti plaćeni period",
  }, adminCookie);
  assert.equal(rejectedPaidContract.status, 409, "A custom contract must not revoke a current or future paid period.");
  await db.update(educationPaymentObligationsTable).set({
    servicePeriodStart: new Date(Date.now() - 1_000), servicePeriodEnd: new Date(Date.now() + 20 * 86_400_000),
  }).where(eq(educationPaymentObligationsTable.id, prepaidHigh!.id));
  await db.update(educationCenterSubscriptionsTable).set({ currentPeriodEnd: new Date(Date.now() - 1_000) })
    .where(eq(educationCenterSubscriptionsTable.id, secondSubscription!.id));
  await runEducationSubscriptionLifecycle();
  const [prepaidPreserved] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, secondSubscription!.id));
  assert.equal(prepaidPreserved!.planId, high!.id);
  assert.equal(prepaidPreserved!.billingCycle, "monthly");

  await db.update(educationCenterSubscriptionsTable).set({ planId: high!.id, billingCycle: "monthly" }).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  const downgrade = await call(base, "/education/subscription/select-plan", "POST", { planId: low!.id, billingCycle: "yearly" }, ownerCookie);
  assert.equal(downgrade.status, 201);
  assert.equal(downgrade.body.change, "scheduled_downgrade");
  assert.equal(downgrade.body.pendingPlanId, low!.id);
  assert.equal((await db.select().from(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.subscriptionId, subscription!.id))).filter((row) => row.status === "pending").length, 0);
  const downgradeRenewal = await call(base, "/education/subscription/renewal-instructions", "POST", undefined, ownerCookie);
  assert.equal(downgradeRenewal.body.amount, low!.price * 12, "Early renewal must quote the pending lower yearly plan.");
  const [downgradeObligation] = await db.select().from(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.referenceSnapshot, downgradeRenewal.body.reference));
  assert.equal(downgradeObligation!.billingCycleSnapshot, "yearly");
  assert.equal(downgradeObligation!.planIdSnapshot, low!.id);
  await call(base, `/admin/education/payment-obligations/${downgradeObligation!.id}/settle`, "POST", {
    confirmedAmountRsd: downgradeObligation!.expectedAmount, reason: "Niži godišnji plan plaćen unapred",
  }, adminCookie);
  [subscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  assert.equal(subscription!.planId, high!.id, "Prepaid downgrade must preserve the current higher plan until period end.");
  await db.update(educationPaymentObligationsTable).set({
    servicePeriodStart: new Date(Date.now() - 1_000), servicePeriodEnd: new Date(Date.now() + 360 * 86_400_000),
  }).where(eq(educationPaymentObligationsTable.id, downgradeObligation!.id));
  await db.update(educationCenterSubscriptionsTable).set({
    currentPeriodEnd: new Date(Date.now() - 1_000), pendingPlanEffectiveAt: new Date(Date.now() - 1_000),
  }).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  await runEducationSubscriptionLifecycle();
  [subscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  assert.equal(subscription!.planId, low!.id);
  assert.equal(subscription!.billingCycle, "yearly");

  await db.update(educationCenterSubscriptionsTable).set({
    planId: low!.id, billingCycle: "monthly", pendingPlanId: null, pendingBillingCycle: null,
    pendingPlanEffectiveAt: null, currentPeriodStart: new Date(now.getTime() - 10 * 86_400_000),
    currentPeriodEnd: new Date(now.getTime() + 20 * 86_400_000), status: "active",
  }).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  const supersededRenewal = await call(base, "/education/subscription/renewal-instructions", "POST", undefined, ownerCookie);
  const [upgrade, repeatedUpgrade] = await Promise.all([
    call(base, "/education/subscription/select-plan", "POST", { planId: high!.id, billingCycle: "yearly" }, ownerCookie),
    call(base, "/education/subscription/select-plan", "POST", { planId: high!.id, billingCycle: "yearly" }, ownerCookie),
  ]);
  assert.equal(upgrade.status, 201);
  assert.equal(upgrade.body.change, "upgrade_pending_payment");
  assert.equal(repeatedUpgrade.body.payment.id, upgrade.body.payment.id, "Repeated concurrent upgrades must reuse one pending obligation.");
  const [cancelledRenewal] = await db.select().from(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.referenceSnapshot, supersededRenewal.body.reference));
  assert.equal(cancelledRenewal!.status, "cancelled", "An upgrade must supersede a lower-plan renewal.");
  assert.equal((await call(base, "/education/subscription/renewal-instructions", "POST", undefined, ownerCookie)).status, 409, "Renewal must not overlap an unpaid upgrade.");
  assert.ok(upgrade.body.payment.expectedAmount > 0 && upgrade.body.payment.expectedAmount < high!.price);
  assert.equal((await call(base, `/admin/education/payment-obligations/${upgrade.body.payment.id}/settle`, "POST", {
    confirmedAmountRsd: upgrade.body.payment.expectedAmount, reason: "Doplata potvrđena",
  }, adminCookie)).status, 200);
  [subscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  assert.equal(subscription!.planId, high!.id);
  assert.equal(subscription!.billingCycle, "monthly", "Upgrade proration must preserve the paid current cycle.");
  assert.equal(subscription!.pendingBillingCycle, "yearly", "Requested cycle change must remain scheduled for the next boundary.");
  await db.update(educationPaymentObligationsTable).set({ servicePeriodEnd: new Date(Date.now() - 2_000) })
    .where(and(
      eq(educationPaymentObligationsTable.subscriptionId, subscription!.id),
      eq(educationPaymentObligationsTable.kind, "subscription_renewal"),
      eq(educationPaymentObligationsTable.status, "paid"),
    ));
  await db.update(educationCenterSubscriptionsTable).set({
    currentPeriodEnd: new Date(Date.now() - 1_000), pendingPlanEffectiveAt: new Date(Date.now() - 1_000),
  })
    .where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  await runEducationSubscriptionLifecycle();
  [subscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  assert.equal(subscription!.billingCycle, "yearly", "The requested cycle must apply at the next service boundary.");
  await db.update(educationCenterSubscriptionsTable).set({
    planId: low!.id, billingCycle: "monthly", status: "active",
    currentPeriodStart: new Date(Date.now() - 20 * 86_400_000),
    currentPeriodEnd: new Date(Date.now() + 10 * 86_400_000),
    pendingPlanId: null, pendingBillingCycle: null, pendingPlanEffectiveAt: null,
  }).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  const expiringUpgrade = await call(base, "/education/subscription/select-plan", "POST", { planId: high!.id, billingCycle: "monthly" }, ownerCookie);
  const delayedWorkerAt = Date.now();
  await db.update(educationCenterSubscriptionsTable).set({ currentPeriodEnd: new Date(delayedWorkerAt - 50 * 86_400_000) }).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  await runEducationSubscriptionLifecycle();
  [subscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  assert.equal(subscription!.planId, low!.id, "Period expiry must not apply an unpaid upgrade.");
  assert.equal(subscription!.pendingPlanId, null);
  const [expiredUpgrade] = await db.select().from(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.id, expiringUpgrade.body.payment.id));
  assert.equal(expiredUpgrade!.status, "cancelled");
  const pendingRenewals = (await db.select().from(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.subscriptionId, subscription!.id))).filter((row) => row.status === "pending" && row.kind === "subscription_renewal");
  assert.equal(pendingRenewals.length, 1);
  assert.ok(Math.abs(pendingRenewals[0]!.servicePeriodStart!.getTime() - delayedWorkerAt) < 10_000, "A delayed worker must start the unpaid renewal period when it issues the obligation.");
  assert.ok(pendingRenewals[0]!.servicePeriodEnd!.getTime() - pendingRenewals[0]!.servicePeriodStart!.getTime() > 27 * 86_400_000, "A delayed worker must still issue a full monthly service period.");
  const contractEnd = new Date(Date.now() + 200 * 86_400_000);
  const custom = await call(base, `/admin/education/centers/${centerA.id}/custom-contract`, "POST", {
    amountRsd: 222_222, billingCycle: "yearly", contractEndsAt: contractEnd.toISOString(), reason: "Poseban godišnji ugovor",
  }, adminCookie);
  assert.equal(custom.status, 200);
  const [cancelledStale] = await db.select().from(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.id, pendingRenewals[0]!.id));
  assert.equal(cancelledStale!.status, "cancelled", "New custom terms must supersede a stale pending renewal.");
  const customInstructions = await call(base, "/education/subscription/renewal-instructions", "POST", undefined, ownerCookie);
  assert.equal(customInstructions.status, 200);
  assert.equal(customInstructions.body.amount, 222_222);
  const [customObligation] = await db.select().from(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.referenceSnapshot, customInstructions.body.reference));
  assert.equal(customObligation!.servicePeriodEnd!.getTime(), contractEnd.getTime());

  console.log("education subscription contract tests passed");
} finally {
  if (server) { server.close(); await once(server, "close"); }
  if (centerIds.length) {
    const subscriptions = await db.select().from(educationCenterSubscriptionsTable).where(inArray(educationCenterSubscriptionsTable.centerId, centerIds));
    if (subscriptions.length) {
      await db.delete(educationPaymentObligationsTable).where(inArray(educationPaymentObligationsTable.subscriptionId, subscriptions.map((row) => row.id)));
      await db.delete(educationFinancialAuditLogTable).where(inArray(educationFinancialAuditLogTable.entityId, subscriptions.map((row) => row.id)));
    }
    await db.delete(educationTrialClaimsTable).where(inArray(educationTrialClaimsTable.centerId, centerIds));
    await db.delete(educationCenterSubscriptionsTable).where(inArray(educationCenterSubscriptionsTable.centerId, centerIds));
    await db.delete(educationCentersTable).where(inArray(educationCentersTable.id, centerIds));
  }
  if (userIds.length) {
    await db.delete(educationFinancialAuditLogTable).where(inArray(educationFinancialAuditLogTable.actorUserId, userIds));
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  if (planIds.length) await db.delete(subscriptionPlansTable).where(inArray(subscriptionPlansTable.id, planIds));
  if (settingsRestore) {
    await db.update(educationPlatformSettingsTable).set({
      ipsRecipientName: settingsRestore.ipsRecipientName, ipsRecipientAccount: settingsRestore.ipsRecipientAccount,
      ipsPurpose: settingsRestore.ipsPurpose, updatedAt: settingsRestore.updatedAt,
    }).where(eq(educationPlatformSettingsTable.id, settingsRestore.id));
  } else if (insertedSettingsId) {
    await db.delete(educationPlatformSettingsTable).where(eq(educationPlatformSettingsTable.id, insertedSettingsId));
  }
}