import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

const courseSchema = z.object({
  title: z.string().min(2, "Naslov mora imati bar 2 karaktera"),
  price: z.coerce.number().min(0, "Cena ne može biti negativna"),
  durationMinutes: z.coerce.number().int().min(1).max(5256000).optional().nullable(),
  format: z.enum(["online", "in-person", "hybrid"]),
  paymentMode: z.enum(["online_full", "live_deposit", "live_off_platform"]),
  depositAmount: z.coerce.number().optional().nullable(),
  refundPolicy: z.string().optional(),
}).refine(
  (data) => data.paymentMode !== "live_deposit" || (data.depositAmount && data.depositAmount > 0 && data.depositAmount <= data.price),
  { message: "Depozit mora biti veći od nule i manji od ukupne cene.", path: ["depositAmount"] }
).refine(
  (data) => data.paymentMode !== "live_deposit" || (!!data.refundPolicy && data.refundPolicy.trim().length > 0),
  { message: "Politika povraćaja je obavezna za opciju 'Uživo (Depozit)'.", path: ["refundPolicy"] }
).refine(
  (data) => data.paymentMode !== "live_off_platform" || data.format !== "online",
  { message: "Plaćanje uživo je dozvoljeno samo za kurseve koji se održavaju uživo ili hibridno.", path: ["paymentMode"] }
).refine(
  (data) => data.format !== "online" || data.paymentMode === "online_full",
  { message: "Online kursevi zahtevaju potpuno online plaćanje.", path: ["paymentMode"] }
);

test("Course Schema Validation - should fail if live_deposit is used without refundPolicy", () => {
  const result = courseSchema.safeParse({
    title: "Test Course",
    price: 1000,
    format: "in-person",
    paymentMode: "live_deposit",
    depositAmount: 500,
    refundPolicy: "",
  });
  
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some(issue => issue.path.includes("refundPolicy")));
  }
});

test("Course Schema Validation - should pass if live_deposit is used with refundPolicy", () => {
  const result = courseSchema.safeParse({
    title: "Test Course",
    price: 1000,
    format: "in-person",
    paymentMode: "live_deposit",
    depositAmount: 500,
    refundPolicy: "No refunds after start",
  });
  
  assert.equal(result.success, true);
});

test("Course Schema Validation - should enforce valid deposit amount ranges", () => {
  const result = courseSchema.safeParse({
    title: "Test Course",
    price: 1000,
    format: "in-person",
    paymentMode: "live_deposit",
    depositAmount: 1500, // greater than price
    refundPolicy: "Policy",
  });
  
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some(issue => issue.path.includes("depositAmount")));
  }
});

test("Course Schema Validation - should enforce durationMinutes is within boundaries", () => {
  const result = courseSchema.safeParse({
    title: "Test Course",
    price: 1000,
    format: "online",
    paymentMode: "online_full",
    durationMinutes: 0, // less than 1
  });
  
  assert.equal(result.success, false);
});
