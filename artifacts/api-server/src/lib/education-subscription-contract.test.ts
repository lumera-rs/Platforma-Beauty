import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import { createSession, sessionCookieName } from "./auth";
import {
  coursesTable, db, educationBankTransactionsTable, educationCenterSubscriptionsTable, educationCentersTable, educationFinancialAuditLogTable,
  educationPaymentObligationsTable, educationPlatformSettingsTable, educationTrialClaimsTable,
  salonsTable, sessionsTable, subscriptionPlansTable, usersTable,
} from "@workspace/db";
import { addEducationBillingPeriod } from "./education-subscription-domain";
import { runEducationSubscriptionLifecycle } from "./education-subscription-worker";
import {
  educationBankRejectionReasons,
  processNormalizedEducationBankTransaction,
} from "./education-bank-reconciliation";

const marker = `edu-contract-${randomUUID()}`;
const emails = [`owner-a-${marker}@example.test`, `owner-b-${marker}@example.test`];
const userIds: string[] = [];
const centerIds: string[] = [];
const planIds: string[] = [];
const detachedClaimIds: string[] = [];
const reconciliationObligationIds: string[] = [];
const reconciliationTransactionIds: string[] = [];
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

const numericIdentity = (value: string, length: number) => BigInt(`0x${createHash("sha256").update(value).digest("hex")}`)
  .toString().padStart(length, "0").slice(0, length);
const registration = (email: string, planId?: string) => ({
  firstName: "Education", lastName: marker, email, password: "StrongPass123!",
  phone: `+3816${numericIdentity(`${email}:phone`, 8)}`, businessType: "EDUCATION_CENTER", businessName: `Centar ${email}`,
  pib: numericIdentity(`${email}:pib`, 9),
  registrationNumber: numericIdentity(`${email}:registration`, 8),
  bankAccount: numericIdentity(`${email}:bank`, 18),
  city: "Beograd", municipality: "Vračar",
  address: "Test 1", postalCode: "11000", description: `Programi i sertifikacije ${marker}`,
  planId, billingCycle: "monthly",
});

