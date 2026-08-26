import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  appointmentsTable,
  businessVerificationAuditsTable,
  courseEnrollmentsTable,
  coursesTable,
  db,
  educationCentersTable,
  educationCenterSubscriptionsTable,
  legalEntitiesTable,
  legalEntityBusinessesTable,
  phoneVerificationProofsTable,
  referralAttributionsTable,
  referralCodesTable,
  referralCreditLedgerTable,
  referralCreditRedemptionsTable,
  referralMilestoneBenefitsTable,
  referralQualificationEvidenceTable,
  referralQualificationsTable,
  referralReviewsTable,
  salonsTable,
  subscriptionPlansTable,
  subscriptionsTable,
  usersTable,
} from "@workspace/db";
import {
  REFERRAL_POLICY,
  SALON_TYPE_A_SUBSCRIPTION_DISCOUNT_PERCENT,
  creditExpiry,
  canEarnUnderCap,
  milestoneBenefitKind,
  milestoneCrossed,
  normalizePib,
  qualificationHoldUntil,
  qualificationSatisfied,
  qualificationWindow,
  referralIdempotencyKey,
  type ReferralChannel,
  type ReferralSourceBusiness,
} from "./referral-domain";
import { enqueueTransactionalEmail, lumeraEmailHtml } from "./brevo";
import { drainReferralSmsOutbox, enqueueReferralSmsInTx } from "./sms";

type ReferralTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const REFERRAL_EMAIL_TYPES = [
  "referral_signup_attributed",
  "referral_credit_available",
  "referral_milestone",
  "referral_credit_expiry_warning",
] as const;

export type ReferralWalletScope = {
  ownerUserId: string;
  walletKind: "B2B" | "B2C";
  salonId?: string | null;
  educationCenterId?: string | null;
};

export type ReferralCreditAllocation = { ledgerEntryId: string; amountRsd: number };

type ReferralSourceFact = Pick<typeof referralCreditLedgerTable.$inferSelect,
  "type" | "amountRsd" | "effectiveAt">;

type ReferralWalletSnapshotEntry = Pick<typeof referralCreditLedgerTable.$inferSelect,
  "id" | "type" | "amountRsd" | "expiresAt" | "effectiveAt" | "metadata">;

type ReferralWalletSnapshotRedemption = Pick<typeof referralCreditRedemptionsTable.$inferSelect,
  "ledgerEntryId" | "amountRsd">;

/**
 * Redemption allocations are the authoritative consumption identities. The
 * matching `redeemed` ledger rows are wallet-display facts and are deliberately
 * not counted again here. Restorations and terminal source compensations remain
 * authoritative signed ledger facts. A source-linked expiry or reversal is a
 * terminal marker, so a later refund cannot revive that source.
 */
export function deriveReferralSourceCapacity(
  source: Pick<typeof referralCreditLedgerTable.$inferSelect, "amountRsd" | "expiresAt" | "effectiveAt">,
  sourceFacts: ReferralSourceFact[],
  redemptionAmountsRsd: number[],
  now = new Date(),
) {
  const effectiveFacts = sourceFacts.filter((fact) => fact.effectiveAt <= now);
  const redeemedRsd = redemptionAmountsRsd.reduce((sum, amount) => sum + Number(amount), 0);
  const restoredRsd = effectiveFacts.filter((fact) => fact.type === "restored")
    .reduce((sum, fact) => sum + Number(fact.amountRsd), 0);
  const terminalFacts = effectiveFacts.filter((fact) => fact.type === "expired" || fact.type === "reversed");
  const terminalAdjustmentRsd = terminalFacts
    .reduce((sum, fact) => sum + Number(fact.amountRsd), 0);
  const currentContributionRsd = source.amountRsd - redeemedRsd + restoredRsd + terminalAdjustmentRsd;
  const terminal = terminalFacts.length > 0 || !!(source.expiresAt && source.expiresAt <= now);
  return {
    redeemedRsd,
    restoredRsd,
    currentContributionRsd,
    consumedUnrestoredRsd: Math.max(0, redeemedRsd - restoredRsd),
    reusableCapacityRsd: terminal
      ? 0
      : Math.max(0, Math.min(source.amountRsd, currentContributionRsd)),
  };
}

export function deriveReferralCreditBalance(
  entries: Array<Pick<typeof referralCreditLedgerTable.$inferSelect, "type" | "amountRsd" | "expiresAt" | "effectiveAt">
    & { id?: string; metadata?: Record<string, unknown> }>,
  now = new Date(),
) {
  const base = entries.reduce((total, entry) => {
    if (entry.effectiveAt > now || entry.type === "held" || entry.metadata?.["reversedHeld"] === true) return total;
    return total + entry.amountRsd;
  }, 0);
  const adjustment = entries.reduce((total, source) => {
    if (source.type !== "available") return total;
    const linkedEntries = source.id ? entries.filter((entry) =>
      entry.effectiveAt <= now && entry.metadata?.["sourceLedgerEntryId"] === source.id) : [];
    const linked = linkedEntries.reduce((sum, entry) => sum + entry.amountRsd, 0);
    const uncappedCapacity = source.amountRsd + linked;
    const reusableCapacity = Math.max(0, Math.min(source.amountRsd, uncappedCapacity));
    // A malformed or replayed restoration must never inflate the wallet above
    // its source grant, even on display-only reads.
    const restorationOverage = Math.max(0, uncappedCapacity - source.amountRsd);
    const terminal = !!(source.expiresAt && source.expiresAt <= now)
      || linkedEntries.some((entry) => entry.type === "expired" || entry.type === "reversed");
    return total + restorationOverage + (terminal ? reusableCapacity : 0);
  }, 0);
  return base - adjustment;
}

/**
 * Derive one exact wallet scope from its complete append-only fact set.
 * Redemption rows provide consumption identity while linked ledger facts
 * provide restorations and terminality. Spendable capacity is walked in the
 * same FIFO order as checkout, so wallet debt reduces the sources that could
 * actually be allocated rather than leaking into another business wallet.
 */
export function deriveReferralWalletSnapshot(
  entries: ReferralWalletSnapshotEntry[],
  redemptions: ReferralWalletSnapshotRedemption[],
  now = new Date(),
  expiringWithinMs = 14 * 86400_000,
) {
  const availableRsd = deriveReferralCreditBalance(entries, now);
  let allocatableRemainingRsd = Math.max(0, availableRsd);
  let allocatableRsd = 0;
  let expiringSoonRsd = 0;
  const sourceFactsById = new Map<string, ReferralSourceFact[]>();
  for (const entry of entries) {
    const sourceId = entry.metadata?.["sourceLedgerEntryId"];
    if (typeof sourceId !== "string" || entry.effectiveAt > now
      || (entry.type !== "restored" && entry.type !== "expired" && entry.type !== "reversed")) continue;
    const facts = sourceFactsById.get(sourceId) ?? [];
    facts.push(entry);
    sourceFactsById.set(sourceId, facts);
  }
  const redemptionAmountsBySourceId = new Map<string, number[]>();
  for (const redemption of redemptions) {
    const amounts = redemptionAmountsBySourceId.get(redemption.ledgerEntryId) ?? [];
    amounts.push(Number(redemption.amountRsd));
    redemptionAmountsBySourceId.set(redemption.ledgerEntryId, amounts);
  }
  const sources = entries
    .filter((entry) => entry.type === "available" && entry.effectiveAt <= now)
    .sort((left, right) =>
      left.effectiveAt.getTime() - right.effectiveAt.getTime() || left.id.localeCompare(right.id));

  for (const source of sources) {
    if (!allocatableRemainingRsd) break;
    const capacityRsd = deriveReferralSourceCapacity(
      source,
      sourceFactsById.get(source.id) ?? [],
      redemptionAmountsBySourceId.get(source.id) ?? [],
      now,
    ).reusableCapacityRsd;
    const allocatedRsd = Math.min(allocatableRemainingRsd, capacityRsd);
    allocatableRemainingRsd -= allocatedRsd;
    allocatableRsd += allocatedRsd;
    if (source.expiresAt && source.expiresAt > now
      && source.expiresAt.getTime() - now.getTime() <= expiringWithinMs) {
      expiringSoonRsd += allocatedRsd;
    }
  }

  return { availableRsd, allocatableRsd, expiringSoonRsd };
}

const walletScopeCondition = (scope: ReferralWalletScope) => and(
  eq(referralCreditLedgerTable.ownerUserId, scope.ownerUserId),
  eq(referralCreditLedgerTable.walletKind, scope.walletKind),
  scope.salonId ? eq(referralCreditLedgerTable.salonId, scope.salonId) : isNull(referralCreditLedgerTable.salonId),
  scope.educationCenterId ? eq(referralCreditLedgerTable.educationCenterId, scope.educationCenterId) : isNull(referralCreditLedgerTable.educationCenterId),
);

/**
 * Read the append-only wallet facts as of `now`. Held facts are intentionally
 * not spendable. Expired positive grants are excluded even if the maintenance
 * worker has not written its compensating `expired` fact yet; all negative
 * facts (redemption, reversal and negative offset) always remain in the sum.
 */
export async function referralCreditBalanceInTx(tx: ReferralTransaction, scope: ReferralWalletScope, now = new Date()) {
  const entries = await tx.select().from(referralCreditLedgerTable)
    .where(and(walletScopeCondition(scope), lte(referralCreditLedgerTable.effectiveAt, now)))
    .orderBy(asc(referralCreditLedgerTable.effectiveAt), asc(referralCreditLedgerTable.id));
  return deriveReferralCreditBalance(entries, now);
}

/**
 * Serializes an exact wallet scope and deterministically allocates FIFO source
 * grants. Call this only inside the checkout transaction, after its cart lock.
 */
