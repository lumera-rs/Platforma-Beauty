import assert from "node:assert/strict";
import test from "node:test";
import {
  CreateWidgetAppointmentHeader,
  CreateWidgetBookingGroupHeader,
} from "@workspace/api-zod";
import type { Request, Response } from "express";
import { bookingIdempotencyKey } from "./booking-command";

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

test("documented widget appointment idempotency header matches runtime validation", () => {
  const header = "widget-booking:retry_123";

  assert.equal(CreateWidgetAppointmentHeader.safeParse({
    "Idempotency-Key": header,
  }).success, true);
  assert.equal(CreateWidgetBookingGroupHeader.safeParse({
    "Idempotency-Key": header,
  }).success, true);
  assert.deepEqual(runtimeResult(header), {
    key: header,
    status: 200,
    body: undefined,
  });

  for (const invalidHeader of ["contains space", "č", "x".repeat(201)]) {
    assert.equal(CreateWidgetAppointmentHeader.safeParse({
      "Idempotency-Key": invalidHeader,
    }).success, false);
    assert.equal(CreateWidgetBookingGroupHeader.safeParse({
      "Idempotency-Key": invalidHeader,
    }).success, false);
    assert.equal(runtimeResult(invalidHeader).status, 400);
  }
});

test("widget appointment request without Idempotency-Key returns the documented error", () => {
  assert.equal(CreateWidgetAppointmentHeader.safeParse({}).success, false);
  assert.equal(CreateWidgetBookingGroupHeader.safeParse({}).success, false);
  assert.deepEqual(runtimeResult(undefined), {
    key: null,
    status: 400,
    body: {
      code: "IDEMPOTENCY_KEY_REQUIRED",
      error: "Pošaljite važeći Idempotency-Key za zahtev zakazivanja.",
    },
  });
});