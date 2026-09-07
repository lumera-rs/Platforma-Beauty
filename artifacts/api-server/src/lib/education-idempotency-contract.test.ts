import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ZodType } from "zod";
import {
  CommitEducationCourseRecurrenceHeader,
  CreateEducationGroupEnrollmentsHeader,
  CreateEducationOperationalBookingHeader,
  EnrollInEducationCourseHeader,
  PurchaseEducationBundleHeader,
  PurchaseEducationGiftVoucherHeader,
  RescheduleEducationOperationalBookingHeader,
} from "@workspace/api-zod";
import {
  educationIdempotencyOperations,
  parseEducationIdempotencyKey,
  type EducationIdempotencyOperationId,
} from "./education-idempotency";

const documentedOperations: ReadonlyArray<{
  operationId: EducationIdempotencyOperationId;
  headerSchema: ZodType;
}> = [
  { operationId: "createEducationOperationalBooking", headerSchema: CreateEducationOperationalBookingHeader },
  { operationId: "rescheduleEducationOperationalBooking", headerSchema: RescheduleEducationOperationalBookingHeader },
  { operationId: "commitEducationCourseRecurrence", headerSchema: CommitEducationCourseRecurrenceHeader },
  { operationId: "createEducationGroupEnrollments", headerSchema: CreateEducationGroupEnrollmentsHeader },
  { operationId: "enrollInEducationCourse", headerSchema: EnrollInEducationCourseHeader },
  { operationId: "purchaseEducationBundle", headerSchema: PurchaseEducationBundleHeader },
  { operationId: "purchaseEducationGiftVoucher", headerSchema: PurchaseEducationGiftVoucherHeader },
];

function sharedEducationIdempotencyOperationIds() {
  const openapiUrl = new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url);
  const lines = readFileSync(openapiUrl, "utf8").split("\n");
  const operationIds: string[] = [];
  let educationPath = false;
  let operationId: string | undefined;

  for (const line of lines) {
    if (/^  \//.test(line)) {
      educationPath = /^  \/education\//.test(line);
      operationId = undefined;
    } else if (/^      operationId: /.test(line)) {
      operationId = line.trim().slice("operationId: ".length);
    } else if (
      educationPath
      && operationId
      && line.includes("#/components/parameters/IdempotencyKey")
    ) {
      operationIds.push(operationId);
    }
  }

  return operationIds.sort();
}

test("every Education operation using the shared IdempotencyKey has a runtime contract entry", () => {
  const matrixOperationIds = documentedOperations.map(({ operationId }) => operationId).sort();
  assert.deepEqual(
    Object.keys(educationIdempotencyOperations).sort(),
    matrixOperationIds,
    "runtime Education Idempotency-Key map differs from the contract matrix",
  );
  assert.deepEqual(
    sharedEducationIdempotencyOperationIds(),
    matrixOperationIds,
    "OpenAPI Education operations using IdempotencyKey differ from the contract matrix",
  );
});

test("Education Idempotency-Key runtime validation matches generated OpenAPI headers", async (t) => {
  const cases: ReadonlyArray<{ label: string; value: string | undefined }> = [
    { label: "required", value: undefined },
    { label: "minLength rejected", value: "" },
    { label: "minLength accepted", value: "!" },
    { label: "pattern accepted", value: "education:retry_123~" },
    { label: "pattern rejects spaces", value: "contains space" },
    { label: "pattern rejects non-ASCII", value: "č" },
    { label: "maxLength accepted", value: "~".repeat(200) },
    { label: "maxLength rejected", value: "x".repeat(201) },
  ];

  for (const { operationId, headerSchema } of documentedOperations) {
    await t.test(operationId, () => {
      for (const { label, value } of cases) {
        const documented = headerSchema.safeParse(
          value === undefined ? {} : { "Idempotency-Key": value },
        );
        const runtime = parseEducationIdempotencyKey(operationId, value);
        assert.equal(
          runtime.success,
          documented.success,
          `${operationId}: ${label} differs between OpenAPI and runtime validation`,
        );
        if (runtime.success) {
          assert.equal(
            runtime.key,
            value,
            `${operationId}: ${label} changed the documented Idempotency-Key`,
          );
        }
      }
    });
  }
});