export async function allocateReferralCreditInTx(
  tx: ReferralTransaction,
  scope: ReferralWalletScope,
  desiredRsd: number,
  merchandiseSubtotalRsd: number,
  now = new Date(),
): Promise<{ availableRsd: number; appliedRsd: number; allocations: ReferralCreditAllocation[] }> {
  if (!Number.isSafeInteger(desiredRsd) || desiredRsd < 0) throw new Error("Invalid desired referral credit.");
  const scopeKey = `${scope.walletKind}:${scope.ownerUserId}:${scope.salonId ?? ""}:${scope.educationCenterId ?? ""}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`referral-wallet:${scopeKey}`}))`);
  // Lock all currently eligible facts in deterministic order. The advisory lock
  // also covers the empty-wallet case, which row locks alone cannot protect.
  const sources = await tx.select().from(referralCreditLedgerTable)
    .where(and(walletScopeCondition(scope), eq(referralCreditLedgerTable.type, "available"),
      lte(referralCreditLedgerTable.effectiveAt, now)))
    .orderBy(asc(referralCreditLedgerTable.effectiveAt), asc(referralCreditLedgerTable.id))
    .for("update");
  const availableRsd = await referralCreditBalanceInTx(tx, scope, now);
  let remaining = Math.max(0, Math.min(desiredRsd, merchandiseSubtotalRsd, availableRsd));
  if (!remaining) return { availableRsd, appliedRsd: 0, allocations: [] };
  const sourceIds = sources.map((source) => source.id);
  const redemptionRows = sourceIds.length ? await tx.select({
    id: referralCreditRedemptionsTable.id,
    ledgerEntryId: referralCreditRedemptionsTable.ledgerEntryId,
    amount: referralCreditRedemptionsTable.amountRsd,
  }).from(referralCreditRedemptionsTable).where(inArray(referralCreditRedemptionsTable.ledgerEntryId, sourceIds))
    .orderBy(asc(referralCreditRedemptionsTable.ledgerEntryId), asc(referralCreditRedemptionsTable.id))
    .for("update") : [];
  const sourceFacts = sourceIds.length ? await tx.select({
    id: referralCreditLedgerTable.id,
    ledgerEntryId: sql<string>`${referralCreditLedgerTable.metadata}->>'sourceLedgerEntryId'`,
    type: referralCreditLedgerTable.type,
    amountRsd: referralCreditLedgerTable.amountRsd,
    effectiveAt: referralCreditLedgerTable.effectiveAt,
  }).from(referralCreditLedgerTable).where(and(
    walletScopeCondition(scope),
    inArray(referralCreditLedgerTable.type, ["restored", "expired", "reversed"]),
    lte(referralCreditLedgerTable.effectiveAt, now),
    inArray(sql<string>`${referralCreditLedgerTable.metadata}->>'sourceLedgerEntryId'`, sourceIds),
  )).orderBy(
    asc(sql`${referralCreditLedgerTable.metadata}->>'sourceLedgerEntryId'`),
    asc(referralCreditLedgerTable.effectiveAt),
    asc(referralCreditLedgerTable.id),
  ).for("update") : [];
  const allocations: ReferralCreditAllocation[] = [];
  for (const source of sources) {
    const remainingOnSource = deriveReferralSourceCapacity(
      source,
      sourceFacts.filter((fact) => fact.ledgerEntryId === source.id),
      redemptionRows.filter((row) => row.ledgerEntryId === source.id).map((row) => Number(row.amount)),
      now,
    ).reusableCapacityRsd;
    const amountRsd = Math.min(remaining, remainingOnSource);
    if (amountRsd) allocations.push({ ledgerEntryId: source.id, amountRsd });
    remaining -= amountRsd;
    if (!remaining) break;
  }
  const appliedRsd = allocations.reduce((sum, allocation) => sum + allocation.amountRsd, 0);
  return { availableRsd, appliedRsd, allocations };
}

export async function recordReferralRedemptionInTx(
  tx: ReferralTransaction,
  input: { scope: ReferralWalletScope; orderId?: string; retailOrderId?: string; allocations: ReferralCreditAllocation[]; idempotencyKey: string; actorUserId?: string | null; now?: Date },
) {
  const now = input.now ?? new Date();
  const scopeKey = `${input.scope.walletKind}:${input.scope.ownerUserId}:${input.scope.salonId ?? ""}:${input.scope.educationCenterId ?? ""}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`referral-wallet:${scopeKey}`}))`);
  for (const allocation of input.allocations) {
    const allocationKey = referralIdempotencyKey("redemption-allocation", input.idempotencyKey, allocation.ledgerEntryId);
    await tx.insert(referralCreditRedemptionsTable).values({
      ledgerEntryId: allocation.ledgerEntryId, orderId: input.orderId ?? null, retailOrderId: input.retailOrderId ?? null,
      amountRsd: allocation.amountRsd, idempotencyKey: allocationKey,
    }).onConflictDoNothing();
    await tx.insert(referralCreditLedgerTable).values({
      ...input.scope, type: "redeemed", amountRsd: -allocation.amountRsd, effectiveAt: now,
      actorUserId: input.actorUserId ?? null, reason: "Referral credit redeemed at checkout.",
      idempotencyKey: referralIdempotencyKey("redeemed", input.idempotencyKey, allocation.ledgerEntryId),
      metadata: { sourceLedgerEntryId: allocation.ledgerEntryId, orderId: input.orderId ?? null, retailOrderId: input.retailOrderId ?? null },
    }).onConflictDoNothing();
  }
}

/** Appends compensating restoration facts; callers lock and mark the order first. */
export async function restoreReferralCreditForOrderInTx(
  tx: ReferralTransaction,
  input: { scope: ReferralWalletScope; orderId?: string; retailOrderId?: string; eventKey: string; actorUserId?: string | null; now?: Date },
) {
  const scopeKey = `${input.scope.walletKind}:${input.scope.ownerUserId}:${input.scope.salonId ?? ""}:${input.scope.educationCenterId ?? ""}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`referral-wallet:${scopeKey}`}))`);
  const rows = await tx.select({
    redemptionId: referralCreditRedemptionsTable.id,
    ledgerEntryId: referralCreditRedemptionsTable.ledgerEntryId,
    amount: referralCreditRedemptionsTable.amountRsd,
  }).from(referralCreditRedemptionsTable).where(input.orderId
    ? eq(referralCreditRedemptionsTable.orderId, input.orderId)
    : eq(referralCreditRedemptionsTable.retailOrderId, input.retailOrderId!));
  const now = input.now ?? new Date();
  for (const row of rows) {
    await tx.insert(referralCreditLedgerTable).values({
      ...input.scope, type: "restored", amountRsd: Number(row.amount), effectiveAt: now,
      actorUserId: input.actorUserId ?? null, reason: "Referral credit restored after order cancellation or refund.",
      // A redemption allocation can be restored exactly once, irrespective of
      // how many cancellation/refund event names reach this service.
      idempotencyKey: referralIdempotencyKey("restored-redemption", row.redemptionId),
      metadata: { sourceLedgerEntryId: row.ledgerEntryId, redemptionId: row.redemptionId,
        orderId: input.orderId ?? null, retailOrderId: input.retailOrderId ?? null },
    }).onConflictDoNothing();
  }
}

/**
 * Neutralizes every reward source produced by one referral while preserving
 * only consumed value that has not subsequently been restored.
 *
 * Lock order for lifecycle callers is qualification -> wallet advisory lock ->
 * source ledger rows (effectiveAt/id order) -> redemption/source-fact rows.
 * Checkout and restore take their order/cart lock before the same wallet lock,
 * and expiry never waits on a lifecycle row, so all competing source mutation
 * serializes at or below the wallet lock without forming a lock cycle.
 */
