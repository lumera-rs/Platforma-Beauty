import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  educationBelgradeDateKey,
  educationBelgradeTime,
  educationBookingCtaVisible,
  educationCancellationReasonValid,
} from "./education-operational-time";

test("education operations use Belgrade date when UTC is still previous day", () => {
  const instant = new Date("2026-06-20T22:30:00.000Z");
  assert.equal(educationBelgradeDateKey(instant), "2026-06-21");
  assert.equal(educationBelgradeTime(instant), "00:30");
});

test("operational CTA eligibility is independent of legacy purchase state", () => {
  assert.equal(educationBookingCtaVisible({ hasFutureSession: true, hasNextAvailable: false, isAdmin: false, isPublisher: false }), true);
  assert.equal(educationBookingCtaVisible({ hasFutureSession: false, hasNextAvailable: true, isAdmin: false, isPublisher: false }), true);
  assert.equal(educationBookingCtaVisible({ hasFutureSession: true, hasNextAvailable: false, isAdmin: false, isPublisher: true }), false);
});

test("operational cancellation requires a meaningful trimmed reason", () => {
  for (const reason of ["", "   ", "ab", " a ", "x".repeat(1001)]) assert.equal(educationCancellationReasonValid(reason), false);
  for (const reason of ["abc", "  abc  ", "razlog"]) assert.equal(educationCancellationReasonValid(reason), true);
  const source = readFileSync(new URL("../components/education/operational-purchases.tsx", import.meta.url), "utf8");
  assert.match(source, /reason:\s*cancelReason\.trim\(\)/);
  assert.match(source, /cancelReasonIsValid\s*=\s*educationCancellationReasonValid\(cancelReason\)/);
  assert.match(source, /disabled=\{cancelMut\.isPending\s*\|\|\s*!cancelReasonIsValid\}/);
  assert.match(source, /if\s*\(!cancelModal\s*\|\|\s*!cancelReasonIsValid\)\s*return/);
});

test("booking success renders only authoritative IPS endpoint fields", () => {
  const source = readFileSync(new URL("../components/education/booking-flow.tsx", import.meta.url), "utf8");
  assert.match(source, /useGetEducationOperationalInstallmentIpsQr/);
  for (const field of ["recipientName", "recipientAccount", "purpose", "reference", "amount", "payload"]) {
    assert.match(source, new RegExp(`ips\\.data\\.${field}`));
  }
  assert.doesNotMatch(source, /K:PR\|V:01|simplified payload|toFixed\(2\).*replace/);
});

test("operational booking callers preserve identity, idempotency, and legacy fallback", () => {
  const flow = readFileSync(new URL("../components/education/booking-flow.tsx", import.meta.url), "utf8");
  const marketplace = readFileSync(new URL("../pages/education-marketplace.tsx", import.meta.url), "utf8");
  const center = readFileSync(new URL("../components/education/center-operations.tsx", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../pages/admin/education-marketplace.tsx", import.meta.url), "utf8");
  assert.match(flow, /userId:\s*currentUser\?\.user\?\.id/);
  assert.match(flow, /userId:\s*null,\s*fullName/);
  assert.match(marketplace, /useState\(\(\) => crypto\.randomUUID\(\)\)/);
  assert.match(center, /guestBookingKey/);
  assert.doesNotMatch(marketplace, /useCreateEducationOperationalBooking\(\{ request: \{ headers: \{ "Idempotency-Key": crypto\.randomUUID\(\)/);
  assert.doesNotMatch(center, /useCreateEducationOperationalBooking\(\{ request: \{ headers: \{ "Idempotency-Key": crypto\.randomUUID\(\)/);
  assert.match(marketplace, /data-testid="legacy-enrollment-cta"/);
  assert.match(admin, /ins\.dueAt\s*\?.*:\s*"Nema roka"/s);
});

test("LMS view keeps hooks above loading and empty-state returns", () => {
  const source = readFileSync(new URL("../pages/business-education.tsx", import.meta.url), "utf8");
  const componentStart = source.indexOf("function LmsView");
  const memoIndex = source.indexOf("const activeLesson = useMemo", componentStart);
  const loadingReturnIndex = source.indexOf("if (isLoading) return", componentStart);
  assert.ok(componentStart >= 0 && memoIndex > componentStart && loadingReturnIndex > memoIndex);
});