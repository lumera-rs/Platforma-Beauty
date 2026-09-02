import {
  CommitEducationCourseRecurrenceHeader,
  CreateEducationOperationalBookingHeader,
  CreateEducationGroupEnrollmentsHeader,
  EnrollInEducationCourseHeader,
  PurchaseEducationBundleHeader,
  PurchaseEducationGiftVoucherHeader,
  RescheduleEducationOperationalBookingHeader,
} from "@workspace/api-zod";
import type { ZodType } from "zod";

export const educationIdempotencyOperations = {
  commitEducationCourseRecurrence: CommitEducationCourseRecurrenceHeader,
  createEducationGroupEnrollments: CreateEducationGroupEnrollmentsHeader,
  createEducationOperationalBooking: CreateEducationOperationalBookingHeader,
  enrollInEducationCourse: EnrollInEducationCourseHeader,
  purchaseEducationBundle: PurchaseEducationBundleHeader,
  purchaseEducationGiftVoucher: PurchaseEducationGiftVoucherHeader,
  rescheduleEducationOperationalBooking: RescheduleEducationOperationalBookingHeader,
} satisfies Record<string, ZodType>;

export type EducationIdempotencyOperationId = keyof typeof educationIdempotencyOperations;

export function parseEducationIdempotencyKey(
  operationId: EducationIdempotencyOperationId,
  value: string | string[] | undefined,
) {
  const headerValue = Array.isArray(value) ? value[0] : value;
  const parsed = educationIdempotencyOperations[operationId].safeParse({
    "Idempotency-Key": headerValue,
  });
  return parsed.success
    ? { success: true as const, key: parsed.data["Idempotency-Key"] }
    : { success: false as const, error: parsed.error };
}