export async function compensateInvalidatedReferralSourcesInTx(
  tx: ReferralTransaction,
  input: {
    attributionId: string;
    scope: ReferralWalletScope;
    now: Date;
    reason: string;
    actorUserId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const scopeKey = `${input.scope.walletKind}:${input.scope.ownerUserId}:${input.scope.salonId ?? ""}:${input.scope.educationCenterId ?? ""}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`referral-wallet:${scopeKey}`}))`);
  const ledger = await tx.select().from(referralCreditLedgerTable)
    .where(eq(referralCreditLedgerTable.referralAttributionId, input.attributionId))
    .orderBy(asc(referralCreditLedgerTable.effectiveAt), asc(referralCreditLedgerTable.id))
    .for("update");
  const availableSources = ledger.filter((entry) => entry.type === "available");
  const heldAmount = ledger.filter((entry) => entry.type === "held")
    .reduce((sum, entry) => sum + entry.amountRsd, 0);
  const reversedHeldAmount = ledger.filter((entry) => entry.type === "reversed"
    && entry.metadata?.["reversedHeld"] === true)
    .reduce((sum, entry) => sum + entry.amountRsd, 0);
  const remainingHeld = Math.max(0, heldAmount + reversedHeldAmount);
  const producedReward = heldAmount > 0 || availableSources.length > 0;
  if (!availableSources.length && remainingHeld > 0) {
    await tx.insert(referralCreditLedgerTable).values({
      ...input.scope,
      referralAttributionId: input.attributionId,
      type: "reversed",
      amountRsd: -remainingHeld,
      effectiveAt: input.now,
      actorUserId: input.actorUserId ?? null,
      reason: input.reason,
      idempotencyKey: referralIdempotencyKey("source-compensation-held", input.attributionId),
      metadata: {
        ...input.metadata,
        sourceLedgerEntryId: null,
        reversedHeld: true,
      },
    }).onConflictDoNothing();
  }
  for (const source of availableSources) {
    const redemptionRows = await tx.select({
      id: referralCreditRedemptionsTable.id,
      amount: referralCreditRedemptionsTable.amountRsd,
    })
      .from(referralCreditRedemptionsTable)
      .where(eq(referralCreditRedemptionsTable.ledgerEntryId, source.id))
      .orderBy(asc(referralCreditRedemptionsTable.id))
      .for("update");
    const sourceFacts = await tx.select({
      id: referralCreditLedgerTable.id,
      type: referralCreditLedgerTable.type,
      amountRsd: referralCreditLedgerTable.amountRsd,
      effectiveAt: referralCreditLedgerTable.effectiveAt,
    }).from(referralCreditLedgerTable).where(and(
      inArray(referralCreditLedgerTable.type, ["restored", "expired", "reversed"]),
      sql`${referralCreditLedgerTable.metadata}->>'sourceLedgerEntryId' = ${source.id}`,
      lte(referralCreditLedgerTable.effectiveAt, input.now),
    )).orderBy(asc(referralCreditLedgerTable.effectiveAt), asc(referralCreditLedgerTable.id))
      .for("update");
    const sourceState = deriveReferralSourceCapacity(
      source,
      sourceFacts,
      redemptionRows.map((row) => Number(row.amount)),
      input.now,
    );
    const currentContribution = sourceState.currentContributionRsd;
    const targetContribution = -sourceState.consumedUnrestoredRsd;
    // A replay observes the prior append in sourceFacts and therefore computes
    // zero. Expiry facts likewise remove unused capacity without creating debt.
    const additionalCompensation = Math.min(0, targetContribution - currentContribution);
    if (!additionalCompensation) continue;
    await tx.insert(referralCreditLedgerTable).values({
      ...input.scope,
      referralAttributionId: input.attributionId,
      type: "reversed",
      amountRsd: additionalCompensation,
      effectiveAt: input.now,
      actorUserId: input.actorUserId ?? null,
      reason: input.reason,
      idempotencyKey: referralIdempotencyKey("source-compensation", input.attributionId, source.id),
      metadata: {
        ...input.metadata,
        sourceLedgerEntryId: source.id,
        reversedHeld: false,
        sourceContributionBeforeRsd: currentContribution,
        targetInvalidatedContributionRsd: targetContribution,
      },
    }).onConflictDoNothing();
  }
  return { producedReward };
}

