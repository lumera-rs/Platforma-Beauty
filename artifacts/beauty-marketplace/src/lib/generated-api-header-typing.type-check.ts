/**
 * Compile-time-only regression coverage for Task #4C: a required OpenAPI
 * header parameter (e.g. Idempotency-Key) must be a compile-time-required
 * argument on the generated API-client call, an optional header must stay
 * optional, and an operation with no header parameters must be unaffected.
 *
 * This file is never imported or executed at runtime -- it exists purely
 * so `tsc` type-checks it. It deliberately keeps a `.type-check.ts`
 * extension rather than `.test.ts`: this project's tsconfig excludes
 * `**\/*.test.ts` from the ordinary marketplace typecheck
 * (scripts/test-marketplace-typecheck.sh), since those run at runtime via
 * the node test runner instead, but a `**\/*` include still picks up this
 * extension, which is exactly what a type-only assertion needs to be
 * enforced by.
 *
 * A call that must fail to compile is marked `@ts-expect-error`. If the
 * marked line does NOT actually produce an error, that directive itself
 * becomes a compile error ("Unused '@ts-expect-error' directive"), so the
 * whole marketplace typecheck fails loudly the moment required-header
 * enforcement regresses -- e.g. if `orval.config.ts`'s `output.headers`
 * flag were ever removed, or an operation's OpenAPI `required: true`
 * header parameter were loosened by mistake.
 */
import {
  checkoutEducationB2bOrder,
  createEducationGroupEnrollments,
  upsertCustomerSalonReview,
  type EducationB2bCheckoutInput,
  type EducationGroupEnrollmentInput,
  type CustomerReviewInput,
} from "@workspace/api-client-react";

declare const checkoutBody: EducationB2bCheckoutInput;
declare const groupEnrollmentBody: EducationGroupEnrollmentInput;
declare const reviewBody: CustomerReviewInput;

// 1. Calling an endpoint with a required header and providing that header typechecks.
void checkoutEducationB2bOrder(checkoutBody, { "Idempotency-Key": "test-key" });

// 2. Calling the same endpoint without that header fails TypeScript validation.
// @ts-expect-error Idempotency-Key is a required OpenAPI header for this operation.
void checkoutEducationB2bOrder(checkoutBody);

// 3. Optional request options (AbortSignal, credentials, ...) still typecheck
// alongside the required header -- strong typing did not remove RequestInit access.
void checkoutEducationB2bOrder(
  checkoutBody,
  { "Idempotency-Key": "test-key" },
  { signal: new AbortController().signal, credentials: "include" },
);

// 4. An operation whose header is documented as optional (required: false in
// the spec, e.g. createEducationGroupEnrollments's Idempotency-Key) accepts a
// call with the header omitted entirely...
void createEducationGroupEnrollments("course-id", groupEnrollmentBody);
// ...and also accepts one with the header explicitly supplied.
void createEducationGroupEnrollments("course-id", groupEnrollmentBody, { "Idempotency-Key": "test-key" });

// 5. Endpoints without any declared header parameters are unaffected: no new
// required `headers` argument is forced onto them, and the call shape used
// throughout the rest of the app keeps working exactly as before.
void upsertCustomerSalonReview("salon-id", reviewBody);
