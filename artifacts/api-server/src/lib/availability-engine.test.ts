import assert from "node:assert/strict";
import { generateAvailability, type GenerateAvailabilityInput } from "./availability-engine";

const base: GenerateAvailabilityInput = {
  dates: ["2099-05-04"],
  durationMinutes: 45,
  granularityMinutes: 15,
  employees: [{ id: "employee", name: "Employee" }],
  salonHours: [{ weekday: 1, startTime: "09:00", endTime: "12:00" }],
  employeeSchedules: [{ employeeId: "employee", weekday: 1, startTime: "09:30", endTime: "12:00" }],
  timeOff: [],
  appointments: [],
  resourceRequirements: [],
  resourceAllocations: [],
};

assert.deepEqual(generateAvailability(base).map((slot) => slot.startTime),
  ["09:30", "09:45", "10:00", "10:15", "10:30", "10:45", "11:00", "11:15"]);

assert.deepEqual(generateAvailability({
  ...base,
  bufferMinutes: 15,
  appointments: [{ employeeId: "employee", date: "2099-05-04", startTime: "10:30", endTime: "11:15" }],
}).map((slot) => slot.startTime), ["09:30"]);

assert.ok(generateAvailability({
  ...base,
  bufferMinutes: 15,
  resourceRequirements: [{ resourceId: "room", quantity: 1, capacity: 1, active: true }],
  resourceAllocations: [{ resourceId: "room", quantity: 1, date: "2099-05-04", startTime: "10:30", endTime: "11:15" }],
}).every((slot) => slot.startTime <= "09:30" || slot.startTime >= "11:30"),
  "resource buffer must block the resource rather than extending employee occupancy");

assert.equal(generateAvailability({
  ...base,
  dateOverrides: [{ date: "2099-05-04", closed: true }],
}).length, 0);

assert.deepEqual(generateAvailability({
  ...base,
  dateOverrides: [{
    date: "2099-05-04",
    startTime: "10:00",
    endTime: "11:00",
    closed: false,
  }],
}).map((slot) => slot.startTime), ["10:00", "10:15"],
  "custom date hours must replace, rather than augment, the weekly hours");

assert.deepEqual(generateAvailability({
  ...base,
  granularityMinutes: 30,
}).map((slot) => slot.startTime), ["09:30", "10:00", "10:30", "11:00"],
  "configured granularity must determine the generated cadence");

assert.deepEqual(generateAvailability({
  ...base,
  now: { date: "2099-05-04", time: "09:20" },
  minimumLeadTimeMinutes: 55,
}).map((slot) => slot.startTime), ["10:15", "10:30", "10:45", "11:00", "11:15"],
  "minimum lead time must suppress slots before the effective cutoff");

assert.ok(generateAvailability({
  ...base,
  resourceRequirements: [{ resourceId: "room", quantity: 1, capacity: 1, active: true }],
  resourceDowntime: [{ resourceId: "room", date: "2099-05-04", startTime: "10:00", endTime: "11:00" }],
}).every((slot) => slot.endTime <= "10:00" || slot.startTime >= "11:00"),
  "resource downtime must block every overlapping resource-backed slot");