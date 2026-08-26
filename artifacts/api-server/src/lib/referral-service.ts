import { createHash } from "node:crypto";
import { and, asc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  appointmentsTable,
  businessVerificationAuditsTable,
  courseEnrollmentsTable,
  coursesTable,
  db,
  educationCentersTable,
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
  usersTable,
} from "@workspace/db";
import {
  REFERRAL_POLICY,
  creditExpiry,
  canEarnUnderCap,
  milestoneBenefitKind,
  milestoneCrossed,
  normalizePib,
  qualificationHoldUntil,
  qualificationSatisfied,
  qualificationWindowStartsAt,
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

export function deriveReferralCreditBalance(
  entries: Array<Pick<typeof referralCreditLedgerTable.$inferSelect, "type" | "amountRsd" | "expiresAt" | "effectiveAt">
    & { id?: string; metadata?: Record<string, unknown> }>,
  now = new Date(),
) {
  const base = entries.reduce((total, entry) => {
    if (entry.effectiveAt > now || entry.type === "held" || entry.metadata?.["reversedHeld"] === true) return total;
    return total + entry.amountRsd;
  }, 0);
  const virtualExpiry = entries.reduce((total, source) => {
    if (source.type !== "available" || !source.expiresAt || source.expiresAt > now) return total;
    const allocated = source.id ? entries.reduce((sum, entry) =>
      entry.metadata?.["sourceLedgerEntryId"] === source.id ? sum + entry.amountRsd : sum, 0) : 0;
    return total + Math.max(0, source.amountRsd + allocated);
  }, 0);
  return base - virtualExpiry;
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
      lte(referralCreditLedgerTable.effectiveAt, now),
      or(isNull(referralCreditLedgerTable.expiresAt), gt(referralCreditLedgerTable.expiresAt, now))))
    .orderBy(asc(referralCreditLedgerTable.effectiveAt), asc(referralCreditLedgerTable.id))
    .for("update");
  const availableRsd = await referralCreditBalanceInTx(tx, scope, now);
  let remaining = Math.max(0, Math.min(desiredRsd, merchandiseSubtotalRsd, availableRsd));
  if (!remaining) return { availableRsd, appliedRsd: 0, allocations: [] };
  const sourceIds = sources.map((source) => source.id);
  const spent = sourceIds.length ? await tx.select({
    ledgerEntryId: referralCreditRedemptionsTable.ledgerEntryId,
    amount: sql<number>`coalesce(sum(${referralCreditRedemptionsTable.amountRsd}), 0)::int`,
  }).from(referralCreditRedemptionsTable).where(inArray(referralCreditRedemptionsTable.ledgerEntryId, sourceIds))
    .groupBy(referralCreditRedemptionsTable.ledgerEntryId) : [];
  const spentBySource = new Map(spent.map((row) => [row.ledgerEntryId, Number(row.amount)]));
  const allocations: ReferralCreditAllocation[] = [];
  for (const source of sources) {
    const remainingOnSource = Math.max(0, source.amountRsd - (spentBySource.get(source.id) ?? 0));
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
  const rows = await tx.select({
    ledgerEntryId: referralCreditRedemptionsTable.ledgerEntryId,
    amount: sql<number>`sum(${referralCreditRedemptionsTable.amountRsd})::int`,
  }).from(referralCreditRedemptionsTable).where(input.orderId
    ? eq(referralCreditRedemptionsTable.orderId, input.orderId)
    : eq(referralCreditRedemptionsTable.retailOrderId, input.retailOrderId!))
    .groupBy(referralCreditRedemptionsTable.ledgerEntryId);
  const now = input.now ?? new Date();
  for (const row of rows) {
    await tx.insert(referralCreditLedgerTable).values({
      ...input.scope, type: "restored", amountRsd: Number(row.amount), effectiveAt: now,
      actorUserId: input.actorUserId ?? null, reason: "Referral credit restored after order cancellation or refund.",
      idempotencyKey: referralIdempotencyKey("restored", input.eventKey, row.ledgerEntryId),
      metadata: { sourceLedgerEntryId: row.ledgerEntryId, orderId: input.orderId ?? null, retailOrderId: input.retailOrderId ?? null },
    }).onConflictDoNothing();
  }
}

