export type EducationDepositDisposition = "refund" | "forfeit" | "transfer";

/**
 * Resolve an existing booking strictly from its immutable snapshot. A null
 * deadline is the documented pre-v93 behavior.
 */
export function operationalCancellationDisposition(
  snapshottedDisposition: EducationDepositDisposition,
  cancellationDeadlineAt: Date | null,
  databaseNow: Date,
): EducationDepositDisposition {
  return cancellationDeadlineAt === null || databaseNow <= cancellationDeadlineAt
    ? snapshottedDisposition
    : "forfeit";
}

export function operationalRescheduleAllowed(
  cancellationDeadlineAt: Date | null,
  databaseNow: Date,
  centerStaffOverride: boolean,
): boolean {
  return centerStaffOverride || cancellationDeadlineAt === null || databaseNow <= cancellationDeadlineAt;
}

export function operationalPaymentTotals(
  grossAmount: number,
  installments: Array<{ status: string; amount: number; refundedAmount: number }>,
) {
  const capturedAmount = installments
    .filter((row) => row.status === "settled" || row.status === "refunded")
    .reduce((sum, row) => sum + row.amount, 0);
  const refundedAmount = installments.reduce((sum, row) => sum + row.refundedAmount, 0);
  return {
    capturedAmount,
    refundedAmount,
    netPaidAmount: Math.max(0, capturedAmount - refundedAmount),
    outstandingAmount: Math.max(0, grossAmount - capturedAmount),
  };
}