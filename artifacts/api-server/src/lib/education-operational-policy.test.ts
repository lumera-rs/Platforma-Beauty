import assert from "node:assert/strict";
import test from "node:test";
import { educationLocalDatesTouched } from "./education-availability-store";
import {
  operationalCancellationDisposition,
  operationalRescheduleAllowed,
  operationalPaymentTotals,
} from "./education-operational-policy";

test("cancellation snapshot honors the exact inclusive boundary and ignores later course edits", () => {
  const deadline = new Date("2026-10-24T21:30:00.000Z");
  const immutableSnapshot = "transfer" as const;
  assert.equal(operationalCancellationDisposition(immutableSnapshot, deadline, new Date(deadline.getTime() - 1)), "transfer");
  assert.equal(operationalCancellationDisposition(immutableSnapshot, deadline, deadline), "transfer");
  assert.equal(operationalCancellationDisposition(immutableSnapshot, deadline, new Date(deadline.getTime() + 1)), "forfeit");
  // A hypothetical edited course policy is intentionally not an argument.
  assert.equal(operationalRescheduleAllowed(deadline, new Date(deadline.getTime() + 1), false), false);
  assert.equal(operationalRescheduleAllowed(deadline, new Date(deadline.getTime() + 1), true), true);
  assert.equal(operationalCancellationDisposition("refund", null, new Date("2030-01-01T00:00:00Z")), "refund");
});

test("payment totals do not subtract refunds from remaining capture twice", () => {
  assert.deepEqual(operationalPaymentTotals(10_000, [
    { status: "refunded", amount: 10_000, refundedAmount: 10_000 },
  ]), { capturedAmount: 10_000, refundedAmount: 10_000, netPaidAmount: 0, outstandingAmount: 0 });
  assert.deepEqual(operationalPaymentTotals(10_000, [
    { status: "settled", amount: 5_000, refundedAmount: 2_000 },
    { status: "pending", amount: 5_000, refundedAmount: 0 },
  ]), { capturedAmount: 5_000, refundedAmount: 2_000, netPaidAmount: 3_000, outstandingAmount: 5_000 });
});

test("overnight sessions touch both Belgrade dates, including DST transitions", () => {
  assert.deepEqual(
    educationLocalDatesTouched(new Date("2026-01-10T22:30:00Z"), new Date("2026-01-11T00:30:00Z")),
    ["2026-01-10", "2026-01-11"],
  );
  // Autumn overlap: both instants are valid and the occupied local dates are deterministic.
  assert.deepEqual(
    educationLocalDatesTouched(new Date("2026-10-24T21:30:00Z"), new Date("2026-10-25T02:30:00Z")),
    ["2026-10-24", "2026-10-25"],
  );
  // Spring gap crossed by an absolute interval.
  assert.deepEqual(
    educationLocalDatesTouched(new Date("2026-03-28T22:30:00Z"), new Date("2026-03-29T02:30:00Z")),
    ["2026-03-28", "2026-03-29"],
  );
});