import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentReminderGroupingKey,
  reviewInvitationSweepBounds,
} from "./appointment-customer-events";

test("reminder grouping deduplicates treatments per booking day", () => {
  const first = appointmentReminderGroupingKey({
    id: "appointment-1",
    bookingGroupId: "booking-group",
    date: "2026-03-10",
  });
  const sameDayTreatment = appointmentReminderGroupingKey({
    id: "appointment-2",
    bookingGroupId: "booking-group",
    date: "2026-03-10",
  });
  const nextDayTreatment = appointmentReminderGroupingKey({
    id: "appointment-3",
    bookingGroupId: "booking-group",
    date: "2026-03-11",
  });

  assert.equal(first, sameDayTreatment);
  assert.notEqual(first, nextDayTreatment);
});

test("ungrouped appointments retain independent reminder groups", () => {
  const first = appointmentReminderGroupingKey({
    id: "appointment-1",
    bookingGroupId: null,
    date: "2026-03-10",
  });
  const second = appointmentReminderGroupingKey({
    id: "appointment-2",
    bookingGroupId: null,
    date: "2026-03-10",
  });

  assert.notEqual(first, second);
});

test("review invitation catch-up is bounded even with unsafe caller limits", () => {
  assert.deepEqual(reviewInvitationSweepBounds(), { batchSize: 100, maxPages: 5 });
  assert.deepEqual(
    reviewInvitationSweepBounds({ batchSize: 10_000, maxPages: 10_000 }),
    { batchSize: 250, maxPages: 20 },
  );
  assert.deepEqual(
    reviewInvitationSweepBounds({ batchSize: 0, maxPages: -1 }),
    { batchSize: 1, maxPages: 1 },
  );
});