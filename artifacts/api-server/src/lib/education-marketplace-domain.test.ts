import assert from "node:assert/strict";
import {
  addEducationBelgradeCalendarDays,
  educationBelgradeDateKey,
  educationIpsQrPayload,
  educationPaymentModeError,
  educationGiftVoucherRecipientMatches,
  educationRelatedCourseTier,
  formatEducationIpsAmount,
  normalizedEducationTaxonomyName,
  qualifiesAsMostRequestedEducationCenter,
  qualifiesAsTopRatedEducationCenter,
  type EducationIpsTransactionType,
} from "./education-marketplace-domain";
import { educationGraceDaysRemaining } from "./education-subscription-reactivation";
import {
  addEducationBelgradeCalendarMonths,
  addEducationBelgradeDateDays,
  assertEducationBelgradeDate,
  educationBelgradeCalendarDayDifference,
  educationBelgradeWallClockInstant,
} from "./education-belgrade-calendar";

assert.equal(educationPaymentModeError({
  format: "online", paymentMode: "online_full", depositAmount: null, price: 10_000,
}), null);
assert.match(educationPaymentModeError({
  format: "online", paymentMode: "live_deposit", depositAmount: 1_000, price: 10_000,
}) ?? "", /Online/);
assert.equal(educationPaymentModeError({
  format: "in-person", paymentMode: "live_deposit", depositAmount: 1_000, price: 10_000,
}), null);
assert.match(educationPaymentModeError({
  format: "hybrid", paymentMode: "live_deposit", depositAmount: 11_000, price: 10_000,
}) ?? "", /Depozit/);
assert.equal(educationPaymentModeError({
  format: "in-person", paymentMode: "live_off_platform", depositAmount: null, price: 10_000,
}), null);

assert.equal(formatEducationIpsAmount(1500.5), "RSD1500,50");
assert.equal(formatEducationIpsAmount(1500), "RSD1500,00");
assert.throws(() => formatEducationIpsAmount(1500.501), /IPS_PAYMENT_AMOUNT_INVALID/);
for (const transactionType of [
  "subscription",
  "course_enrollment",
  "course_extension",
  "operational_installment",
  "bundle_purchase",
  "placement",
] satisfies EducationIpsTransactionType[]) {
  const ips = educationIpsQrPayload({
    recipientName: "LUMERA",
    recipientAccount: "111111111111111111",
    purpose: "Education uplata",
    amount: 1500.5,
    reference: `TEST-${transactionType}`,
    recipientType: "platform",
    transactionType,
    accountEnvironment: "test",
    runtimeEnvironment: "test",
  });
  assert.match(ips.payload, /\|I:RSD1500,50\|/, `${transactionType} uses the canonical NBS amount field`);
}

assert.equal(normalizedEducationTaxonomyName("  Master   KLASA  "), "master klasa");
assert.equal(
  normalizedEducationTaxonomyName("Ｍａｓｔｅｒ KLASA"),
  normalizedEducationTaxonomyName("Master   klasa"),
);

assert.equal(
  educationBelgradeDateKey(new Date("2026-08-30T22:30:00.000Z")),
  "2026-08-31",
  "rotation switches at Belgrade midnight rather than UTC midnight",
);
assert.equal(
  addEducationBelgradeCalendarDays(new Date("2026-03-28T11:00:00.000Z"), 1).toISOString(),
  "2026-03-29T10:00:00.000Z",
  "a Belgrade calendar day across spring-forward is 23 elapsed hours",
);
assert.equal(
  addEducationBelgradeCalendarDays(new Date("2026-10-24T10:00:00.000Z"), 1).toISOString(),
  "2026-10-25T11:00:00.000Z",
  "a Belgrade calendar day across fall-back is 25 elapsed hours",
);
assert.equal(
  educationGraceDaysRemaining(
    new Date("2026-03-28T11:00:00.000Z"),
    addEducationBelgradeCalendarDays(new Date("2026-03-28T11:00:00.000Z"), 5),
  ),
  5,
  "grace warnings count Belgrade calendar dates across spring-forward rather than elapsed 24-hour blocks",
);
assert.equal(
  educationGraceDaysRemaining(
    new Date("2026-10-24T10:00:00.000Z"),
    addEducationBelgradeCalendarDays(new Date("2026-10-24T10:00:00.000Z"), 5),
  ),
  5,
  "grace warnings count Belgrade calendar dates across fall-back rather than elapsed 24-hour blocks",
);
assert.equal(addEducationBelgradeDateDays("2025-12-31", 1), "2026-01-01", "date-key arithmetic crosses a year boundary");
assert.equal(educationBelgradeCalendarDayDifference("2025-12-31", "2026-01-01"), 1);
assert.equal(
  educationBelgradeDateKey(addEducationBelgradeCalendarMonths(new Date("2025-01-30T11:00:00Z"), 1)),
  "2025-02-28",
  "month-end billing dates clamp to the destination calendar month",
);
assert.throws(() => assertEducationBelgradeDate("2026-02-29"), /ne postoji/);
assert.throws(
  () => educationBelgradeWallClockInstant("2026-03-29", "02:30"),
  /ne postoji u vremenskoj zoni/,
  "the spring-forward gap cannot silently become another wall-clock time",
);

assert.equal(qualifiesAsMostRequestedEducationCenter(9), false);
assert.equal(qualifiesAsMostRequestedEducationCenter(10), true);
assert.equal(qualifiesAsTopRatedEducationCenter(4), false);
assert.equal(qualifiesAsTopRatedEducationCenter(5), true);

const relatedSource = { subcategoryId: "nails", tags: [" Nail Art ", "Gel"] };
assert.equal(educationRelatedCourseTier(relatedSource, { subcategoryId: "nails", tags: [] }), 0);
assert.equal(educationRelatedCourseTier(relatedSource, { subcategoryId: "other", tags: ["nail art"] }), 1);
assert.equal(
  educationRelatedCourseTier(relatedSource, { subcategoryId: "other", tags: ["ＮＡＩＬ\t  ＡＲＴ"] }),
  1,
  "related tags share canonical NFKC, collapsed whitespace and case normalization",
);
assert.equal(educationRelatedCourseTier(relatedSource, { subcategoryId: "other", tags: ["massage"] }), null);

const recipient = { id: "recipient", email: "Learner@Example.com" };
assert.equal(educationGiftVoucherRecipientMatches(
  { recipientUserId: "recipient", recipientEmail: "learner@example.com" }, recipient,
), true);
assert.equal(educationGiftVoucherRecipientMatches(
  { recipientUserId: "other", recipientEmail: "learner@example.com" }, recipient,
), false);
assert.equal(educationGiftVoucherRecipientMatches(
  { recipientUserId: null, recipientEmail: null }, recipient,
), false);