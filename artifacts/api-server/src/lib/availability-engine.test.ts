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

const segmented = {
  ...base,
  durationMinutes: 60,
  preProcessingMinutes: 15,
  processingMinutes: 30,
  postProcessingMinutes: 15,
  employeeSchedules: [{ employeeId: "employee", weekday: 1, startTime: "09:00", endTime: "12:00", breakStart: "09:15", breakEnd: "09:45" }],
};
assert.ok(generateAvailability(segmented).some((slot) => slot.startTime === "09:00"),
  "the unattended processing interval may overlap an employee break");
assert.ok(!generateAvailability({
  ...segmented,
  timeOff: [{ employeeId: "employee", startDate: "2099-05-04", endDate: "2099-05-04", startTime: "09:45", endTime: "10:00" }],
}).some((slot) => slot.startTime === "09:00"),
  "time off must block the post-processing employee interval");
assert.ok(generateAvailability({
  ...segmented,
  employeeSchedules: [{ employeeId: "employee", weekday: 1, startTime: "09:00", endTime: "12:00" }],
  appointments: [{ employeeId: "employee", date: "2099-05-04", startTime: "09:15", endTime: "10:15", preProcessingMinutes: 15, processingMinutes: 30, postProcessingMinutes: 15 }],
}).some((slot) => slot.startTime === "09:30"),
  "processing-only overlap between segmented treatments must remain bookable");

const twoStaff = {
  ...base,
  employees: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
  employeeSchedules: [
    { employeeId: "a", weekday: 1, startTime: "09:00", endTime: "12:00" },
    { employeeId: "b", weekday: 1, startTime: "09:00", endTime: "12:00" },
    { employeeId: "c", weekday: 1, startTime: "09:00", endTime: "12:00" },
  ],
  requiredEmployeeCount: 2,
};
const twoStaffSlot = generateAvailability(twoStaff).find((slot) => slot.startTime === "09:00");
assert.deepEqual(twoStaffSlot?.employeeIds, ["a", "b"],
  "multi-staff availability deterministically allocates distinct employees");
assert.equal(new Set(twoStaffSlot?.employeeIds).size, 2);
assert.equal(generateAvailability({
  ...twoStaff,
  appointments: [{ employeeId: "b", date: "2099-05-04", startTime: "09:00", endTime: "09:45" }],
}).find((slot) => slot.startTime === "09:00")?.employeeIds[1], "c",
  "an unavailable participant is replaced by another distinct qualified employee");
assert.equal(generateAvailability({
  ...twoStaff,
  employees: twoStaff.employees.slice(0, 2),
  employeeSchedules: twoStaff.employeeSchedules.slice(0, 2),
  appointments: [{ employeeIds: ["b"], employeeId: "b", date: "2099-05-04", startTime: "09:00", endTime: "09:45" }],
}).some((slot) => slot.startTime === "09:00"), false,
  "a slot is rejected when fewer than the required distinct staff remain available");

assert.deepEqual(generateAvailability({
  ...twoStaff, employeeIds: ["a", null],
}).find((slot) => slot.startTime === "09:00")?.employeeIds, ["a", "b"],
  "legacy primary is an ordered alias, while null positions select from the full qualified pool");
assert.deepEqual(generateAvailability({
  ...twoStaff, employeeIds: ["a", "b"],
}).find((slot) => slot.startTime === "09:00")?.employeeIds, ["a", "b"],
  "an explicit complete assignment revalidates with its legacy primary alias");
assert.equal(generateAvailability({
  ...twoStaff, employeeIds: ["a", "b"],
  appointments: [{ employeeId: "b", date: "2099-05-04", startTime: "09:00", endTime: "09:45" }],
}).some((slot) => slot.startTime === "09:00"), false,
  "a busy explicitly selected secondary rejects the complete assignment");