export function normalizedReferralCode(value: string): string {
  // base64url-backed stable codes can contain "_"; preserving it is required
  // so a server-issued code always round-trips through registration.
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

/**
 * Codes deliberately have no sequence or user data in them. The deterministic
 * digest gives a source the same code on retries while the database uniqueness
 * constraint remains the final collision guard.
 */
export function stableReferralCode(channel: ReferralChannel, sourceId: string): string {
  const digest = createHash("sha256").update(`lumera-referral-v1\u001f${channel}\u001f${sourceId}`)
    .digest("base64url").slice(0, 10).toUpperCase();
  return `${channel}-${digest}`;
}

export function referralLink(origin: string, code: string, channel: ReferralChannel = "B2"): string {
  const fallback = process.env["APP_BASE_URL"] || "http://localhost";
  let base: URL;
  try { base = new URL(process.env["APP_BASE_URL"] || origin); } catch { base = new URL(fallback); }
  // Request origin is used only when it is an http(s) origin. This supports
  // custom deployment domains without persisting an environment-specific link.
  if (!/^https?:$/.test(base.protocol)) base = new URL(fallback);
  base.pathname = channel === "A" || channel === "B1" ? "/poslovna-registracija"
    : channel === "C" ? "/student/prijava" : "/prijava";
  base.search = "";
  base.searchParams.set("ref", normalizedReferralCode(code));
  return base.toString();
}

export class LegalEntityOwnerConflictError extends Error {
  readonly code = "LEGAL_ENTITY_OWNER_CONFLICT";
  constructor(readonly normalizedPib: string, readonly existingOwnerUserIds: string[]) {
    super("PIB je već povezan sa drugim poslovnim nalogom. Aktivacija zahteva administratorsku proveru.");
  }
}

/**
 * A referral code is not a generic signup coupon.  Keeping the registration
 * surface explicit prevents a code captured from one flow being attached by a
 * different flow before the database's one-attribution constraint can help.
 */
export class ReferralChannelContextError extends Error {
  readonly code = "REFERRAL_CHANNEL_CONTEXT_INVALID";
  constructor() {
    super("Kod preporuke nije važeći za ovaj tip registracije.");
  }
}

export type ReferralRegistrationContext =
  | "customer"
  | "oauth_customer"
  | "jobseeker"
  | "student"
  | "business_salon"
  | "business_education"
  | "oauth_business_salon"
  | "oauth_business_education";

function referralChannelMatchesRegistration(
  channel: ReferralChannel,
  context: ReferralRegistrationContext,
  referredSalonId?: string | null,
  referredEducationCenterId?: string | null,
) {
  const hasSalon = Boolean(referredSalonId);
  const hasCenter = Boolean(referredEducationCenterId);
  if (hasSalon && hasCenter) return false;
  if (context === "business_salon" || context === "oauth_business_salon") {
    return (channel === "A" || channel === "B1") && hasSalon;
  }
  if (context === "business_education" || context === "oauth_business_education") {
    return (channel === "A" || channel === "B1") && hasCenter;
  }
  if (context === "customer" || context === "oauth_customer") {
    return (channel === "B2" || channel === "D") && !hasSalon && !hasCenter;
  }
  if (context === "student") return channel === "C" && !hasSalon && !hasCenter;
  // Jobseekers may be referrers for B1/B2, but there is no agreed referred-
  // jobseeker channel. Never silently treat this as a customer registration.
  return false;
}

/** Lock, globally upsert, and bind a PIB to one of the owner's businesses. */
export async function bindLegalEntityBusinessInTx(
  tx: ReferralTransaction,
  input: { pib: string; legalName?: string | null; ownerUserId: string; salonId?: string | null; educationCenterId?: string | null },
) {
  const normalizedPib = normalizePib(input.pib);
  if (Number(Boolean(input.salonId)) + Number(Boolean(input.educationCenterId)) !== 1) {
    throw new Error("Exactly one legal-entity business must be supplied.");
  }
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`legal-entity-pib:${normalizedPib}`}))`);
  const [existingEntity] = await tx.select().from(legalEntitiesTable)
    .where(eq(legalEntitiesTable.normalizedPib, normalizedPib)).for("update").limit(1);
  const legalEntity = existingEntity ?? (await tx.insert(legalEntitiesTable).values({
    normalizedPib, legalName: input.legalName?.trim() || null,
  }).returning())[0]!;
  const owners = await tx.select({ ownerUserId: legalEntityBusinessesTable.ownerUserId })
    .from(legalEntityBusinessesTable).where(eq(legalEntityBusinessesTable.legalEntityId, legalEntity.id));
  const conflictingOwners = [...new Set(owners.map((row) => row.ownerUserId).filter((id) => id !== input.ownerUserId))].sort();
  if (conflictingOwners.length) throw new LegalEntityOwnerConflictError(normalizedPib, conflictingOwners);
  const businessCondition = input.salonId
    ? eq(legalEntityBusinessesTable.salonId, input.salonId)
    : eq(legalEntityBusinessesTable.educationCenterId, input.educationCenterId!);
  const [existingBinding] = await tx.select().from(legalEntityBusinessesTable).where(businessCondition).for("update").limit(1);
  if (existingBinding && existingBinding.ownerUserId !== input.ownerUserId) {
    throw new LegalEntityOwnerConflictError(normalizedPib, [existingBinding.ownerUserId]);
  }
  if (existingBinding) {
    await tx.update(legalEntityBusinessesTable).set({ legalEntityId: legalEntity.id }).where(eq(legalEntityBusinessesTable.id, existingBinding.id));
  } else {
    await tx.insert(legalEntityBusinessesTable).values({
      legalEntityId: legalEntity.id, ownerUserId: input.ownerUserId,
      salonId: input.salonId ?? null, educationCenterId: input.educationCenterId ?? null,
    });
  }
  return { legalEntityId: legalEntity.id, normalizedPib, outcome: existingEntity ? "same_owner_reuse" as const : "created" as const };
}

export const REFERRAL_TERMS_SR: Record<ReferralChannel, string> = {
  A: "Preporuka poslovnog partnera (A): salon ili edukativni centar može preporučiti novi biznis. Od administrativne verifikacije do isteka fiksnog roka od tri kalendarska meseca moraju biti završena četiri termina u salonu, odnosno četiri potvrđene ili završene prijave za edukaciju; događaj u trenutku isteka roka se ne računa. Nagrada od 500 RSD je na čekanju 14 dana, zatim je dostupna šest meseci samo za poslovne kupovine. Svaka deseta kvalifikovana preporuka salona donosi 20% popusta na pretplatu u narednom mesečnom obračunskom ciklusu; više ostvarenih pogodnosti se koristi redom, po jedna u svakom sledećem ciklusu i ne sabiraju se. Za edukativni centar ostaje pogodnost od 12% provizije za naredni jednomesečni obračunski period. Samopreporuke, preklapanje PIB-a ili kontakta i zloupotrebe se odbijaju ili šalju na proveru.",
  B1: "Preporuka biznisa (B1): korisnik ili kandidat za posao može preporučiti novi salon ili edukativni centar. Od administrativne verifikacije do isteka fiksnog roka od tri kalendarska meseca potrebna su četiri završena termina, odnosno četiri potvrđene ili završene prijave za edukaciju; događaj u trenutku isteka roka se ne računa. Nagrada je 500 RSD kredita za kupovinu kao fizičko lice i dostupna je odmah po kvalifikaciji. Nema milestone pogodnosti.",
  B2: "Preporuka novog korisnika (B2): novi korisnik mora potvrditi broj telefona i završiti tri termina od registracije do isteka fiksnog roka od 60 dana; događaj u trenutku isteka roka se ne računa. Nagrada je 100 RSD, dostupna nakon 14 dana i važi šest meseci za B2C kupovine. Najviše 20 nagrada može biti ostvareno po preporučiocu u jednom kalendarskom mesecu. B2 se ne kombinuje sa D preporukom za istu osobu.",
  C: "Studentska preporuka (C): edukativni centar preporučuje novog polaznika. Potrebne su četiri potvrđene ili završene prijave od registracije do isteka fiksnog roka od tri kalendarska meseca; događaj u trenutku isteka roka se ne računa. Nagrada je 500 RSD poslovnog kredita nakon čekanja od 14 dana, sa rokom korišćenja od šest meseci. Svaka deseta kvalifikovana preporuka aktivira pogodnost od 12% provizije za naredni obračunski period.",
  D: "Preporuka postojećeg klijenta (D): salon preporučuje novog korisnika koji mora potvrditi broj telefona i završiti jedan termin od registracije do isteka fiksnog roka od 60 dana; događaj u trenutku isteka roka se ne računa. Nagrada od 100 RSD poslovnog kredita dostupna je nakon 30 dana i važi šest meseci. Salon može ostvariti najviše 15 nagrada u kalendarskoj nedelji. D se ne kombinuje sa B2 preporukom za istu osobu.",
};

export async function validateReferralCode(codeInput: string) {
  const code = normalizedReferralCode(codeInput);
  if (!code || code.length > 64) return null;
  const [row] = await db.select({
    code: referralCodesTable.code,
    channel: referralCodesTable.channel,
    active: referralCodesTable.active,
  }).from(referralCodesTable).where(and(eq(referralCodesTable.code, code), eq(referralCodesTable.active, true))).limit(1);
  return row ? { code: row.code, channel: row.channel as ReferralChannel, valid: true } : null;
}

export async function ensureReferralCode(
  tx: ReferralTransaction,
  input: { channel: ReferralChannel; referrerUserId: string; sourceBusiness?: ReferralSourceBusiness; sourceBusinessId?: string },
) {
  const isBusiness = input.sourceBusiness != null;
  if ((input.channel === "A" || input.channel === "C" || input.channel === "D") !== isBusiness) {
    throw new Error("Referral channel and source business do not match.");
  }
  if (input.channel === "C" && input.sourceBusiness !== "education_center") throw new Error("Channel C requires an education center.");
  if (input.channel === "D" && input.sourceBusiness !== "salon") throw new Error("Channel D requires a salon.");
  const sourceId = input.sourceBusinessId ?? input.referrerUserId;
  const sourceCondition = input.sourceBusiness === "salon"
    ? and(eq(referralCodesTable.referrerSalonId, sourceId), eq(referralCodesTable.channel, input.channel))
    : input.sourceBusiness === "education_center"
      ? and(eq(referralCodesTable.referrerEducationCenterId, sourceId), eq(referralCodesTable.channel, input.channel))
      : and(eq(referralCodesTable.referrerUserId, input.referrerUserId), eq(referralCodesTable.channel, input.channel),
        isNull(referralCodesTable.referrerSalonId), isNull(referralCodesTable.referrerEducationCenterId));
  const [existing] = await tx.select().from(referralCodesTable).where(sourceCondition).limit(1);
  if (existing) return existing;
  const code = stableReferralCode(input.channel, `${input.sourceBusiness ?? "account"}:${sourceId}`);
  const values = {
    code, channel: input.channel, referrerUserId: input.referrerUserId,
    referrerSalonId: input.sourceBusiness === "salon" ? sourceId : null,
    referrerEducationCenterId: input.sourceBusiness === "education_center" ? sourceId : null,
  };
  await tx.insert(referralCodesTable).values(values).onConflictDoNothing();
  const [saved] = await tx.select().from(referralCodesTable).where(sourceCondition).limit(1);
  if (!saved) throw new Error("Referral code could not be created.");
  return saved;
}

/** Captures a registration code exactly once, in the caller's signup transaction. */
export async function captureReferralAttributionInTx(
  tx: ReferralTransaction,
  input: {
    referralCode?: string | null;
    referredUserId: string;
    referredSalonId?: string | null;
    referredEducationCenterId?: string | null;
    phoneNormalized?: string | null;
    registrationContext: ReferralRegistrationContext;
    now?: Date;
  },
) {
  const raw = input.referralCode ? normalizedReferralCode(input.referralCode) : "";
  if (!raw) return null;
  const now = input.now ?? new Date();
  const [code] = await tx.select().from(referralCodesTable)
    .where(and(eq(referralCodesTable.code, raw), eq(referralCodesTable.active, true))).limit(1);
  if (!code || code.referrerUserId === input.referredUserId) return null;
  if (!referralChannelMatchesRegistration(
    code.channel as ReferralChannel,
    input.registrationContext,
    input.referredSalonId,
    input.referredEducationCenterId,
  )) throw new ReferralChannelContextError();
  const [referrer] = await tx.select({
    phoneNormalized: usersTable.phoneNormalized,
    email: usersTable.email,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
  })
    .from(usersTable).where(eq(usersTable.id, code.referrerUserId)).limit(1);
  const referredBusinessCondition = input.referredSalonId
    ? eq(legalEntityBusinessesTable.salonId, input.referredSalonId)
    : input.referredEducationCenterId ? eq(legalEntityBusinessesTable.educationCenterId, input.referredEducationCenterId) : null;
  const [referredLegal] = referredBusinessCondition
    ? await tx.select({ legalEntityId: legalEntityBusinessesTable.legalEntityId }).from(legalEntityBusinessesTable).where(referredBusinessCondition).limit(1)
    : [];
  const referrerLegal = await tx.select({ legalEntityId: legalEntityBusinessesTable.legalEntityId })
    .from(legalEntityBusinessesTable).where(eq(legalEntityBusinessesTable.ownerUserId, code.referrerUserId));
  const phoneOverlap = Boolean(input.phoneNormalized && referrer?.phoneNormalized === input.phoneNormalized);
  const legalOverlap = Boolean(referredLegal && referrerLegal.some((row) => row.legalEntityId === referredLegal.legalEntityId));
  const overlap = phoneOverlap || legalOverlap;
  const status = overlap ? "under_review" : "attributed";
  const attributionKey = referralIdempotencyKey("attribution", input.referredUserId);
  const [attribution] = await tx.insert(referralAttributionsTable).values({
    referralCodeId: code.id, channel: code.channel, referrerUserId: code.referrerUserId,
    referredUserId: input.referredUserId, referredSalonId: input.referredSalonId ?? null,
    referredEducationCenterId: input.referredEducationCenterId ?? null, status,
    lockedUntil: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    rejectionReason: phoneOverlap ? "normalized_phone_overlap" : legalOverlap ? "legal_entity_overlap" : null, idempotencyKey: attributionKey,
  }).onConflictDoNothing().returning();
  if (!attribution) return null;
  const policy = REFERRAL_POLICY[code.channel as ReferralChannel];
  await tx.insert(referralQualificationsTable).values({
    attributionId: attribution.id, referredSalonId: input.referredSalonId ?? null,
    referredEducationCenterId: input.referredEducationCenterId ?? null,
    status: ["A", "B1"].includes(code.channel) ? "pending_verification" : "tracking",
    requiredEvidenceCount: policy.requiredEvidence,
  }).onConflictDoNothing();
  if (overlap) {
    await tx.insert(referralReviewsTable).values({
      attributionId: attribution.id, status: "open", reasonCode: phoneOverlap ? "normalized_phone_overlap" : "legal_entity_overlap",
      detail: phoneOverlap ? "Referral phone overlaps the referrer phone." : "Referral business shares the referrer's legal entity.", score: 50,
    });
  }
  if (!overlap) await enqueueTransactionalEmail(tx, {
    eventKey: `referral-signup-attributed:${attribution.id}`,
    emailType: "referral_signup_attributed",
    to: { email: referrer!.email, name: `${referrer!.firstName} ${referrer!.lastName}` },
    subject: "LUMERA — evidentirana je nova preporuka",
    htmlContent: lumeraEmailHtml("Nova preporuka je evidentirana",
      `<p>Registracija preko vašeg koda za kanal ${code.channel} je uspešno evidentirana. Nagradu ćemo obračunati kada budu ispunjeni uslovi programa.</p>`),
    metadata: { referralAttributionId: attribution.id, channel: code.channel },
  }, now);
  if (!overlap) await enqueueReferralSmsInTx(tx, {
    eventKey: `referral-signup-attributed:${attribution.id}`,
    userId: code.referrerUserId,
    salonId: code.referrerSalonId,
    text: `LUMERA: nova registracija preko vašeg koda za kanal ${code.channel} je evidentirana. Nagradu obračunavamo kada budu ispunjeni uslovi.`,
  });
  return attribution;
}

type AppointmentReferralTransition = {
  appointmentId: string; customerId: string; salonId: string; occurredAt: Date; valid: boolean; reason?: string;
};
type EnrollmentReferralTransition = {
  enrollmentId: string; studentUserId: string; centerId: string; occurredAt: Date; valid: boolean; reason?: string;
};

function calendarPeriodStart(period: "calendar_month" | "calendar_week", now: Date) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "calendar_month") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const weekday = (date.getUTCDay() + 6) % 7; // ISO Monday
  date.setUTCDate(date.getUTCDate() - weekday);
  return date;
}

function oneUtcMonthAfter(start: Date) {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    month,
    Math.min(start.getUTCDate(), lastDay),
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds(),
    start.getUTCMilliseconds(),
  ));
}

async function durablePhoneProof(tx: ReferralTransaction, userId: string) {
  const [proof] = await tx.select({ id: phoneVerificationProofsTable.id }).from(phoneVerificationProofsTable)
    .where(and(eq(phoneVerificationProofsTable.userId, userId), isNull(phoneVerificationProofsTable.revokedAt)))
    .limit(1);
  return Boolean(proof);
}

/**
 * This is deliberately called in the transaction that changes an authoritative
 * appointment/enrollment state. It never trusts a dashboard status or worker.
 */
async function recordReferralEvidenceInTx(
  tx: ReferralTransaction,
  input: (AppointmentReferralTransition & { kind: "appointment" }) | (EnrollmentReferralTransition & { kind: "enrollment" }),
) {
  const [attribution] = await tx.select({
    attribution: referralAttributionsTable, qualification: referralQualificationsTable, code: referralCodesTable,
  }).from(referralAttributionsTable)
    .innerJoin(referralQualificationsTable, eq(referralQualificationsTable.attributionId, referralAttributionsTable.id))
    .innerJoin(referralCodesTable, eq(referralAttributionsTable.referralCodeId, referralCodesTable.id))
    .where(and(eq(referralAttributionsTable.referredUserId, input.kind === "appointment" ? input.customerId : input.studentUserId),
      eq(referralAttributionsTable.status, "attributed")))
    // Lock only the mutable qualification. Locking every joined row also locked
    // the shared referral-code row, needlessly serializing all referrals from a
    // source before contenders could reach the narrower cap/milestone locks.
    .for("update", { of: referralQualificationsTable }).limit(1);
  if (!attribution) return { matched: false, qualified: false };
  const channel = attribution.attribution.channel as ReferralChannel;
  const qualification = attribution.qualification;
  if (qualification.status === "rejected" || qualification.status === "reversed") {
    return { matched: true, qualified: false };
  }
  const targetMatches = input.kind === "appointment"
    ? (channel === "A" || channel === "B1" ? qualification.referredSalonId === input.salonId
      : channel === "D" ? attribution.code.referrerSalonId === input.salonId : channel === "B2")
    : (channel === "A" || channel === "B1" ? qualification.referredEducationCenterId === input.centerId
      : channel === "C" ? attribution.code.referrerEducationCenterId === input.centerId : false);
  if (!targetMatches) return { matched: false, qualified: false };
  if (input.valid && qualification.status === "pending_verification") {
    return { matched: true, qualified: false };
  }
  if (!input.valid && (channel === "A" || channel === "B1") && !qualification.trackingStartedAt) {
    return { matched: true, qualified: false };
  }
  // Fixed half-open policy window: start is inclusive and deadline exclusive.
  // C intentionally has no separate tracking start in the schema, so it starts
  // at capturedAt; A/B1 use the first persisted admin approval.
  const window = qualificationWindow(channel, attribution.attribution.capturedAt, qualification.trackingStartedAt);
  if (input.valid && (input.occurredAt < window.start || input.occurredAt >= window.deadline)) {
    return { matched: true, qualified: false };
  }
  if (input.valid && (channel === "B2" || channel === "D") && !await durablePhoneProof(tx, attribution.attribution.referredUserId)) {
    await tx.insert(referralReviewsTable).values({ attributionId: attribution.attribution.id, qualificationId: qualification.id,
      reasonCode: "missing_durable_phone_proof", detail: "Qualification event arrived without a durable SMS phone proof.", score: 40 });
    return { matched: true, qualified: false };
  }
  const evidenceKey = referralIdempotencyKey(input.valid ? "evidence" : "evidence-invalid", qualification.id, input.kind === "appointment" ? input.appointmentId : input.enrollmentId);
  if (input.valid) {
    await tx.insert(referralQualificationEvidenceTable).values({
      qualificationId: qualification.id, appointmentId: input.kind === "appointment" ? input.appointmentId : null,
      enrollmentId: input.kind === "enrollment" ? input.enrollmentId : null, eligibleAt: input.occurredAt, idempotencyKey: evidenceKey,
    }).onConflictDoNothing();
  } else {
    await tx.update(referralQualificationEvidenceTable).set({ invalidatedAt: input.occurredAt, invalidationReason: input.reason ?? "source_invalidated" })
      .where(input.kind === "appointment"
        ? and(eq(referralQualificationEvidenceTable.qualificationId, qualification.id), eq(referralQualificationEvidenceTable.appointmentId, input.appointmentId), isNull(referralQualificationEvidenceTable.invalidatedAt))
        : and(eq(referralQualificationEvidenceTable.qualificationId, qualification.id), eq(referralQualificationEvidenceTable.enrollmentId, input.enrollmentId), isNull(referralQualificationEvidenceTable.invalidatedAt)));
  }
  const evidence = await tx.select({ eligibleAt: referralQualificationEvidenceTable.eligibleAt }).from(referralQualificationEvidenceTable)
    .where(and(eq(referralQualificationEvidenceTable.qualificationId, qualification.id), isNull(referralQualificationEvidenceTable.invalidatedAt)));
  const validCount = evidence.filter((item) =>
    item.eligibleAt >= window.start && item.eligibleAt < window.deadline).length;
  if (!qualificationSatisfied(channel, validCount)) {
    if (["qualified", "held", "available"].includes(qualification.status)) {
      const policy = REFERRAL_POLICY[channel];
      await compensateInvalidatedReferralSourcesInTx(tx, {
        attributionId: attribution.attribution.id,
        scope: {
          walletKind: policy.wallet,
          ownerUserId: attribution.attribution.referrerUserId,
          salonId: policy.wallet === "B2B" ? attribution.code.referrerSalonId : null,
          educationCenterId: policy.wallet === "B2B" ? attribution.code.referrerEducationCenterId : null,
        },
        now: input.occurredAt,
        reason: "Qualification evidence was cancelled or refunded.",
        metadata: {
          evidenceKind: input.kind,
          evidenceSourceId: input.kind === "appointment" ? input.appointmentId : input.enrollmentId,
        },
      });
      await tx.update(referralQualificationsTable).set({ status: "reversed", reversedAt: input.occurredAt, updatedAt: input.occurredAt })
        .where(eq(referralQualificationsTable.id, qualification.id));
    }
    return { matched: true, qualified: false };
  }
  if (["qualified", "held", "available"].includes(qualification.status)) return { matched: true, qualified: true };
  const policy = REFERRAL_POLICY[channel];
  if (policy.cap) {
    const periodStart = calendarPeriodStart(policy.cap.period, input.occurredAt);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`referral-cap:${attribution.attribution.referrerUserId}:${channel}:${periodStart.toISOString()}`}))`);
    const issued = await tx.select({ count: sql<number>`count(*)::int` }).from(referralCreditLedgerTable)
      .innerJoin(referralAttributionsTable, eq(referralCreditLedgerTable.referralAttributionId, referralAttributionsTable.id))
      .where(and(eq(referralAttributionsTable.referrerUserId, attribution.attribution.referrerUserId), eq(referralAttributionsTable.channel, channel),
        eq(referralCreditLedgerTable.type, "held"), gte(referralCreditLedgerTable.effectiveAt, periodStart)));
    if (!canEarnUnderCap(channel, Number(issued[0]?.count ?? 0))) {
      await tx.insert(referralReviewsTable).values({ attributionId: attribution.attribution.id, qualificationId: qualification.id,
        reasonCode: "earning_cap_reached", detail: `Referral ${channel} earning cap reached.`, score: 70 });
      return { matched: true, qualified: false };
    }
    if (Number(issued[0]?.count ?? 0) >= policy.cap.amount - 2) await tx.insert(referralReviewsTable).values({
      attributionId: attribution.attribution.id, qualificationId: qualification.id, reasonCode: "cap_adjacent_activity", detail: "Qualification is adjacent to the hard earning cap.", score: 35,
    });
  }
  const holdUntil = qualificationHoldUntil(channel, input.occurredAt);
  const type = holdUntil ? "held" as const : "available" as const;
  await tx.insert(referralCreditLedgerTable).values({
    walletKind: policy.wallet, ownerUserId: attribution.attribution.referrerUserId,
    salonId: policy.wallet === "B2B" ? attribution.code.referrerSalonId : null,
    educationCenterId: policy.wallet === "B2B" ? attribution.code.referrerEducationCenterId : null,
    referralAttributionId: attribution.attribution.id, type, amountRsd: policy.rewardAmountRsd, effectiveAt: input.occurredAt,
    expiresAt: holdUntil ? null : creditExpiry(input.occurredAt), reason: "Referral qualification threshold reached.",
    idempotencyKey: referralIdempotencyKey(type, attribution.attribution.id),
  }).onConflictDoNothing();
  await tx.update(referralQualificationsTable).set({
    status: holdUntil ? "held" : "available", qualifiedAt: input.occurredAt, holdUntil, availableAt: holdUntil ? null : input.occurredAt, updatedAt: input.occurredAt,
  }).where(eq(referralQualificationsTable.id, qualification.id));
  if (type === "available") {
    const [recipient] = await tx.select().from(usersTable)
      .where(eq(usersTable.id, attribution.attribution.referrerUserId)).limit(1);
    if (recipient) await enqueueTransactionalEmail(tx, {
      eventKey: `referral-credit-available:${attribution.attribution.id}`,
      emailType: "referral_credit_available",
      to: { email: recipient.email, name: `${recipient.firstName} ${recipient.lastName}` },
      subject: "LUMERA — kredit preporuke je dostupan",
      htmlContent: lumeraEmailHtml("Kredit preporuke je dostupan",
        `<p>Vaš kredit od ${policy.rewardAmountRsd} RSD je sada dostupan i važi šest meseci.</p>`),
      metadata: { referralAttributionId: attribution.attribution.id, amountRsd: policy.rewardAmountRsd },
    }, input.occurredAt);
    await enqueueReferralSmsInTx(tx, {
      eventKey: `referral-credit-available:${attribution.attribution.id}`,
      userId: attribution.attribution.referrerUserId,
      salonId: attribution.code.referrerSalonId,
      text: `LUMERA: kredit preporuke od ${policy.rewardAmountRsd} RSD je dostupan i važi šest meseci.`,
    });
  }
  // A and C counters are source-business scoped. Lock that scope before counting
  // so two simultaneous tenth qualifications cannot queue duplicate benefits.
  if ((channel === "A" || channel === "C") && (attribution.code.referrerSalonId || attribution.code.referrerEducationCenterId)) {
    const sourceId = attribution.code.referrerSalonId ?? attribution.code.referrerEducationCenterId!;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`referral-milestone:${channel}:${sourceId}`}))`);
    const qualified = await tx.select({ count: sql<number>`count(*)::int` }).from(referralQualificationsTable)
      .innerJoin(referralAttributionsTable, eq(referralQualificationsTable.attributionId, referralAttributionsTable.id))
      .innerJoin(referralCodesTable, eq(referralAttributionsTable.referralCodeId, referralCodesTable.id))
      .where(and(eq(referralAttributionsTable.channel, channel), inArray(referralQualificationsTable.status, ["held", "available", "qualified"]),
        attribution.code.referrerSalonId
          ? eq(referralCodesTable.referrerSalonId, sourceId)
          : eq(referralCodesTable.referrerEducationCenterId, sourceId)));
    const count = Number(qualified[0]?.count ?? 0);
    const crossing = milestoneCrossed(channel, count - 1, count);
    if (crossing) {
      const sourceBusiness: ReferralSourceBusiness = attribution.code.referrerSalonId ? "salon" : "education_center";
      const kind = milestoneBenefitKind(channel, sourceBusiness)!;
      let billingCycleStart: Date | null = null;
      let billingCycleEnd: Date | null = null;
      if (kind === "education_commission_reduction") {
        const centerId = attribution.code.referrerEducationCenterId!;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`education-benefit-schedule:${centerId}`}))`);
        const [subscription] = await tx.select({ currentPeriodEnd: educationCenterSubscriptionsTable.currentPeriodEnd })
          .from(educationCenterSubscriptionsTable)
          .where(eq(educationCenterSubscriptionsTable.centerId, centerId))
          .for("update")
          .limit(1);
        const [lastScheduled] = await tx.select({ billingCycleEnd: referralMilestoneBenefitsTable.billingCycleEnd })
          .from(referralMilestoneBenefitsTable)
          .where(and(
            eq(referralMilestoneBenefitsTable.benefitEducationCenterId, centerId),
            eq(referralMilestoneBenefitsTable.kind, "education_commission_reduction"),
            isNull(referralMilestoneBenefitsTable.neutralizedAt),
            sql`${referralMilestoneBenefitsTable.billingCycleEnd} is not null`,
          ))
          .orderBy(desc(referralMilestoneBenefitsTable.billingCycleEnd))
          .limit(1);
        const nextCalendarMonth = new Date(Date.UTC(
          input.occurredAt.getUTCFullYear(),
          input.occurredAt.getUTCMonth() + 1,
          1,
        ));
        const nextSubscriptionCycle = subscription?.currentPeriodEnd ?? nextCalendarMonth;
        billingCycleStart = lastScheduled?.billingCycleEnd && lastScheduled.billingCycleEnd > nextSubscriptionCycle
          ? lastScheduled.billingCycleEnd
          : nextSubscriptionCycle;
        billingCycleEnd = oneUtcMonthAfter(billingCycleStart);
      }
      const [benefit] = await tx.insert(referralMilestoneBenefitsTable).values({
        referrerUserId: attribution.attribution.referrerUserId, channel, qualifyingCount: crossing,
        kind,
        benefitSalonId: attribution.code.referrerSalonId,
        benefitEducationCenterId: attribution.code.referrerEducationCenterId,
        billingCycleStart,
        billingCycleEnd,
        idempotencyKey: referralIdempotencyKey("milestone", channel, sourceId, String(crossing)),
      }).onConflictDoNothing().returning();
      if (benefit) {
        const [recipient] = await tx.select().from(usersTable)
          .where(eq(usersTable.id, attribution.attribution.referrerUserId)).limit(1);
        if (recipient) await enqueueTransactionalEmail(tx, {
          eventKey: `referral-milestone:${benefit.id}`,
          emailType: "referral_milestone",
          to: { email: recipient.email, name: `${recipient.firstName} ${recipient.lastName}` },
          subject: "LUMERA — ostvarena milestone pogodnost",
          htmlContent: lumeraEmailHtml("Ostvarena milestone pogodnost",
            `<p>Vaša ${crossing}. kvalifikovana preporuka na kanalu ${channel} aktivirala je pogodnost za naredni odgovarajući obračunski ciklus.</p>`),
          metadata: { milestoneBenefitId: benefit.id, channel, qualifyingCount: crossing },
        }, input.occurredAt);
        await enqueueReferralSmsInTx(tx, {
          eventKey: `referral-milestone:${benefit.id}`,
          userId: attribution.attribution.referrerUserId,
          salonId: benefit.benefitSalonId,
          text: `LUMERA: vaša ${crossing}. kvalifikovana preporuka na kanalu ${channel} aktivirala je pogodnost za naredni obračunski ciklus.`,
        });
      }
    }
  }
  return { matched: true, qualified: true };
}

