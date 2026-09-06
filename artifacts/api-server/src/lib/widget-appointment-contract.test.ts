import assert from "node:assert/strict";
import test from "node:test";
import {
  CreateAppointmentHeader,
  CreateBookingGroupHeader,
  CreateEmployeeAppointmentSeriesHeader,
  CreateEmployeeAppointmentsHeader,
  CreateEmployeeBookingGroupHeader,
  CreateSalonAppointmentHeader,
  CreateSalonAppointmentSeriesHeader,
  CreateSalonBookingGroupHeader,
  CreateSalonPackageAppointmentsHeader,
  CreateWidgetAppointmentHeader,
  CreateWidgetBookingGroupHeader,
} from "@workspace/api-zod";
import type { ZodType } from "zod";
import type { Request, Response } from "express";
import {
  BOOKING_IDEMPOTENCY_KEY_MAX_LENGTH,
  BOOKING_IDEMPOTENCY_KEY_MIN_LENGTH,
  BOOKING_IDEMPOTENCY_KEY_PATTERN,
  bookingIdempotencyKey,
} from "./booking-command";

const bookingPostOperations: ReadonlyArray<{
  operationId: string;
  headerSchema: ZodType;
}> = [
  { operationId: "createBookingGroup", headerSchema: CreateBookingGroupHeader },
  { operationId: "createSalonBookingGroup", headerSchema: CreateSalonBookingGroupHeader },
  { operationId: "createEmployeeBookingGroup", headerSchema: CreateEmployeeBookingGroupHeader },
  { operationId: "createAppointment", headerSchema: CreateAppointmentHeader },
  { operationId: "createSalonAppointment", headerSchema: CreateSalonAppointmentHeader },
  { operationId: "createSalonPackageAppointments", headerSchema: CreateSalonPackageAppointmentsHeader },
  { operationId: "createSalonAppointmentSeries", headerSchema: CreateSalonAppointmentSeriesHeader },
  { operationId: "createEmployeeAppointmentSeries", headerSchema: CreateEmployeeAppointmentSeriesHeader },
  { operationId: "createEmployeeAppointments", headerSchema: CreateEmployeeAppointmentsHeader },
  { operationId: "createWidgetAppointment", headerSchema: CreateWidgetAppointmentHeader },
  { operationId: "createWidgetBookingGroup", headerSchema: CreateWidgetBookingGroupHeader },
];

function runtimeResult(header: string | undefined) {
  let status = 200;
  let body: unknown;
  const req = {
    get(name: string) {
      assert.equal(name, "Idempotency-Key");
      return header;
    },
  } as Request;
  const res = {
    status(nextStatus: number) {
      status = nextStatus;
      return this;
    },
    json(nextBody: unknown) {
      body = nextBody;
      return this;
    },
  } as Response;

  return {
    key: bookingIdempotencyKey(req, res),
    get status() { return status; },
    get body() { return body; },
  };
}

test("documented booking POST idempotency headers match runtime validation", async (t) => {
  const validHeaders = [
    "!".repeat(BOOKING_IDEMPOTENCY_KEY_MIN_LENGTH),
    "booking:retry_123",
    "~".repeat(BOOKING_IDEMPOTENCY_KEY_MAX_LENGTH),
  ];
  const invalidHeaders = [
    undefined,
    "",
    "contains space",
    "č",
    "x".repeat(BOOKING_IDEMPOTENCY_KEY_MAX_LENGTH + 1),
  ];

  for (const { operationId, headerSchema } of bookingPostOperations) {
    await t.test(operationId, () => {
      for (const header of validHeaders) {
        assert.equal(
          BOOKING_IDEMPOTENCY_KEY_PATTERN.test(header),
          true,
          `${operationId}: runtime pattern fixture must be valid`,
        );
        assert.equal(
          headerSchema.safeParse({ "Idempotency-Key": header }).success,
          true,
          `${operationId}: OpenAPI rejected a runtime-valid Idempotency-Key`,
        );
        assert.deepEqual(
          runtimeResult(header),
          { key: header, status: 200, body: undefined },
          `${operationId}: runtime rejected a documented Idempotency-Key`,
        );
      }

      for (const header of invalidHeaders) {
        assert.equal(
          headerSchema.safeParse(
            header === undefined ? {} : { "Idempotency-Key": header },
          ).success,
          false,
          `${operationId}: OpenAPI accepted a runtime-invalid Idempotency-Key`,
        );
        assert.equal(
          runtimeResult(header).status,
          400,
          `${operationId}: runtime accepted an undocumented Idempotency-Key`,
        );
      }
    });
  }
});

test("booking request without Idempotency-Key returns the documented error", () => {
  assert.deepEqual(runtimeResult(undefined), {
    key: null,
    status: 400,
    body: {
      code: "IDEMPOTENCY_KEY_REQUIRED",
      error: "Pošaljite važeći Idempotency-Key za zahtev zakazivanja.",
    },
  });
});