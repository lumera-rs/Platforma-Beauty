import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  educationBankTransactionsTable,
  educationPaymentObligationsTable,
  educationPlatformSettingsTable,
} from "@workspace/db";
import { lockEducationBillingRules } from "./education-billing";
import { settleEducationPaymentObligationInTransaction } from "./education-payment-obligation-settlement";
import { writeEducationFinancialAuditInTx } from "./education-financial-audit";

export const normalizedEducationBankTransactionSchema = z.object({
  source: z.string().trim().min(1).max(100),
  sourceItemId: z.string().trim().min(1).max(255),
  reference: z.string().trim().min(1).max(140),
  amountRsd: z.number().int().positive().max(2_147_483_647),
  receivedAt: z.date(),
}).strict();

export type NormalizedEducationBankTransaction = z.infer<typeof normalizedEducationBankTransactionSchema>;

export const educationBankAccessMethods = [
  {
    id: "camt053",
    label: "CAMT.053 XML izvod",
    description: "Uvoz standardnog XML izvoda; EndToEndId ili Ustrd ide u referencu, Amt u iznos, a BookgDt/ValDt u datum.",
  },
  {
    id: "csv",
    label: "CSV izvod sa definisanim kolonama",
    description: "Uvoz samo nakon potvrde zaglavlja i mapiranja kolona za jedinstveni ID, referencu, iznos i datum.",
  },
  {
    id: "raiffeisen_open_banking",
    label: "Raiffeisen Open Banking API / OAuth",
    description: "Direktni API/OAuth pristup zahteva potvrđen Raiffeisen proizvod, dokumentaciju, scope-ove i endpoint ugovor.",
  },
  {
    id: "aggregator",
    label: "Imenovani bankarski agregator",
    description: "Agregator zahteva potvrđen naziv proizvoda, dokumentaciju, način autentikacije i mapiranje odgovora.",
  },
] as const;

export type EducationBankAccessMethod = typeof educationBankAccessMethods[number]["id"];

export const educationBankAccessMethodSchema = z.enum(
  educationBankAccessMethods.map(({ id }) => id) as [EducationBankAccessMethod, ...EducationBankAccessMethod[]],
);

export const educationBankRejectionReasons = {
  engineDisabled: "reconciliation_engine_disabled",
  accessUnconfirmed: "bank_access_method_unconfirmed",
  referenceNotFound: "payment_reference_not_found",
  amountMismatch: "received_amount_mismatch",
  obligationNotPending: "payment_obligation_not_pending",
} as const;

type EducationBankRejectionReason =
  typeof educationBankRejectionReasons[keyof typeof educationBankRejectionReasons];

type EducationBankTransaction = typeof educationBankTransactionsTable.$inferSelect;

export type EducationBankReconciliationResult = {
  transaction: EducationBankTransaction;
  duplicate: boolean;
};

type ReconciliationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const recordDecisionAudit = async (
  tx: ReconciliationTransaction,
  transaction: EducationBankTransaction,
) => {
  await writeEducationFinancialAuditInTx(tx, {
    actorUserId: null,
    action: "education_bank_transaction_processed",
    entityType: "education_bank_transaction",
    entityId: transaction.id,
    oldValue: { result: "processing" },
    newValue: {
      result: transaction.result,
      source: transaction.source,
      sourceItemId: transaction.sourceItemId,
      normalizedReference: transaction.normalizedReference,
      normalizedAmount: transaction.normalizedAmount,
      obligationId: transaction.obligationId,
      rejectionReason: transaction.rejectionReason,
    },
    reason: transaction.rejectionReason ?? "Normalizovana bankovna stavka je uparena i settlement je uspešno izvršen.",
  });
};

const rejectClaim = async (
  tx: ReconciliationTransaction,
  claim: EducationBankTransaction,
  reason: EducationBankRejectionReason,
  obligationId: string | null = null,
) => {
  const [rejected] = await tx.update(educationBankTransactionsTable).set({
    result: "rejected",
    rejectionReason: reason,
    obligationId,
    processedAt: new Date(),
  }).where(and(
    eq(educationBankTransactionsTable.id, claim.id),
    eq(educationBankTransactionsTable.result, "processing"),
  )).returning();
  if (!rejected) throw new Error("Bank reconciliation claim lost before rejection was recorded.");
  await recordDecisionAudit(tx, rejected);
  return rejected;
};

/**
 * Internal normalized-item boundary. No provider, bank API, scraping or OAuth
 * logic belongs here; future adapters may only submit this validated shape.
 */
