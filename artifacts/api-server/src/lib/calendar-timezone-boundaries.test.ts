import assert from "node:assert/strict";
import test from "node:test";
import { CreateAppointmentBody } from "@workspace/api-zod";
import { formatDateOnly, formatLocalDateOnly, parseLocalDateOnly } from "../../../beauty-marketplace/src/lib/date-only";
import { calendarDate, isValidCalendarDate } from "../routes/marketplace";
import { generateAvailability } from "./availability-engine";

const dateOnlyCases = [
  "2024-02-29", // leap day
  "2024-03-01",
  "2024-09-29", // Pacific/Auckland DST spring-forward date
  "2025-04-06", // Pacific/Auckland DST fall-back date
  "2024-12-31",
  "2025-01-01",
];

test("date-only helpers preserve local positive-offset DST and midnight calendar days", () => {
  for (const source of dateOnlyCases) {
    const local = parseLocalDateOnly(source);
    assert.ok(local, `${source} should be a valid local calendar date`);
    assert.equal(formatLocalDateOnly(local), source);
  }

  // API and PostgreSQL date columns use YYYY-MM-DD strings, never an instant.
  // The API boundary must receive the local formatter's date-only value rather
  // than Date#toISOString(), which would be the preceding day east of UTC.
  const serialized = formatLocalDateOnly(parseLocalDateOnly("2024-09-29")!);
  assert.equal(serialized, "2024-09-29");
  assert.equal(calendarDate(serialized!), "2024-09-29");
  assert.equal(formatDateOnly(new Date("2024-09-29T00:00:00.000Z"), "yyyy-MM-dd"), "2024-09-29");
});

test("booking API date guards reject impossible ISO dates while accepting leap day", () => {
  for (const impossible of ["2025-02-29", "2025-02-30", "2024-04-31", "2024-13-01", "2024-00-01"]) {
    assert.equal(parseLocalDateOnly(impossible), null, `${impossible} must not normalize locally`);
    assert.equal(isValidCalendarDate(impossible), false, `${impossible} must be rejected by booking routes`);
  }
  assert.equal(isValidCalendarDate("2024-02-29"), true);

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