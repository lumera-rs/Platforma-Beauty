import assert from "node:assert/strict";
import test from "node:test";
import { ReplaceSalonBookingSettingsBody } from "@workspace/api-zod";

const validSettings = {
  slotGranularityMinutes: 15,
  minimumLeadTimeMinutes: 60,
  cancellationDeadlineMinutes: 1440,
  reminderOffsetsMinutes: [120, 720, 1440],
  reminderChannels: ["sms", "email", "push"],
  maxVisitGapMinutes: 60,
  minimumUsefulLateTreatmentMinutes: 15,
  dateHours: [{
    date: new Date("2026-12-31T00:00:00.000Z"),
    closed: false,
    openTime: "10:00",
    closeTime: "14:00",
    reason: "Praznično radno vreme",
  }],
  resourceDowntime: [],
};

test("booking settings accept every supported cancellation, reminder, and channel choice", () => {
  for (const cancellationDeadlineMinutes of [720, 1440, 2880]) {
    assert.equal(ReplaceSalonBookingSettingsBody.safeParse({
      ...validSettings,
      cancellationDeadlineMinutes,
    }).success, true);
  }
});

test("booking settings reject unsupported cancellation and reminder values", () => {
  assert.equal(ReplaceSalonBookingSettingsBody.safeParse({
    ...validSettings,
    cancellationDeadlineMinutes: 60,
  }).success, false);
  assert.equal(ReplaceSalonBookingSettingsBody.safeParse({
    ...validSettings,
    reminderOffsetsMinutes: [60],
  }).success, false);
});

test("booking settings accept closed holidays and custom holiday hours", () => {
  assert.equal(ReplaceSalonBookingSettingsBody.safeParse({
    ...validSettings,
    dateHours: [{
      date: new Date("2027-01-01T00:00:00.000Z"),
      closed: true,
      openTime: null,
      closeTime: null,
      reason: "Nova godina",
    }, validSettings.dateHours[0]],
  }).success, true);
});