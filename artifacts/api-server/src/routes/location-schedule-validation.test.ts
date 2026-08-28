import assert from "node:assert/strict";
import { validateLocationScheduleWindows } from "./marketplace";

function run(): void {
  assert.equal(validateLocationScheduleWindows([{
    weekday: 1, startTime: "09:00", endTime: "17:00", breakStart: "12:00", breakEnd: "12:30",
  }]), null);
  assert.match(validateLocationScheduleWindows([{ weekday: 1, startTime: "9:00", endTime: "17:00" }]) ?? "", /HH:mm/);
  assert.match(validateLocationScheduleWindows([{ weekday: 1, startTime: "17:00", endTime: "09:00" }]) ?? "", /Kraj radnog/);
  assert.match(validateLocationScheduleWindows([{ weekday: 1, startTime: "09:00", endTime: "17:00", breakStart: "12:00" }]) ?? "", /zajedno/);
  assert.match(validateLocationScheduleWindows([{ weekday: 1, startTime: "09:00", endTime: "17:00", breakStart: "08:30", breakEnd: "10:00" }]) ?? "", /u okviru/);
  assert.match(validateLocationScheduleWindows([
    { weekday: 1, startTime: "09:00", endTime: "12:00" },
    { weekday: 1, startTime: "11:00", endTime: "15:00" },
  ]) ?? "", /preklapati/);
}

run();