export async function processNormalizedEducationBankTransaction(
  input: NormalizedEducationBankTransaction,
): Promise<EducationBankReconciliationResult> {
  const parsed = normalizedEducationBankTransactionSchema.parse(input);
  return db.transaction(async (tx) => {
    const [claim] = await tx.insert(educationBankTransactionsTable).values({
      source: parsed.source,
      sourceItemId: parsed.sourceItemId,
      normalizedReference: parsed.reference,
      normalizedAmount: parsed.amountRsd,
      result: "processing",
      receivedAt: parsed.receivedAt,
    }).onConflictDoNothing({
      target: [
        educationBankTransactionsTable.source,
        educationBankTransactionsTable.sourceItemId,
      ],
    }).returning();

    if (!claim) {
      const [existing] = await tx.select().from(educationBankTransactionsTable).where(and(
        eq(educationBankTransactionsTable.source, parsed.source),
        eq(educationBankTransactionsTable.sourceItemId, parsed.sourceItemId),
      )).limit(1);
      if (!existing) throw new Error("Duplicate bank transaction could not be reloaded.");
      return { transaction: existing, duplicate: true };
    }

    await lockEducationBillingRules(tx, "shared");
    const [settings] = await tx.select().from(educationPlatformSettingsTable)
      .orderBy(asc(educationPlatformSettingsTable.createdAt), asc(educationPlatformSettingsTable.id))
      .for("update")
      .limit(1);
    if (!settings?.bankReconciliationEnabled) {
      return {
        transaction: await rejectClaim(tx, claim, educationBankRejectionReasons.engineDisabled),
        duplicate: false,
      };
    }
    if (
      !settings.bankReconciliationAccessMethod
      || !settings.bankReconciliationAccessConfirmedAt
      || !settings.bankReconciliationAccessConfirmedByUserId
      || settings.bankReconciliationAccessMethod === "raiffeisen_open_banking"
    ) {
      return {
        transaction: await rejectClaim(tx, claim, educationBankRejectionReasons.accessUnconfirmed),
        duplicate: false,
      };
    }

    const [obligation] = await tx.select().from(educationPaymentObligationsTable)
      .where(eq(educationPaymentObligationsTable.referenceSnapshot, parsed.reference))
      .limit(1);
    if (!obligation) {
      return {
        transaction: await rejectClaim(tx, claim, educationBankRejectionReasons.referenceNotFound),
        duplicate: false,
      };
    }
    if (obligation.expectedAmount !== parsed.amountRsd) {
      return {
        transaction: await rejectClaim(tx, claim, educationBankRejectionReasons.amountMismatch, obligation.id),
        duplicate: false,
      };
    }

    const settlement = await settleEducationPaymentObligationInTransaction(tx, {
      obligationId: obligation.id,
      confirmedAmountRsd: parsed.amountRsd,
      actorUserId: null,
      reason: `Automatsko uparivanje normalizovane stavke ${parsed.source}:${parsed.sourceItemId}.`,
      source: "bank_reconciliation",
      bankTransactionId: claim.id,
    });
    if (!settlement.ok) {
      const reason = settlement.code === "AMOUNT_MISMATCH"
        ? educationBankRejectionReasons.amountMismatch
        : settlement.code === "ALREADY_SETTLED"
          ? educationBankRejectionReasons.obligationNotPending
          : educationBankRejectionReasons.referenceNotFound;
      return {
        transaction: await rejectClaim(tx, claim, reason, settlement.code === "NOT_FOUND" ? null : obligation.id),
        duplicate: false,
      };
    }

    const [settled] = await tx.update(educationBankTransactionsTable).set({
      result: "settled",
      rejectionReason: null,
      obligationId: settlement.obligation.id,
      processedAt: new Date(),
    }).where(and(
      eq(educationBankTransactionsTable.id, claim.id),
      eq(educationBankTransactionsTable.result, "processing"),
    )).returning();
    if (!settled) throw new Error("Bank reconciliation claim lost after settlement.");
    await recordDecisionAudit(tx, settled);
    return { transaction: settled, duplicate: false };
  });
}

export async function getEducationBankReconciliationStatus() {
  const [settings] = await db.select().from(educationPlatformSettingsTable)
    .orderBy(asc(educationPlatformSettingsTable.createdAt), asc(educationPlatformSettingsTable.id))
    .limit(1);
  const [latest] = await db.select().from(educationBankTransactionsTable)
    .orderBy(desc(educationBankTransactionsTable.processedAt), desc(educationBankTransactionsTable.createdAt))
    .limit(1);
  const enabled = settings?.bankReconciliationEnabled ?? false;
  const accessConfirmed = Boolean(
    settings?.bankReconciliationAccessMethod
    && settings.bankReconciliationAccessConfirmedAt
    && settings.bankReconciliationAccessConfirmedByUserId
    && settings.bankReconciliationAccessMethod !== "raiffeisen_open_banking",
  );
  return {
    enabled,
    engineState: !enabled
      ? "disabled" as const
      : accessConfirmed
        ? "ready_for_import" as const
        : "awaiting_access_confirmation" as const,
    bankConnectionConfigured: false,
    accessMethod: accessConfirmed ? settings!.bankReconciliationAccessMethod as EducationBankAccessMethod : null,
    accessConfirmed,
    accessConfirmedAt: accessConfirmed ? settings!.bankReconciliationAccessConfirmedAt : null,
    accessMethods: educationBankAccessMethods,
    lastProcessedAt: latest?.processedAt ?? null,
    lastResult: latest?.result === "settled" || latest?.result === "rejected" ? latest.result : null,
    lastRejectionReason: latest?.rejectionReason ?? null,
  };
}