export async function recordAppointmentReferralTransitionInTx(tx: ReferralTransaction, input: AppointmentReferralTransition) {
  return recordReferralEvidenceInTx(tx, { ...input, kind: "appointment" });
}
export async function recordEducationEnrollmentReferralTransitionInTx(tx: ReferralTransaction, input: EnrollmentReferralTransition) {
  return recordReferralEvidenceInTx(tx, { ...input, kind: "enrollment" });
}

export class ReferralReviewDecisionConflictError extends Error {
  readonly code = "REFERRAL_REVIEW_DECISION_CONFLICT";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Resolves fraud review and its linked lifecycle as one serialized transaction.
 * Lock order is review -> attribution -> qualification; financial source rows
 * are locked only after the lifecycle rows.
 */
export async function decideReferralReview(
  actorUserId: string,
  reviewId: string,
  decision: "approved" | "rejected" | "dismissed",
  detail?: string | null,
) {
  return db.transaction(async (tx) => {
    const [review] = await tx.select().from(referralReviewsTable)
      .where(eq(referralReviewsTable.id, reviewId)).for("update").limit(1);
    if (!review) return null;
    if (review.status !== "open") {
      throw new ReferralReviewDecisionConflictError("Referral review has already been resolved.");
    }
    if (!review.attributionId) {
      throw new ReferralReviewDecisionConflictError("Referral review is not linked to an attribution.");
    }
    const [attribution] = await tx.select().from(referralAttributionsTable)
      .where(eq(referralAttributionsTable.id, review.attributionId)).for("update").limit(1);
    if (!attribution) {
      throw new ReferralReviewDecisionConflictError("Linked referral attribution no longer exists.");
    }
    const [qualification] = await tx.select().from(referralQualificationsTable)
      .where(eq(referralQualificationsTable.attributionId, attribution.id)).for("update").limit(1);
    if (!qualification) {
      throw new ReferralReviewDecisionConflictError("Linked referral qualification no longer exists.");
    }
    const now = new Date();

    if (decision === "dismissed") {
      if (attribution.status !== "attributed") {
        throw new ReferralReviewDecisionConflictError(
          "A blocking referral review must be approved or rejected.",
        );
      }
    } else if (decision === "approved") {
      if (attribution.status === "rejected" || attribution.status === "expired"
        || qualification.status === "rejected" || qualification.status === "reversed") {
        throw new ReferralReviewDecisionConflictError("A terminal referral cannot be approved.");
      }
      if (attribution.status === "under_review") {
        await tx.update(referralAttributionsTable).set({
          status: "attributed",
          // The review row permanently retains the suspicious signal and admin
          // resolution; this field should describe only a current rejection.
          rejectionReason: null,
        }).where(eq(referralAttributionsTable.id, attribution.id));
        await tx.update(referralQualificationsTable).set({
          status: attribution.channel === "A" || attribution.channel === "B1"
            ? "pending_verification"
            : "tracking",
          updatedAt: now,
        }).where(eq(referralQualificationsTable.id, qualification.id));
      } else if (attribution.status !== "attributed") {
        throw new ReferralReviewDecisionConflictError("Referral attribution is not approvable.");
      }
    } else {
      const codeRows = await tx.select().from(referralCodesTable)
        .where(eq(referralCodesTable.id, attribution.referralCodeId)).limit(1);
      const code = codeRows[0];
      if (!code) throw new ReferralReviewDecisionConflictError("Linked referral code no longer exists.");
      const policy = REFERRAL_POLICY[attribution.channel as ReferralChannel];
      const scope: ReferralWalletScope = {
        walletKind: policy.wallet,
        ownerUserId: attribution.referrerUserId,
        salonId: policy.wallet === "B2B" ? code.referrerSalonId : null,
        educationCenterId: policy.wallet === "B2B" ? code.referrerEducationCenterId : null,
      };
      const { producedReward } = await compensateInvalidatedReferralSourcesInTx(tx, {
        attributionId: attribution.id,
        scope,
        now,
        actorUserId,
        reason: detail?.trim() || `Referral rejected after fraud review: ${review.reasonCode}.`,
        metadata: { reviewId: review.id },
      });
      await tx.update(referralAttributionsTable).set({
        status: "rejected",
        rejectionReason: detail?.trim() || review.reasonCode,
      }).where(eq(referralAttributionsTable.id, attribution.id));
      await tx.update(referralQualificationsTable).set({
        status: "rejected",
        reversedAt: producedReward ? now : qualification.reversedAt,
        updatedAt: now,
      }).where(eq(referralQualificationsTable.id, qualification.id));

      if ((attribution.channel === "A" || attribution.channel === "C")
        && (code.referrerSalonId || code.referrerEducationCenterId)) {
        const sourceId = code.referrerSalonId ?? code.referrerEducationCenterId!;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`referral-milestone:${attribution.channel}:${sourceId}`}))`);
        const active = await tx.select({ count: sql<number>`count(*)::int` })
          .from(referralQualificationsTable)
          .innerJoin(referralAttributionsTable,
            eq(referralQualificationsTable.attributionId, referralAttributionsTable.id))
          .innerJoin(referralCodesTable,
            eq(referralAttributionsTable.referralCodeId, referralCodesTable.id))
          .where(and(
            eq(referralAttributionsTable.channel, attribution.channel),
            eq(referralAttributionsTable.status, "attributed"),
            inArray(referralQualificationsTable.status, ["qualified", "held", "available"]),
            code.referrerSalonId
              ? eq(referralCodesTable.referrerSalonId, sourceId)
              : eq(referralCodesTable.referrerEducationCenterId, sourceId),
          ));
        const activeCount = Number(active[0]?.count ?? 0);
        await tx.update(referralMilestoneBenefitsTable).set({
          neutralizedAt: now,
          neutralizedByUserId: actorUserId,
          neutralizationReason: detail?.trim() || `Referral fraud review ${review.id} rejected.`,
        }).where(and(
          eq(referralMilestoneBenefitsTable.channel, attribution.channel),
          code.referrerSalonId
            ? eq(referralMilestoneBenefitsTable.benefitSalonId, sourceId)
            : eq(referralMilestoneBenefitsTable.benefitEducationCenterId, sourceId),
          gt(referralMilestoneBenefitsTable.qualifyingCount, activeCount),
          isNull(referralMilestoneBenefitsTable.appliedAt),
          isNull(referralMilestoneBenefitsTable.neutralizedAt),
        ));
      }
    }

    const [saved] = await tx.update(referralReviewsTable).set({
      status: decision,
      detail: detail?.trim() || review.detail,
      reviewedByUserId: actorUserId,
      resolvedAt: now,
    }).where(and(eq(referralReviewsTable.id, review.id), eq(referralReviewsTable.status, "open")))
      .returning();
    if (!saved) throw new ReferralReviewDecisionConflictError("Referral review was resolved concurrently.");
    return saved;
  });
}

/** Approves/rejects/resubmits the actual business record and its referral gate atomically. */
export async function decideReferredBusinessApproval(
  actorUserId: string,
  attributionId: string,
  action: "approve" | "reject" | "resubmit",
  reason?: string | null,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ attribution: referralAttributionsTable, qualification: referralQualificationsTable })
      .from(referralAttributionsTable)
      .innerJoin(referralQualificationsTable, eq(referralQualificationsTable.attributionId, referralAttributionsTable.id))
      .where(and(eq(referralAttributionsTable.id, attributionId), inArray(referralAttributionsTable.channel, ["A", "B1"])))
      .for("update").limit(1);
    if (!row) return null;
    const businessId = row.attribution.referredSalonId ?? row.attribution.referredEducationCenterId;
    if (!businessId) return null;
    const previousStatus = row.qualification.status;
    const nextStatus = action === "approve" ? "tracking" : "pending_verification";
    const now = new Date();
    if (row.attribution.referredSalonId) {
      await tx.update(salonsTable).set({ isVerified: action === "approve" })
        .where(eq(salonsTable.id, row.attribution.referredSalonId));
    } else {
      await tx.update(educationCentersTable).set({
        verificationStatus: action === "approve" ? "verified" : action === "reject" ? "rejected" : "pending",
        verificationNote: reason ?? null, verifiedAt: action === "approve" ? now : null,
        verifiedByUserId: action === "approve" ? actorUserId : null, updatedAt: now,
      }).where(eq(educationCentersTable.id, businessId));
    }
    await tx.update(referralQualificationsTable).set({
      status: nextStatus,
      trackingStartedAt: action === "approve" ? row.qualification.trackingStartedAt ?? now : row.qualification.trackingStartedAt,
      updatedAt: now,
    }).where(eq(referralQualificationsTable.id, row.qualification.id));
    const [legalBusiness] = await tx.select({ id: legalEntityBusinessesTable.id }).from(legalEntityBusinessesTable)
      .where(row.attribution.referredSalonId
        ? eq(legalEntityBusinessesTable.salonId, businessId)
        : eq(legalEntityBusinessesTable.educationCenterId, businessId)).limit(1);
    if (legalBusiness) await tx.insert(businessVerificationAuditsTable).values({
      legalEntityBusinessId: legalBusiness.id, previousStatus, nextStatus: action === "approve" ? "verified" : action === "reject" ? "rejected" : "pending",
      reason: reason ?? null, actorUserId, evidence: { referralAttributionId: attributionId, action },
    });
    return { businessKind: row.attribution.referredSalonId ? "salon" as const : "education_center" as const, action, status: nextStatus };
  });
}

function nextMonthlyCycleBoundary(start: Date): Date {
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const targetMonth = end.getUTCMonth();
  end.setUTCMonth(targetMonth + 1, 0);
  end.setUTCDate(Math.min(day, end.getUTCDate()));
  return end;
}

export function applySalonReferralSubscriptionReduction(baseDueRsd: number, discountPercent = SALON_TYPE_A_SUBSCRIPTION_DISCOUNT_PERCENT) {
  if (!Number.isSafeInteger(baseDueRsd) || baseDueRsd < 0) throw new Error("Subscription due must be non-negative integer RSD.");
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new Error("Invalid subscription discount percent.");
  return Math.round(baseDueRsd * (100 - discountPercent) / 100);
}

export function projectSalonSubscriptionDue(
  baseDueRsd: number,
  loyalty: { freeSubscription: boolean; discountPercent: number },
  referralDiscountPercent = 0,
) {
  if (loyalty.freeSubscription) return 0;
  if (loyalty.discountPercent > 0) {
    return applySalonReferralSubscriptionReduction(baseDueRsd, loyalty.discountPercent);
  }
  return referralDiscountPercent > 0
    ? applySalonReferralSubscriptionReduction(baseDueRsd, referralDiscountPercent)
    : baseDueRsd;
}

const subscriptionPriority: Record<(typeof subscriptionsTable.$inferSelect)["status"], number> = {
  free_via_loyalty: 6,
  active: 5,
  trial: 4,
  past_due: 3,
  suspended: 2,
  cancelled: 1,
};

/** Assign and activate salon milestones against the one canonical owner charge. */
async function maintainSalonSubscriptionBenefits(now: Date) {
  const owners = await db.selectDistinct({ ownerId: salonsTable.ownerId })
    .from(referralMilestoneBenefitsTable)
    .innerJoin(salonsTable, eq(referralMilestoneBenefitsTable.benefitSalonId, salonsTable.id))
    .where(and(eq(referralMilestoneBenefitsTable.kind, "salon_subscription_reduction"),
      isNull(referralMilestoneBenefitsTable.neutralizedAt)));
  let scheduled = 0;
  let activated = 0;
  for (const { ownerId } of owners) {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`salon-subscription-referral:${ownerId}`}))`);
      const subscriptions = await tx.select({ subscription: subscriptionsTable, plan: subscriptionPlansTable })
        .from(subscriptionsTable)
        .innerJoin(salonsTable, eq(subscriptionsTable.salonId, salonsTable.id))
        .innerJoin(subscriptionPlansTable, eq(subscriptionsTable.planId, subscriptionPlansTable.id))
        .where(eq(salonsTable.ownerId, ownerId));
      const canonical = subscriptions.sort((a, b) =>
        subscriptionPriority[b.subscription.status] - subscriptionPriority[a.subscription.status]
        || b.subscription.dueAmount - a.subscription.dueAmount
        || a.subscription.id.localeCompare(b.subscription.id))[0];
      if (!canonical?.subscription.currentPeriodEnd) return { scheduled: 0, activated: 0 };
      const benefits = await tx.select({ benefit: referralMilestoneBenefitsTable })
        .from(referralMilestoneBenefitsTable)
        .innerJoin(salonsTable, eq(referralMilestoneBenefitsTable.benefitSalonId, salonsTable.id))
        .where(and(eq(salonsTable.ownerId, ownerId),
          eq(referralMilestoneBenefitsTable.kind, "salon_subscription_reduction"),
          isNull(referralMilestoneBenefitsTable.neutralizedAt)))
        .orderBy(asc(referralMilestoneBenefitsTable.createdAt), asc(referralMilestoneBenefitsTable.id))
        .for("update", { of: referralMilestoneBenefitsTable });
      let cursor = canonical.subscription.currentPeriodEnd;
      // A legacy/manual subscription row may not have rolled its period marker
      // forward yet. Never assign a newly queued benefit wholly into the past.
      while (nextMonthlyCycleBoundary(cursor) <= now) cursor = nextMonthlyCycleBoundary(cursor);
      let scheduledCount = 0;
      let activatedCount = 0;
      for (const { benefit } of benefits) {
        let cycleStart = benefit.billingCycleStart;
        let cycleEnd = benefit.billingCycleEnd;
        // An unapplied legacy assignment whose window was missed is safely put
        // back at the head of the owner's future queue.
        if (cycleStart && cycleEnd && cycleEnd <= now && !benefit.appliedAt) {
          cycleStart = null;
          cycleEnd = null;
        }
        if (!cycleStart) {
          cycleStart = cursor;
          cycleEnd = nextMonthlyCycleBoundary(cycleStart);
          await tx.update(referralMilestoneBenefitsTable).set({
            billingCycleStart: cycleStart,
            billingCycleEnd: cycleEnd,
            discountPercent: SALON_TYPE_A_SUBSCRIPTION_DISCOUNT_PERCENT,
          }).where(eq(referralMilestoneBenefitsTable.id, benefit.id));
          scheduledCount += 1;
        } else {
          cycleEnd ??= nextMonthlyCycleBoundary(cycleStart);
          if (!benefit.billingCycleEnd || benefit.discountPercent == null) {
            await tx.update(referralMilestoneBenefitsTable).set({
              billingCycleEnd: cycleEnd,
              discountPercent: benefit.discountPercent ?? SALON_TYPE_A_SUBSCRIPTION_DISCOUNT_PERCENT,
            }).where(eq(referralMilestoneBenefitsTable.id, benefit.id));
          }
        }
        if (cycleEnd > cursor) cursor = cycleEnd;
        if (!benefit.appliedAt && cycleStart <= now && now < cycleEnd) {
          const changed = await tx.update(referralMilestoneBenefitsTable).set({ appliedAt: now })
            .where(and(eq(referralMilestoneBenefitsTable.id, benefit.id), isNull(referralMilestoneBenefitsTable.appliedAt)))
            .returning({ id: referralMilestoneBenefitsTable.id });
          activatedCount += changed.length;
        }
      }
      return { scheduled: scheduledCount, activated: activatedCount };
    });
    scheduled += result.scheduled;
    activated += result.activated;
  }
  return { scheduled, activated };
}

