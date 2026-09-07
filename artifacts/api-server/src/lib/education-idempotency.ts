import {
  CommitEducationCourseRecurrenceHeader,
  CreateEducationOperationalBookingHeader,
  CreateEducationGroupEnrollmentsHeader,
  EnrollInEducationCourseHeader,
  PurchaseEducationBundleHeader,
  PurchaseEducationGiftVoucherHeader,
  RescheduleEducationOperationalBookingHeader,
} from "@workspace/api-zod";
import type { ZodType, z } from "zod";

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

/**
 * Generic over the operation id so the returned key carries that operation's own
 * type. Most of these headers are required and yield `string`; the one that the
 * spec documents as optional (createEducationGroupEnrollments) yields
 * `string | undefined`, and its caller has to handle that rather than every
 * caller inheriting the widened union.
 */
export function parseEducationIdempotencyKey<Id extends EducationIdempotencyOperationId>(
  operationId: Id,
  value: string | string[] | undefined,
):
  | { success: true; key: z.infer<(typeof educationIdempotencyOperations)[Id]>["Idempotency-Key"] }
  | { success: false; error: z.ZodError } {
  const headerValue = Array.isArray(value) ? value[0] : value;
  const parsed = educationIdempotencyOperations[operationId].safeParse({
    "Idempotency-Key": headerValue,
  });
  return parsed.success
    ? { success: true as const, key: parsed.data["Idempotency-Key"] }
    : { success: false as const, error: parsed.error };
}