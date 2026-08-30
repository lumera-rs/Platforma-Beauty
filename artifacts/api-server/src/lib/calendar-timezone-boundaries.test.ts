import assert from "node:assert/strict";
import test from "node:test";
import { CreateAppointmentBody } from "@workspace/api-zod";
import { calendarDate, isValidCalendarDate } from "../routes/marketplace";
import { generateAvailability } from "./availability-engine";

test("booking API date guards reject impossible ISO dates while accepting leap day", () => {
  for (const impossible of ["2025-02-29", "2025-02-30", "2024-04-31", "2024-13-01", "2024-00-01"]) {
    assert.equal(isValidCalendarDate(impossible), false, `${impossible} must be rejected by booking routes`);
  }
  assert.equal(isValidCalendarDate("2024-02-29"), true);
  assert.equal(calendarDate("2024-02-29"), "2024-02-29");

  // Generated date coercion intentionally accepts ISO date input, so the route
  // guard above is the authoritative validation before calendarDate persists it.
  assert.equal(CreateAppointmentBody.safeParse({
    salonId: "salon", serviceId: "service", date: "2024-02-29", startTime: "10:00",
  }).success, true);
  assert.equal(CreateAppointmentBody.safeParse({
    salonId: "salon", serviceId: "service", date: "2025-02-30", startTime: "10:00",
  }).success, true, "route validation is required because date coercion normalizes impossible input");
});

test("availability suppresses past slots across midnight and year rollover", () => {
  const slots = generateAvailability({
    dates: ["2024-12-31", "2025-01-01"],
    durationMinutes: 15,
    granularityMinutes: 15,
    employees: [{ id: "employee", name: "Employee" }],
    salonHours: Array.from({ length: 7 }, (_, index) => ({
      weekday: index, startTime: "00:00", endTime: "01:00",
    })),
    employeeSchedules: Array.from({ length: 7 }, (_, index) => ({
      employeeId: "employee", weekday: index, startTime: "00:00", endTime: "01:00",
    })),
    timeOff: [],
    appointments: [],
    resourceRequirements: [],
    resourceAllocations: [],
    now: { date: "2024-12-31", time: "23:50" },
    minimumLeadTimeMinutes: 20,
  });

  assert.deepEqual(slots.map((slot) => `${slot.date} ${slot.startTime}`), [
    "2025-01-01 00:15",
    "2025-01-01 00:30",
    "2025-01-01 00:45",
  ]);
});