/** Runs from the scheduler. Every write is keyed so overlapping workers are safe. */
export async function runReferralMaintenance(now = new Date()) {
  const salonBenefits = await maintainSalonSubscriptionBenefits(now);
  const released = await db.transaction(async (tx) => {
    const due = await tx.select().from(referralQualificationsTable)
      .innerJoin(referralAttributionsTable, eq(referralQualificationsTable.attributionId, referralAttributionsTable.id))
      .innerJoin(referralCodesTable, eq(referralAttributionsTable.referralCodeId, referralCodesTable.id))
      .where(and(eq(referralAttributionsTable.status, "attributed"),
        eq(referralQualificationsTable.status, "held"), lte(referralQualificationsTable.holdUntil, now)))
      .for("update");
    let count = 0;
    for (const row of due) {
      const qualification = row.referral_qualifications;
      const attribution = row.referral_attributions;
      const code = row.referral_codes;
      const policy = REFERRAL_POLICY[attribution.channel as ReferralChannel];
      const availableAt = now;
      const entryKey = referralIdempotencyKey("available", attribution.id);
      await tx.insert(referralCreditLedgerTable).values({
        walletKind: policy.wallet, ownerUserId: attribution.referrerUserId,
        salonId: policy.wallet === "B2B" ? code.referrerSalonId : null,
        educationCenterId: policy.wallet === "B2B" ? code.referrerEducationCenterId : null, referralAttributionId: attribution.id,
        type: "available", amountRsd: policy.rewardAmountRsd, effectiveAt: availableAt,
        expiresAt: creditExpiry(availableAt), reason: "Referral qualification hold completed.",
        idempotencyKey: entryKey,
      }).onConflictDoNothing();
      await tx.update(referralQualificationsTable).set({ status: "available", availableAt, updatedAt: now })
        .where(and(eq(referralQualificationsTable.id, qualification.id), eq(referralQualificationsTable.status, "held")));
      const [recipient] = await tx.select().from(usersTable)
        .where(eq(usersTable.id, attribution.referrerUserId)).limit(1);
      if (recipient) await enqueueTransactionalEmail(tx, {
        eventKey: `referral-credit-available:${attribution.id}`,
        emailType: "referral_credit_available",
        to: { email: recipient.email, name: `${recipient.firstName} ${recipient.lastName}` },
        subject: "LUMERA — kredit preporuke je dostupan",
        htmlContent: lumeraEmailHtml("Kredit preporuke je dostupan",
          `<p>Vaš kredit od ${policy.rewardAmountRsd} RSD je sada dostupan i važi šest meseci.</p>`),
        metadata: { referralAttributionId: attribution.id, amountRsd: policy.rewardAmountRsd },
      }, now);
      await enqueueReferralSmsInTx(tx, {
        eventKey: `referral-credit-available:${attribution.id}`,
        userId: attribution.referrerUserId,
        salonId: code.referrerSalonId,
        text: `LUMERA: kredit preporuke od ${policy.rewardAmountRsd} RSD je dostupan i važi šest meseci.`,
      });
      count += 1;
    }
    return count;
  });
  const warningFrom = new Date(now.getTime() + 13 * 24 * 60 * 60 * 1000);
  const warningUntil = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
  const warningSources = await db.select().from(referralCreditLedgerTable).where(and(
    eq(referralCreditLedgerTable.type, "available"),
    gte(referralCreditLedgerTable.expiresAt, warningFrom),
    lte(referralCreditLedgerTable.expiresAt, warningUntil),
  ));
  let warned = 0;
  for (const source of warningSources) {
    const written = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`referral-expiry-warning:${source.id}`}))`);
      const redemptionRows = await tx.select({ amount: referralCreditRedemptionsTable.amountRsd })
        .from(referralCreditRedemptionsTable)
        .where(eq(referralCreditRedemptionsTable.ledgerEntryId, source.id))
        .for("update");
      const restorationRows = await tx.select({ amount: referralCreditLedgerTable.amountRsd })
        .from(referralCreditLedgerTable)
        .where(and(eq(referralCreditLedgerTable.type, "restored"),
          sql`${referralCreditLedgerTable.metadata}->>'sourceLedgerEntryId' = ${source.id}`))
        .for("update");
      const remainder = Math.max(0, Math.min(source.amountRsd, source.amountRsd
        - redemptionRows.reduce((sum, row) => sum + row.amount, 0)
        + restorationRows.reduce((sum, row) => sum + row.amount, 0)));
      if (!remainder) return false;
      const [recipient] = await tx.select().from(usersTable)
        .where(eq(usersTable.id, source.ownerUserId)).limit(1);
      if (!recipient) return false;
      const emailWritten = Boolean(await enqueueTransactionalEmail(tx, {
        eventKey: `referral-credit-expiry-warning:${source.id}`,
        emailType: "referral_credit_expiry_warning",
        to: { email: recipient.email, name: `${recipient.firstName} ${recipient.lastName}` },
        subject: "LUMERA — kredit uskoro ističe",
        htmlContent: lumeraEmailHtml("Kredit preporuke uskoro ističe",
          `<p>Preostali kredit od ${remainder} RSD ističe za približno 14 dana.</p>`),
        metadata: { sourceLedgerEntryId: source.id, remainderRsd: remainder },
      }, now));
      const smsWritten = Boolean(await enqueueReferralSmsInTx(tx, {
        eventKey: `referral-credit-expiry-warning:${source.id}`,
        userId: source.ownerUserId,
        salonId: source.salonId,
        text: `LUMERA: preostali kredit preporuke od ${remainder} RSD ističe za približno 14 dana.`,
      }));
      return emailWritten || smsWritten;
    });
    if (written) warned += 1;
  }
  const expiring = await db.select().from(referralCreditLedgerTable).where(and(
    eq(referralCreditLedgerTable.type, "available"), lte(referralCreditLedgerTable.expiresAt, now),
  ));
  let expired = 0;
  for (const entry of expiring) {
    const written = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`referral-expiry:${entry.id}`}))`);
      const [source] = await tx.select().from(referralCreditLedgerTable)
        .where(and(eq(referralCreditLedgerTable.id, entry.id), eq(referralCreditLedgerTable.type, "available"),
          lte(referralCreditLedgerTable.expiresAt, now)))
        .for("update")
        .limit(1);
      if (!source) return false;
      const redemptionRows = await tx.select({ amount: referralCreditRedemptionsTable.amountRsd })
        .from(referralCreditRedemptionsTable)
        .where(eq(referralCreditRedemptionsTable.ledgerEntryId, source.id))
        .for("update");
      const allocationRows = await tx.select({ amount: referralCreditLedgerTable.amountRsd })
        .from(referralCreditLedgerTable)
        .where(and(
          inArray(referralCreditLedgerTable.type, ["restored", "expired", "reversed"]),
          sql`${referralCreditLedgerTable.metadata}->>'sourceLedgerEntryId' = ${source.id}`,
        ))
        .for("update");
      const remainder = Math.max(0, Math.min(source.amountRsd, source.amountRsd
        - redemptionRows.reduce((sum, row) => sum + row.amount, 0)
        + allocationRows.reduce((sum, row) => sum + row.amount, 0)));
      if (!remainder) return false;
      const [inserted] = await tx.insert(referralCreditLedgerTable).values({
        walletKind: source.walletKind, ownerUserId: source.ownerUserId, salonId: source.salonId,
        educationCenterId: source.educationCenterId, referralAttributionId: source.referralAttributionId,
        type: "expired", amountRsd: -remainder, effectiveAt: now, reason: "Referral credit expired.",
        idempotencyKey: referralIdempotencyKey("expired", source.id),
        metadata: { sourceLedgerEntryId: source.id, expiredLedgerEntryId: source.id },
      }).onConflictDoNothing().returning();
      return Boolean(inserted);
    });
    if (written) expired += 1;
  }
  const sms = await drainReferralSmsOutbox();
  return { released, warned, expired, salonBenefitsScheduled: salonBenefits.scheduled,
    salonBenefitsActivated: salonBenefits.activated, smsAttempted: sms.attempted };
}