try {
  const belgradeClock = (value: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(value);
  const beforeDst = new Date("2026-03-28T13:30:00.000Z");
  assert.equal(belgradeClock(addEducationBillingPeriod(beforeDst, "monthly")), belgradeClock(beforeDst), "Calendar billing must preserve the Belgrade wall-clock time across DST.");
  const [low, high, constrained, zeroPrice] = await db.insert(subscriptionPlansTable).values([
    { name: `Osnovni ${marker}`, price: 10_000, trialDays: 30, audience: "education", courseLimit: 5, vatIncluded: true, priceCopy: "Cena uključuje PDV.", limits: { courses: 5 }, active: true },
    { name: `Napredni ${marker}`, price: 30_000, trialDays: 30, audience: "education", courseLimit: 15, vatIncluded: true, priceCopy: "Cena uključuje PDV.", limits: { courses: 15 }, active: true },
    { name: `Skuplji ograničeni ${marker}`, price: 40_000, trialDays: 30, audience: "education", courseLimit: 1, vatIncluded: true, priceCopy: "Cena uključuje PDV.", limits: { courses: 1 }, active: true },
    { name: `Bez cene ${marker}`, price: 0, trialDays: 30, audience: "education", courseLimit: 30, vatIncluded: true, priceCopy: "Cena uključuje PDV.", limits: { courses: 30 }, active: false },
  ]).returning();
  planIds.push(low!.id, high!.id, constrained!.id, zeroPrice!.id);
  const [admin] = await db.insert(usersTable).values({
    firstName: "Admin", lastName: marker, email: `admin-${marker}@example.test`,
    passwordHash: "fixture", passwordSetAt: new Date(), role: "SUPER_ADMIN",
  }).returning();
  adminId = admin!.id; userIds.push(admin!.id);

  const [currentSettings] = await db.select().from(educationPlatformSettingsTable).orderBy(educationPlatformSettingsTable.createdAt).limit(1);
  if (currentSettings) {
    settingsRestore = currentSettings;
    await db.update(educationPlatformSettingsTable).set({
      ipsRecipientName: `LUMERA ${marker}`, ipsRecipientAccount: "840000000000000000", ipsPurpose: "Education pretplata", ipsAccountEnvironment: "test",
      bankReconciliationEnabled: false,
      bankReconciliationAccessMethod: null,
      bankReconciliationAccessConfirmedAt: null,
      bankReconciliationAccessConfirmedByUserId: null,
    }).where(eq(educationPlatformSettingsTable.id, currentSettings.id));
  } else {
    const [created] = await db.insert(educationPlatformSettingsTable).values({
      ipsRecipientName: `LUMERA ${marker}`, ipsRecipientAccount: "840000000000000000", ipsPurpose: "Education pretplata", ipsAccountEnvironment: "test",
      bankReconciliationEnabled: false,
    }).returning();
    insertedSettingsId = created!.id;
  }
  const platformSettingsId = settingsRestore?.id ?? insertedSettingsId!;

  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const publicPlans = await call(base, "/education/subscription/plans", "GET");
  assert.ok(!publicPlans.body.some((plan: { id: string }) => plan.id === zeroPrice!.id), "A zero-price seed must remain unlistable.");

  const missingPlan = await call(base, "/auth/business-register", "POST", registration(`missing-${marker}@example.test`));
  assert.equal(missingPlan.status, 400);
  assert.equal((await db.select().from(usersTable).where(eq(usersTable.email, `missing-${marker}@example.test`))).length, 0);

  const firstInput = registration(emails[0]!, low!.id);
  const firstRegistration = await call(base, "/auth/business-register", "POST", firstInput);
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
  assert.equal(claim.normalizedRegistrationNumberHash?.length, 64);
  assert.equal(claim.normalizedBankAccountHash?.length, 64);
  assert.ok(!JSON.stringify(claim).includes(firstInput.registrationNumber));
  assert.ok(!JSON.stringify(claim).includes(firstInput.bankAccount));

  const secondInput = registration(emails[1]!, low!.id);
  secondInput.pib = "987654321";
  secondInput.phone = firstInput.phone;
  const secondRegistration = await call(base, "/auth/business-register", "POST", secondInput);
  assert.equal(secondRegistration.status, 201);
  const [ownerB] = await db.select().from(usersTable).where(eq(usersTable.email, emails[1]!));
  assert.ok(ownerB); userIds.push(ownerB.id);
  const [centerB] = await db.select().from(educationCentersTable).where(eq(educationCentersTable.ownerId, ownerB.id));
  assert.ok(centerB); centerIds.push(centerB.id);
  const [secondSubscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, centerB.id));
  assert.equal(secondSubscription!.status, "past_due", "Reusing a durable phone identity must not grant another trial.");

  const deletedInput = registration(`deleted-${marker}@example.test`, low!.id);
  deletedInput.registrationNumber = "12-345 678";
  deletedInput.bankAccount = "840-0000000000000-00";
  const deletedRegistration = await call(base, "/auth/business-register", "POST", deletedInput);
  assert.equal(deletedRegistration.status, 201);
  const [deletedOwner] = await db.select().from(usersTable).where(eq(usersTable.email, deletedInput.email));
  const [deletedCenter] = await db.select().from(educationCentersTable).where(eq(educationCentersTable.ownerId, deletedOwner!.id));
  const [durableClaim] = await db.select().from(educationTrialClaimsTable).where(eq(educationTrialClaimsTable.centerId, deletedCenter!.id));
  assert.ok(durableClaim);
  detachedClaimIds.push(durableClaim.id);
  await db.delete(educationFinancialAuditLogTable).where(eq(educationFinancialAuditLogTable.actorUserId, deletedOwner!.id));
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, deletedOwner!.id));
  await db.delete(educationCentersTable).where(eq(educationCentersTable.id, deletedCenter!.id));
  await db.delete(usersTable).where(eq(usersTable.id, deletedOwner!.id));
  const [claimAfterDeletion] = await db.select().from(educationTrialClaimsTable).where(eq(educationTrialClaimsTable.id, durableClaim.id));
  assert.ok(claimAfterDeletion, "Deleting the original account and center must retain the trial claim.");
  assert.equal(claimAfterDeletion.userId, null);
  assert.equal(claimAfterDeletion.centerId, null);

  const [directOwner] = await db.insert(usersTable).values({
    firstName: "Direct", lastName: marker, email: `direct-${marker}@example.test`,
    passwordHash: "fixture", passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR",
    phone: `+3816${numericIdentity(`${marker}:direct-phone`, 8)}`,
  }).returning();
  userIds.push(directOwner!.id);
  const [directCenter] = await db.insert(educationCentersTable).values({
    ownerId: directOwner!.id, name: `Direct ${marker}`, city: "Beograd",
    description: marker, imageUrl: "/test.jpg", pib: deletedInput.pib,
    registrationNumber: numericIdentity(`${marker}:direct-registration`, 8),
    bankAccount: numericIdentity(`${marker}:direct-bank`, 18),
  }).returning();
  centerIds.push(directCenter!.id);
  const directCookie = `${sessionCookieName}=${await createSession(directOwner!.id)}`;
  const directSelection = await call(base, "/education/subscription/select-plan", "POST", {
    planId: low!.id, billingCycle: "monthly",
  }, directCookie);
  assert.equal(directSelection.status, 201);
  assert.equal(directSelection.body.status, "past_due",
    "Plan selection must atomically deny a trial when the deleted center's PIB claim is reused.");

  for (const [kind, mutate] of [
    ["PIB", (input: ReturnType<typeof registration>) => { input.pib = deletedInput.pib; }],
    ["registration number", (input: ReturnType<typeof registration>) => { input.registrationNumber = "12345678"; }],
    ["bank account", (input: ReturnType<typeof registration>) => { input.bankAccount = "840 0000000000000 00"; }],
  ] as const) {
    const duplicateInput = registration(`duplicate-${kind.toLowerCase().replaceAll(" ", "-")}-${marker}@example.test`, low!.id);
    mutate(duplicateInput);
    const duplicate = await call(base, "/auth/business-register", "POST", duplicateInput);
    assert.equal(duplicate.status, 201);
    const [duplicateOwner] = await db.select().from(usersTable).where(eq(usersTable.email, duplicateInput.email));
    userIds.push(duplicateOwner!.id);
    const [duplicateCenter] = await db.select().from(educationCentersTable).where(eq(educationCentersTable.ownerId, duplicateOwner!.id));
    centerIds.push(duplicateCenter!.id);
    const [duplicateSubscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.centerId, duplicateCenter!.id));
    assert.equal(duplicateSubscription!.status, "past_due", `Reusing a deleted account's ${kind} must not grant another trial.`);
  }

  const ownerCookie = `${sessionCookieName}=${await createSession(ownerA.id)}`;
  const secondOwnerCookie = `${sessionCookieName}=${await createSession(ownerB.id)}`;
  const adminCookie = `${sessionCookieName}=${await createSession(admin!.id)}`;
  assert.equal((await call(base, `/admin/education/subscription-plans/${zeroPrice!.id}`, "PATCH", { active: true }, adminCookie)).status, 400,
    "Administration must not activate an Education plan before setting a positive price.");
  assert.equal((await call(base, "/education/subscription/select-plan", "POST", { planId: zeroPrice!.id, billingCycle: "monthly" }, ownerCookie)).status, 404,
    "Owners cannot select a non-positive plan.");
  await db.update(educationCenterSubscriptionsTable).set({ planId: zeroPrice!.id, status: "past_due" }).where(eq(educationCenterSubscriptionsTable.id, secondSubscription!.id));
  assert.equal((await call(base, "/education/subscription/renewal-instructions", "POST", undefined, secondOwnerCookie)).status, 409,
    "Renewal must not construct IPS instructions for a non-positive plan.");
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
  assert.match(yearlyInstructions.body.ips.payload, /\|I:RSD120000,00\|/,
    "Standard subscription instructions use the NBS decimal comma.");
  assert.equal(repeatedInstructions.body.reference, yearlyInstructions.body.reference, "Pending renewal instructions must be idempotent.");
  const [yearlyObligation] = await db.select().from(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.referenceSnapshot, yearlyInstructions.body.reference));
  assert.equal(yearlyObligation!.billingCycleSnapshot, "yearly");
  assert.equal((await call(base, `/admin/education/payment-obligations/${yearlyObligation!.id}/settle`, "POST", {
    confirmedAmountRsd: yearlyObligation!.expectedAmount, reason: "x",
  }, adminCookie)).status, 400, "A meaningful settlement reason remains mandatory.");
  assert.equal((await call(base, `/admin/education/payment-obligations/${yearlyObligation!.id}/settle`, "POST", {
    confirmedAmountRsd: yearlyObligation!.expectedAmount - 1, reason: "Iznos se ne poklapa",
  }, adminCookie)).status, 409, "A received amount mismatch must not settle the obligation.");
  const [stillPendingObligation] = await db.select().from(educationPaymentObligationsTable)
    .where(eq(educationPaymentObligationsTable.id, yearlyObligation!.id));
  assert.equal(stillPendingObligation!.status, "pending");
  assert.equal(stillPendingObligation!.confirmedAmount, null);
  const settlementReasons = ["Godišnja uplata potvrđena A", "Godišnja uplata potvrđena B"];
  const concurrentSettlements = await Promise.all(settlementReasons.map(reason => call(
    base,
    `/admin/education/payment-obligations/${yearlyObligation!.id}/settle`,
    "POST",
    { confirmedAmountRsd: yearlyObligation!.expectedAmount, reason },
    adminCookie,
  )));
  assert.deepEqual(concurrentSettlements.map(result => result.status).sort(), [200, 409],
    "Concurrent manual confirmations must process the obligation exactly once.");
  const [paidObligation] = await db.select().from(educationPaymentObligationsTable)
    .where(eq(educationPaymentObligationsTable.id, yearlyObligation!.id));
  assert.equal(paidObligation!.status, "paid");
  assert.equal(paidObligation!.confirmedAmount, yearlyObligation!.expectedAmount);
  const settlementAudits = await db.select().from(educationFinancialAuditLogTable).where(and(
    eq(educationFinancialAuditLogTable.entityId, yearlyObligation!.id),
    eq(educationFinancialAuditLogTable.action, "education_payment_obligation_settled"),
  ));
  assert.equal(settlementAudits.length, 1, "Only the winning settlement writes an audit row.");
  assert.ok(settlementAudits[0]!.reason && settlementReasons.includes(settlementAudits[0]!.reason));
  assert.deepEqual(settlementAudits[0]!.oldValue, {
    status: "pending",
    expectedAmount: yearlyObligation!.expectedAmount,
  });
  assert.deepEqual(settlementAudits[0]!.newValue, {
    status: "paid",
    confirmedAmount: yearlyObligation!.expectedAmount,
  });

  const initialReconciliationStatus = await call(base, "/admin/education/bank-reconciliation", "GET", undefined, adminCookie);
  assert.equal(initialReconciliationStatus.status, 200);
  assert.deepEqual({
    enabled: initialReconciliationStatus.body.enabled,
    engineState: initialReconciliationStatus.body.engineState,
    bankConnectionConfigured: initialReconciliationStatus.body.bankConnectionConfigured,
  }, {
    enabled: false,
    engineState: "disabled",
    bankConnectionConfigured: false,
  }, "The reconciliation engine defaults to disabled and never claims a configured bank connection.");
  assert.equal(initialReconciliationStatus.body.accessMethod, null);
  assert.equal(initialReconciliationStatus.body.accessConfirmed, false);
  assert.equal(initialReconciliationStatus.body.accessConfirmedAt, null);
  assert.deepEqual(
    initialReconciliationStatus.body.accessMethods.map((method: { id: string }) => method.id),
    ["camt053", "csv", "raiffeisen_open_banking", "aggregator"],
  );
  const previewSourceId = `${marker}:preview-only`;
  const camtXml = `<?xml version="1.0"?>
    <Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
      <BkToCstmrStmt><Stmt><Id>${marker}</Id><Ntry>
        <Amt Ccy="RSD">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-09-01</Dt></BookgDt>
        <NtryDtls><TxDtls><Refs><AcctSvcrRef>${previewSourceId}</AcctSvcrRef><EndToEndId>UNKNOWN-${marker}</EndToEndId></Refs></TxDtls></NtryDtls>
      </Ntry></Stmt></BkToCstmrStmt>
    </Document>`;
  const camtPreview = await call(
    base,
    "/admin/education/bank-reconciliation/camt053/preview",
    "POST",
    { xml: camtXml },
    adminCookie,
  );
  assert.equal(camtPreview.status, 200);
  assert.equal(camtPreview.body.readyCount, 1);
  assert.equal(camtPreview.body.items[0].sourceItemId, previewSourceId);
  const previewWrites = await db.select({ id: educationBankTransactionsTable.id })
    .from(educationBankTransactionsTable)
    .where(and(
      eq(educationBankTransactionsTable.source, "raiffeisen_camt053"),
      eq(educationBankTransactionsTable.sourceItemId, previewSourceId),
    ));
  assert.equal(previewWrites.length, 0, "CAMT preview must not persist or reconcile the raw statement.");
  const disabledCamtImport = await call(
    base,
    "/admin/education/bank-reconciliation/camt053/import",
    "POST",
    { xml: camtXml },
    adminCookie,
  );
  assert.equal(disabledCamtImport.status, 409);
  const unsafeCamtPreview = await call(
    base,
    "/admin/education/bank-reconciliation/camt053/preview",
    "POST",
    { xml: `<!DOCTYPE Document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${camtXml}` },
    adminCookie,
  );
  assert.equal(unsafeCamtPreview.status, 400);

  const disabledBankItem = await processNormalizedEducationBankTransaction({
    source: "contract-fixture",
    sourceItemId: `${marker}:disabled`,
    reference: `UNKNOWN-${marker}`,
    amountRsd: 1_000,
    receivedAt: new Date(),
  });
  reconciliationTransactionIds.push(disabledBankItem.transaction.id);
  assert.equal(disabledBankItem.transaction.result, "rejected");
  assert.equal(disabledBankItem.transaction.rejectionReason, educationBankRejectionReasons.engineDisabled);

  await db.update(educationPlatformSettingsTable).set({
    bankReconciliationEnabled: true,
    bankReconciliationAccessMethod: null,
    bankReconciliationAccessConfirmedAt: null,
    bankReconciliationAccessConfirmedByUserId: null,
  }).where(eq(educationPlatformSettingsTable.id, platformSettingsId));
  const awaitingConfirmationStatus = await call(base, "/admin/education/bank-reconciliation", "GET", undefined, adminCookie);
  assert.equal(awaitingConfirmationStatus.body.engineState, "awaiting_access_confirmation");
  const unconfirmedBankItem = await processNormalizedEducationBankTransaction({
    source: "contract-fixture",
    sourceItemId: `${marker}:unconfirmed`,
    reference: `UNKNOWN-UNCONFIRMED-${marker}`,
    amountRsd: 1_000,
    receivedAt: new Date(),
  });
  reconciliationTransactionIds.push(unconfirmedBankItem.transaction.id);
  assert.equal(unconfirmedBankItem.transaction.rejectionReason, educationBankRejectionReasons.accessUnconfirmed);
  await db.update(educationPlatformSettingsTable).set({ bankReconciliationEnabled: false })
    .where(eq(educationPlatformSettingsTable.id, platformSettingsId));

  const invalidReconciliationMethod = await call(
    base,
    "/admin/education/bank-reconciliation",
    "PATCH",
    { enabled: true, accessMethod: "unknown-provider" },
    adminCookie,
  );
  assert.equal(invalidReconciliationMethod.status, 400);

  const enabledReconciliationStatus = await call(
    base,
    "/admin/education/bank-reconciliation",
    "PATCH",
    { enabled: true, accessMethod: "camt053" },
    adminCookie,
  );
  assert.equal(enabledReconciliationStatus.status, 200);
  assert.equal(enabledReconciliationStatus.body.engineState, "ready_for_import");
  assert.equal(enabledReconciliationStatus.body.bankConnectionConfigured, false);
  assert.equal(enabledReconciliationStatus.body.accessMethod, "camt053");
  assert.equal(enabledReconciliationStatus.body.accessConfirmed, true);
  assert.ok(enabledReconciliationStatus.body.accessConfirmedAt);

  const unknownBankItem = await processNormalizedEducationBankTransaction({
    source: "contract-fixture",
    sourceItemId: `${marker}:unknown`,
    reference: `UNKNOWN-ENABLED-${marker}`,
    amountRsd: 1_000,
    receivedAt: new Date(),
  });
  reconciliationTransactionIds.push(unknownBankItem.transaction.id);
  assert.equal(unknownBankItem.transaction.result, "rejected");
  assert.equal(unknownBankItem.transaction.rejectionReason, educationBankRejectionReasons.referenceNotFound);

  const [amountObligation, automatedObligation, raceObligation] = await db.insert(educationPaymentObligationsTable).values([
    {
      centerId: centerA.id,
      kind: "reconciliation_contract_fixture",
      expectedAmount: 22_222,
      recipientNameSnapshot: `LUMERA ${marker}`,
      recipientAccountSnapshot: "840000000000000000",
      paymentCodeSnapshot: "221",
      purposeSnapshot: "Reconciliation automated fixture",
      referenceSnapshot: `EDU-AUTO-${marker}`,
    },
    {
      centerId: centerA.id,
      kind: "reconciliation_contract_fixture",
      expectedAmount: 12_345,
      recipientNameSnapshot: `LUMERA ${marker}`,
      recipientAccountSnapshot: "840000000000000000",
      paymentCodeSnapshot: "221",
      purposeSnapshot: "Reconciliation amount fixture",
      referenceSnapshot: `EDU-AMOUNT-${marker}`,
    },
    {
      centerId: centerA.id,
      kind: "reconciliation_contract_fixture",
      expectedAmount: 23_456,
      recipientNameSnapshot: `LUMERA ${marker}`,
      recipientAccountSnapshot: "840000000000000000",
      paymentCodeSnapshot: "221",
      purposeSnapshot: "Reconciliation race fixture",
      referenceSnapshot: `EDU-RACE-${marker}`,
    },
  ]).returning();
  reconciliationObligationIds.push(amountObligation!.id, automatedObligation!.id, raceObligation!.id);

  const amountMismatch = await processNormalizedEducationBankTransaction({
    source: "contract-fixture",
    sourceItemId: `${marker}:amount`,
    reference: amountObligation!.referenceSnapshot,
    amountRsd: amountObligation!.expectedAmount - 1,
    receivedAt: new Date(),
  });
  reconciliationTransactionIds.push(amountMismatch.transaction.id);
  assert.equal(amountMismatch.transaction.result, "rejected");
  assert.equal(amountMismatch.transaction.rejectionReason, educationBankRejectionReasons.amountMismatch);
  assert.equal(amountMismatch.transaction.obligationId, amountObligation!.id);
  const duplicateAmountMismatch = await processNormalizedEducationBankTransaction({
    source: "contract-fixture",
    sourceItemId: `${marker}:amount`,
    reference: amountObligation!.referenceSnapshot,
    amountRsd: amountObligation!.expectedAmount - 1,
    receivedAt: new Date(),
  });
  assert.equal(duplicateAmountMismatch.duplicate, true);
  assert.equal(duplicateAmountMismatch.transaction.id, amountMismatch.transaction.id);

  const automatedInput = {
    source: "contract-fixture",
    sourceItemId: `${marker}:automated`,
    reference: automatedObligation!.referenceSnapshot,
    amountRsd: automatedObligation!.expectedAmount,
    receivedAt: new Date(),
  };
  const concurrentSameSource = await Promise.all([
    processNormalizedEducationBankTransaction(automatedInput),
    processNormalizedEducationBankTransaction(automatedInput),
  ]);
  assert.deepEqual(concurrentSameSource.map((result) => result.duplicate).sort(), [false, true],
    "Concurrent delivery of one source item must claim and process it once.");
  assert.equal(concurrentSameSource[0]!.transaction.id, concurrentSameSource[1]!.transaction.id);
  const automatedResult = concurrentSameSource[0]!.duplicate ? concurrentSameSource[1]! : concurrentSameSource[0]!;
  reconciliationTransactionIds.push(automatedResult.transaction.id);
  assert.equal(automatedResult.transaction.result, "settled");
  assert.equal(automatedResult.transaction.obligationId, automatedObligation!.id);
  const [automaticallyPaid] = await db.select().from(educationPaymentObligationsTable)
    .where(eq(educationPaymentObligationsTable.id, automatedObligation!.id));
  assert.equal(automaticallyPaid!.status, "paid");
  assert.equal(automaticallyPaid!.confirmedAmount, automatedObligation!.expectedAmount);
  assert.equal(automaticallyPaid!.confirmedByUserId, null, "Automated settlement must not impersonate an administrator.");
  const automatedSettlementAudits = await db.select().from(educationFinancialAuditLogTable).where(and(
    eq(educationFinancialAuditLogTable.entityId, automatedObligation!.id),
    eq(educationFinancialAuditLogTable.action, "education_payment_obligation_settled"),
  ));
  assert.equal(automatedSettlementAudits.length, 1);
  assert.equal(automatedSettlementAudits[0]!.actorUserId, null);
  assert.deepEqual(automatedSettlementAudits[0]!.newValue, {
    status: "paid",
    confirmedAmount: automatedObligation!.expectedAmount,
    settlementSource: "bank_reconciliation",
    bankTransactionId: automatedResult.transaction.id,
  });

  const [automatedRace, manualRace] = await Promise.all([
    processNormalizedEducationBankTransaction({
      source: "contract-fixture",
      sourceItemId: `${marker}:race`,
      reference: raceObligation!.referenceSnapshot,
      amountRsd: raceObligation!.expectedAmount,
      receivedAt: new Date(),
    }),
    call(base, `/admin/education/payment-obligations/${raceObligation!.id}/settle`, "POST", {
      confirmedAmountRsd: raceObligation!.expectedAmount,
      reason: "Konkurentna ručna potvrda",
    }, adminCookie),
  ]);
  reconciliationTransactionIds.push(automatedRace.transaction.id);
  assert.ok(
    (automatedRace.transaction.result === "settled" && manualRace.status === 409)
    || (
      automatedRace.transaction.result === "rejected"
      && automatedRace.transaction.rejectionReason === educationBankRejectionReasons.obligationNotPending
      && manualRace.status === 200
    ),
    "Automated and manual settlement must produce exactly one winner.",
  );
  const secondRaceItem = await processNormalizedEducationBankTransaction({
    source: "contract-fixture",
    sourceItemId: `${marker}:race-second`,
    reference: raceObligation!.referenceSnapshot,
    amountRsd: raceObligation!.expectedAmount,
    receivedAt: new Date(),
  });
  reconciliationTransactionIds.push(secondRaceItem.transaction.id);
  assert.equal(secondRaceItem.transaction.result, "rejected");
  assert.equal(secondRaceItem.transaction.rejectionReason, educationBankRejectionReasons.obligationNotPending);

  const raceSettlementAudits = await db.select().from(educationFinancialAuditLogTable).where(and(
    eq(educationFinancialAuditLogTable.entityId, raceObligation!.id),
    eq(educationFinancialAuditLogTable.action, "education_payment_obligation_settled"),
  ));
  assert.equal(raceSettlementAudits.length, 1, "The auto/manual race writes one canonical settlement audit.");
  const processingAudits = await db.select().from(educationFinancialAuditLogTable).where(and(
    inArray(educationFinancialAuditLogTable.entityId, reconciliationTransactionIds),
    eq(educationFinancialAuditLogTable.action, "education_bank_transaction_processed"),
  ));
  assert.equal(processingAudits.length, reconciliationTransactionIds.length,
    "Every unique normalized bank item writes one processing audit; the duplicate writes none.");
  [subscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  assert.equal(subscription!.status, "active");
  assert.ok(subscription!.currentPeriodEnd!.getTime() - subscription!.currentPeriodStart!.getTime() > 360 * 86_400_000);
  const rejectedCurrentContract = await call(base, `/admin/education/centers/${centerA.id}/custom-contract`, "POST", {
    amountRsd: 222_222, billingCycle: "yearly", courseLimit: 30, autoRenew: true, contractEndsAt: new Date(Date.now() + 400 * 86_400_000).toISOString(), reason: "Ne sme prekinuti tekući plaćeni period",
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
    amountRsd: 333_333, billingCycle: "yearly", courseLimit: 30, autoRenew: true, contractEndsAt: new Date(Date.now() + 400 * 86_400_000).toISOString(), reason: "Ne sme prekinuti plaćeni period",
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
  assert.equal(subscription!.planId, low!.id, "A different-cycle upgrade must retain the current plan until the configured boundary.");
  assert.equal(subscription!.billingCycle, "monthly", "Upgrade proration must preserve the paid current cycle.");
  assert.equal(subscription!.currentPriceSnapshot, low!.price);
  assert.equal(subscription!.currentCourseLimitSnapshot, low!.courseLimit);
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
  assert.equal(subscription!.planId, high!.id, "The paid deferred upgrade must apply at its configured service boundary.");
  assert.equal(subscription!.billingCycle, "yearly", "The requested cycle must apply at the next service boundary.");
  assert.equal(subscription!.currentPriceSnapshot, high!.price);
  assert.equal(subscription!.currentCourseLimitSnapshot, high!.courseLimit);
  await db.update(educationCenterSubscriptionsTable).set({
    status: "active",
    planId: high!.id,
    billingCycle: "monthly",
    currentPriceSnapshot: high!.price,
    currentCourseLimitSnapshot: high!.courseLimit,
    currentPeriodStart: new Date(Date.now() - 20 * 86_400_000),
    currentPeriodEnd: new Date(Date.now() + 10 * 86_400_000),
    graceEndsAt: null,
  }).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  const published = await db.insert(coursesTable).values([
    { centerId: centerA.id, title: `Zadrži ${marker}`, category: "Test", format: "online", price: 1000, duration: "1h", imageUrl: "/test-course-1.jpg", published: true },
    { centerId: centerA.id, title: `Suspenduj ${marker}`, category: "Test", format: "online", price: 1000, duration: "1h", imageUrl: "/test-course-2.jpg", published: true },
  ]).returning();
  [subscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  assert.equal(subscription!.currentCourseLimitSnapshot, high!.courseLimit,
    "The paid higher tier must retain its frozen course limit before a later change.");
  assert.equal(published.filter((course) => course.published).length, 2);
  const constrainedWithoutKeep = await call(base, "/education/subscription/select-plan", "POST", {
    planId: constrained!.id, billingCycle: "yearly",
  }, ownerCookie);
  assert.equal(constrainedWithoutKeep.status, 409,
    `A higher-price lower-limit target still requires an exact published-course selection: ${JSON.stringify(constrainedWithoutKeep.body)}`);
  const constrainedUpgrade = await call(base, "/education/subscription/select-plan", "POST", {
    planId: constrained!.id, billingCycle: "yearly", keepCourseIds: [published[0]!.id],
  }, ownerCookie);
  assert.equal(constrainedUpgrade.status, 201);
  assert.equal((await call(base, `/admin/education/payment-obligations/${constrainedUpgrade.body.payment.id}/settle`, "POST", {
    confirmedAmountRsd: constrainedUpgrade.body.payment.expectedAmount, reason: "Skuplji plan sa manjim limitom",
  }, adminCookie)).status, 200);
  [subscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  assert.equal(subscription!.planId, high!.id, "A different-cycle upgrade must retain the current paid-period plan until its effective boundary.");
  assert.equal(subscription!.currentPriceSnapshot, high!.price);
  assert.equal(subscription!.currentCourseLimitSnapshot, high!.courseLimit);
  let reconciled = await db.select().from(coursesTable).where(inArray(coursesTable.id, published.map((course) => course.id)));
  assert.equal(reconciled.filter((course) => course.published).length, 2,
    "Deferred upgrade settlement must not reduce the current paid-period entitlement.");
  await db.update(educationCenterSubscriptionsTable).set({
    currentPeriodEnd: new Date(Date.now() - 1_000),
    pendingPlanEffectiveAt: new Date(Date.now() - 1_000),
  }).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  await runEducationSubscriptionLifecycle();
  [subscription] = await db.select().from(educationCenterSubscriptionsTable).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  assert.equal(subscription!.planId, constrained!.id);
  assert.equal(subscription!.currentPriceSnapshot, constrained!.price);
  assert.equal(subscription!.currentCourseLimitSnapshot, constrained!.courseLimit);
  reconciled = await db.select().from(coursesTable).where(inArray(coursesTable.id, published.map((course) => course.id)));
  assert.equal(reconciled.filter((course) => course.published).length, 1, "Upgrade settlement must enforce its lower entitlement.");
  assert.equal(reconciled.find((course) => course.id === published[0]!.id)?.published, true);
  assert.equal(reconciled.find((course) => course.id === published[1]!.id)?.subscriptionSuspended, true);
  await db.update(educationCenterSubscriptionsTable).set({
    planId: low!.id, billingCycle: "monthly", status: "active",
    currentPriceSnapshot: low!.price,
    currentCourseLimitSnapshot: low!.courseLimit,
    currentPeriodStart: new Date(Date.now() - 20 * 86_400_000),
    currentPeriodEnd: new Date(Date.now() + 10 * 86_400_000),
    pendingPlanId: null, pendingBillingCycle: null, pendingPlanEffectiveAt: null,
  }).where(eq(educationCenterSubscriptionsTable.id, subscription!.id));
  await db.update(subscriptionPlansTable).set({ price: high!.price + 10_000 }).where(eq(subscriptionPlansTable.id, low!.id));
  const expiringUpgrade = await call(base, "/education/subscription/select-plan", "POST", { planId: high!.id, billingCycle: "monthly" }, ownerCookie);
  assert.equal(expiringUpgrade.body.change, "upgrade_pending_payment",
    "Upgrade classification must use the frozen current-period price, not an edited catalog price.");
  assert.ok(expiringUpgrade.body.payment.expectedAmount > 0);
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
    amountRsd: 222_222, billingCycle: "yearly", courseLimit: 30, autoRenew: false, contractEndsAt: contractEnd.toISOString(), reason: "Poseban godišnji ugovor",
  }, adminCookie);
  assert.equal(custom.status, 200);
  const [cancelledStale] = await db.select().from(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.id, pendingRenewals[0]!.id));
  assert.equal(cancelledStale!.status, "cancelled", "New custom terms must supersede a stale pending renewal.");
  const customInstructions = await call(base, "/education/subscription/renewal-instructions", "POST", undefined, ownerCookie);
  assert.equal(customInstructions.status, 200);
  assert.equal(customInstructions.body.amount, 222_222);
  assert.match(customInstructions.body.ips.payload, /\|I:RSD222222,00\|/,
    "Custom-contract instructions use the same NBS amount formatter.");
  const [customObligation] = await db.select().from(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.referenceSnapshot, customInstructions.body.reference));
  assert.equal(customObligation!.servicePeriodEnd!.getTime(), contractEnd.getTime());
  const legacyCustomIps = {
    ...JSON.parse(customObligation!.ipsPayloadSnapshot!),
    payload: customInstructions.body.ips.payload.replace("RSD222222,00", "RSD222222.00"),
  };
  await db.update(educationPaymentObligationsTable).set({ ipsPayloadSnapshot: JSON.stringify(legacyCustomIps) })
    .where(eq(educationPaymentObligationsTable.id, customObligation!.id));
  const legacyCustomInstructions = await call(base, "/education/subscription/renewal-instructions", "POST", undefined, ownerCookie);
  assert.match(legacyCustomInstructions.body.ips.payload, /\|I:RSD222222\.00\|/,
    "Previously issued IPS snapshots are returned unchanged rather than reformatted.");
  assert.equal((await call(base, `/admin/education/payment-obligations/${customObligation!.id}/settle`, "POST", {
    confirmedAmountRsd: customObligation!.expectedAmount, reason: "Poseban ugovor plaćen",
  }, adminCookie)).status, 200);
  const repeatedCustomInstructions = await call(base, "/education/subscription/renewal-instructions", "POST", undefined, ownerCookie);
  assert.equal(repeatedCustomInstructions.body.reference, customObligation!.referenceSnapshot, "A paid custom-contract term must not produce another payable obligation.");
  const sameCustomTerm = (await db.select().from(educationPaymentObligationsTable).where(and(
    eq(educationPaymentObligationsTable.subscriptionId, subscription!.id),
    eq(educationPaymentObligationsTable.kind, "subscription_renewal"),
    eq(educationPaymentObligationsTable.servicePeriodEnd, contractEnd),
  ))).filter((row) => row.status === "pending" || row.status === "paid");
  assert.equal(sameCustomTerm.length, 1);

  console.log("education subscription contract tests passed");
} finally {
  if (server) { server.close(); await once(server, "close"); }
  if (reconciliationTransactionIds.length) {
    await db.delete(educationFinancialAuditLogTable).where(inArray(educationFinancialAuditLogTable.entityId, reconciliationTransactionIds));
    await db.delete(educationBankTransactionsTable).where(inArray(educationBankTransactionsTable.id, reconciliationTransactionIds));
  }
  if (reconciliationObligationIds.length) {
    await db.delete(educationFinancialAuditLogTable).where(inArray(educationFinancialAuditLogTable.entityId, reconciliationObligationIds));
    await db.delete(educationPaymentObligationsTable).where(inArray(educationPaymentObligationsTable.id, reconciliationObligationIds));
  }
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
  if (detachedClaimIds.length) await db.delete(educationTrialClaimsTable).where(inArray(educationTrialClaimsTable.id, detachedClaimIds));
  if (settingsRestore) {
    await db.update(educationPlatformSettingsTable).set({
      ipsRecipientName: settingsRestore.ipsRecipientName, ipsRecipientAccount: settingsRestore.ipsRecipientAccount,
      ipsPurpose: settingsRestore.ipsPurpose, ipsAccountEnvironment: settingsRestore.ipsAccountEnvironment, updatedAt: settingsRestore.updatedAt,
      bankReconciliationEnabled: settingsRestore.bankReconciliationEnabled,
      bankReconciliationAccessMethod: settingsRestore.bankReconciliationAccessMethod,
      bankReconciliationAccessConfirmedAt: settingsRestore.bankReconciliationAccessConfirmedAt,
      bankReconciliationAccessConfirmedByUserId: settingsRestore.bankReconciliationAccessConfirmedByUserId,
    }).where(eq(educationPlatformSettingsTable.id, settingsRestore.id));
  } else if (insertedSettingsId) {
    await db.delete(educationPlatformSettingsTable).where(eq(educationPlatformSettingsTable.id, insertedSettingsId));
  }
  if (userIds.length) {
    await db.delete(educationFinancialAuditLogTable).where(inArray(educationFinancialAuditLogTable.actorUserId, userIds));
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  if (planIds.length) await db.delete(subscriptionPlansTable).where(inArray(subscriptionPlansTable.id, planIds));
}