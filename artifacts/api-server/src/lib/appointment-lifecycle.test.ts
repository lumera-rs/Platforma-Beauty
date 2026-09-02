import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionAppointmentLifecycle,
  isAllowedLifecycleOccurredAt,
  isLateCancellation,
  zonedAppointmentInstant,
} from "./appointment-lifecycle";

const pending = { status: "pending" as const, arrivedAt: null, actualStartedAt: null };
const confirmed = { status: "confirmed" as const, arrivedAt: null, actualStartedAt: null };
const arrived = { ...confirmed, arrivedAt: new Date("2026-01-10T09:00:00Z") };
const started = { ...arrived, actualStartedAt: new Date("2026-01-10T09:05:00Z") };

test("appointment lifecycle enforces the canonical transition matrix", () => {
  assert.equal(canTransitionAppointmentLifecycle(pending, "confirm"), true);
  assert.equal(canTransitionAppointmentLifecycle(pending, "arrive"), false);
  assert.equal(canTransitionAppointmentLifecycle(confirmed, "arrive"), true);
  assert.equal(canTransitionAppointmentLifecycle(confirmed, "start"), false);
  assert.equal(canTransitionAppointmentLifecycle(arrived, "start"), true);
  assert.equal(canTransitionAppointmentLifecycle(arrived, "no-show"), false);
  assert.equal(canTransitionAppointmentLifecycle(started, "complete"), true);
  assert.equal(canTransitionAppointmentLifecycle(started, "cancel"), false);
  assert.equal(canTransitionAppointmentLifecycle(started, "no-show"), false);
  assert.equal(canTransitionAppointmentLifecycle(
    started,
    "complete",
    new Date("2026-01-10T09:04:59Z"),
  ), false, "completion cannot predate the audited start");
});

test("late-policy end instants use the salon timezone across DST", () => {
  assert.equal(zonedAppointmentInstant("2026-01-10", "12:00").toISOString(), "2026-01-10T11:00:00.000Z");
  assert.equal(zonedAppointmentInstant("2026-07-10", "12:00").toISOString(), "2026-07-10T10:00:00.000Z");
  assert.equal(isLateCancellation("2026-01-10", "12:00", 720, new Date("2026-01-09T22:59:59.999Z")), false);
  assert.equal(isLateCancellation("2026-01-10", "12:00", 720, new Date("2026-01-09T23:00:00.001Z")), true);
  assert.equal(isLateCancellation("2026-07-10", "12:00", 720, new Date("2026-07-09T21:59:59.999Z")), false);
  assert.equal(isLateCancellation("2026-07-10", "12:00", 720, new Date("2026-07-09T22:00:00.001Z")), true);
});

test("caller timestamps are restricted to a narrow server-time correction window", () => {
  const now = new Date("2026-01-10T10:00:00.000Z");
  assert.equal(isAllowedLifecycleOccurredAt(new Date("2026-01-10T10:04:59.999Z"), now), true);
  assert.equal(isAllowedLifecycleOccurredAt(new Date("2026-01-10T09:54:59.999Z"), now), false);
  assert.equal(isAllowedLifecycleOccurredAt(new Date("2026-01-10T10:05:00.001Z"), now), false);
});