import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Response } from "express";
import { createBookingAdmissionGate } from "./booking-admission";

class FakeResponse extends EventEmitter {
  statusCode = 200;
  body: unknown;
  headers = new Map<string, string>();

  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(body: unknown) {
    this.body = body;
    this.emit("finish");
    return this;
  }
}

test("booking admission rejects excess work before the route handler runs", () => {
  const gate = createBookingAdmissionGate(1);
  const admitted = new FakeResponse();
  let downstreamWrites = 0;
  gate({} as never, admitted as unknown as Response, () => {
    downstreamWrites += 1;
  });

  const rejected = new FakeResponse();
  gate({} as never, rejected as unknown as Response, () => {
    downstreamWrites += 1;
  });
  assert.equal(rejected.statusCode, 429);
  assert.equal(rejected.headers.get("retry-after"), "2");
  assert.deepEqual(rejected.body, {
    code: "BOOKING_CAPACITY",
    error: "Sistem za zakazivanje je trenutno zauzet. Pokušajte ponovo za nekoliko trenutaka.",
  });
  assert.equal(downstreamWrites, 1, "rejected work must not reach any persistence handler");

  admitted.emit("finish");
  admitted.emit("close");
  const next = new FakeResponse();
  gate({} as never, next as unknown as Response, () => {
    downstreamWrites += 1;
  });
  assert.equal(downstreamWrites, 2, "finish/close release must be idempotent");
});

test("booking admission is a pass-through when production admission is disabled", () => {
  const gate = createBookingAdmissionGate(0);
  let handled = 0;
  for (let index = 0; index < 1_000; index += 1) {
    gate({} as never, new FakeResponse() as unknown as Response, () => {
      handled += 1;
    });
  }
  assert.equal(handled, 1_000);
});

test("every allocation-capable HTTP route uses the shared admission boundary", async () => {
  const marketplace = await readFile(new URL("../routes/marketplace.ts", import.meta.url), "utf8");
  const widget = await readFile(new URL("../routes/widget.ts", import.meta.url), "utf8");
  const marketplaceRoutes = [
    'post("/salon/booking-groups"',
    'post("/employee/booking-groups"',
    'post("/booking-groups"',
    'patch("/booking-groups/:bookingGroupId/reschedule"',
    'post("/appointments"',
    'patch("/appointments/:appointmentId"',
    'post("/salon/appointments"',
    'patch("/salon/appointments/:appointmentId"',
    'post("/salon/package-appointments"',
    'post("/salon/appointment-series"',
    'post("/salon/appointment-series/:seriesId/move"',
    'post("/employee/appointment-series"',
    'post("/employee/appointments"',
  ];
  for (const route of marketplaceRoutes) {
    const declaration = `router.${route}, admitBookingRequest,`;
    assert.ok(marketplace.includes(declaration), `${declaration} must use shared booking admission`);
  }
  for (const route of [
    'post("/widget/salons/:slug/appointments"',
    'post("/widget/salons/:slug/booking-groups"',
  ]) {
    const declaration = `router.${route}, admitBookingRequest,`;
    assert.ok(widget.includes(declaration), `${declaration} must use shared booking admission`);
  }
});