export function normalizedReferralCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
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
  A: "Preporuka poslovnog partnera (A): salon ili edukativni centar može preporučiti novi biznis. Nakon administrativne verifikacije preporučenog biznisa, u roku od tri meseca moraju biti završena četiri termina u salonu, odnosno četiri potvrđene ili završene prijave za edukaciju. Nagrada od 500 RSD je na čekanju 14 dana, zatim je dostupna šest meseci samo za poslovne kupovine. Svaka deseta kvalifikovana preporuka donosi pogodnost za naredni obračunski ciklus. Samopreporuke, preklapanje PIB-a ili kontakta i zloupotrebe se odbijaju ili šalju na proveru.",
  B1: "Preporuka biznisa (B1): korisnik ili kandidat za posao može preporučiti novi salon ili edukativni centar. Posle verifikacije biznisa potrebno je četiri završena termina, odnosno četiri potvrđene ili završene prijave za edukaciju u roku od tri meseca. Nagrada je 500 RSD kredita za kupovinu kao fizičko lice i dostupna je odmah po kvalifikaciji. Nema milestone pogodnosti.",
  B2: "Preporuka novog korisnika (B2): novi korisnik mora potvrditi broj telefona i završiti tri termina u roku od 60 dana od registracije. Nagrada je 100 RSD, dostupna nakon 14 dana i važi šest meseci za B2C kupovine. Najviše 20 nagrada može biti ostvareno po preporučiocu u jednom kalendarskom mesecu. B2 se ne kombinuje sa D preporukom za istu osobu.",
  C: "Studentska preporuka (C): edukativni centar preporučuje novog polaznika. Potrebne su četiri potvrđene ili završene prijave u roku od tri meseca. Nagrada je 500 RSD poslovnog kredita nakon čekanja od 14 dana, sa rokom korišćenja od šest meseci. Svaka deseta kvalifikovana preporuka aktivira pogodnost od 12% provizije za naredni obračunski period.",
  D: "Preporuka postojećeg klijenta (D): salon preporučuje novog korisnika koji mora potvrditi broj telefona i završiti jedan termin. Nagrada od 100 RSD poslovnog kredita dostupna je nakon 30 dana i važi šest meseci. Salon može ostvariti najviše 15 nagrada u kalendarskoj nedelji. D se ne kombinuje sa B2 preporukom za istu osobu.",
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
    now?: Date;
  },
) {
  const raw = input.referralCode ? normalizedReferralCode(input.referralCode) : "";
  if (!raw) return null;
  const now = input.now ?? new Date();
  const [code] = await tx.select().from(referralCodesTable)
    .where(and(eq(referralCodesTable.code, raw), eq(referralCodesTable.active, true))).limit(1);
  if (!code || code.referrerUserId === input.referredUserId) return null;
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
  const targetMatches = input.kind === "appointment"
    ? (channel === "A" || channel === "B1" ? qualification.referredSalonId === input.salonId
      : channel === "D" ? attribution.code.referrerSalonId === input.salonId : channel === "B2")
    : (channel === "A" || channel === "B1" ? qualification.referredEducationCenterId === input.centerId
      : channel === "C" ? attribution.code.referrerEducationCenterId === input.centerId : false);
  if (!targetMatches) return { matched: false, qualified: false };
  if (input.valid && qualification.status === "pending_verification") {
    return { matched: true, qualified: false };
  }
  // Eligibility begins at attribution for consumer channels and at approval
  // (represented by tracking qualification update) for business channels.
  if (input.valid && (input.occurredAt < qualification.updatedAt || input.occurredAt < attribution.attribution.capturedAt
    || input.occurredAt < qualificationWindowStartsAt(channel, input.occurredAt))) return { matched: true, qualified: false };
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
  const windowStart = qualificationWindowStartsAt(channel, input.occurredAt);
  const validCount = evidence.filter((item) => item.eligibleAt >= windowStart
    && item.eligibleAt >= attribution.attribution.capturedAt).length;
  if (!qualificationSatisfied(channel, validCount)) {
    if (["qualified", "held", "available"].includes(qualification.status)) {
      const key = referralIdempotencyKey("clawback", attribution.attribution.id);
      const policy = REFERRAL_POLICY[channel];
      const [availableSource] = await tx.select({ id: referralCreditLedgerTable.id })
        .from(referralCreditLedgerTable)
        .where(and(eq(referralCreditLedgerTable.referralAttributionId, attribution.attribution.id),
          eq(referralCreditLedgerTable.type, "available")))
        .for("update")
        .limit(1);
      await tx.insert(referralCreditLedgerTable).values({
        walletKind: policy.wallet, ownerUserId: attribution.attribution.referrerUserId,
        salonId: policy.wallet === "B2B" ? attribution.code.referrerSalonId : null,
        educationCenterId: policy.wallet === "B2B" ? attribution.code.referrerEducationCenterId : null,
        referralAttributionId: attribution.attribution.id, type: "reversed", amountRsd: -policy.rewardAmountRsd,
        effectiveAt: input.occurredAt, reason: "Qualification evidence was cancelled or refunded.", idempotencyKey: key,
        metadata: {
          sourceLedgerEntryId: availableSource?.id ?? null,
          reversedHeld: !availableSource,
        },
      }).onConflictDoNothing();
      await tx.update(referralQualificationsTable).set({ status: "reversed", reversedAt: input.occurredAt, updatedAt: input.occurredAt })
        .where(eq(referralQualificationsTable.id, qualification.id));
    }
    return { matched: true, qualified: false };
  }
  if (qualification.status === "reversed") return { matched: true, qualified: false };
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
      const [benefit] = await tx.insert(referralMilestoneBenefitsTable).values({
        referrerUserId: attribution.attribution.referrerUserId, channel, qualifyingCount: crossing,
        kind: milestoneBenefitKind(channel, sourceBusiness)!,
        benefitSalonId: attribution.code.referrerSalonId,
        benefitEducationCenterId: attribution.code.referrerEducationCenterId,
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
      status: nextStatus, updatedAt: now,
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

/** Runs from the scheduler. Every write is keyed so overlapping workers are safe. */
export async function runReferralMaintenance(now = new Date()) {
  const released = await db.transaction(async (tx) => {
    const due = await tx.select().from(referralQualificationsTable)
      .innerJoin(referralAttributionsTable, eq(referralQualificationsTable.attributionId, referralAttributionsTable.id))
      .innerJoin(referralCodesTable, eq(referralAttributionsTable.referralCodeId, referralCodesTable.id))
      .where(and(eq(referralQualificationsTable.status, "held"), lte(referralQualificationsTable.holdUntil, now)))
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
      const remainder = Math.max(0, source.amountRsd
        - redemptionRows.reduce((sum, row) => sum + row.amount, 0)
        + restorationRows.reduce((sum, row) => sum + row.amount, 0));
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
      const remainder = Math.max(0, source.amountRsd
        - redemptionRows.reduce((sum, row) => sum + row.amount, 0)
        + allocationRows.reduce((sum, row) => sum + row.amount, 0));
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
  return { released, warned, expired, smsAttempted: sms.attempted };
}