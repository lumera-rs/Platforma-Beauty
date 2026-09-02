import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmployeeLeaveDraft,
  formatEmployeeLeaveRequestSummary,
  type EmployeeLeaveRequest,
} from "./employee-leave";

test("employee leave submission and portal rendering keep the API date field names", () => {
  const draft = {
    ...createEmployeeLeaveDraft("2026-09-10"),
    endDate: "2026-09-12",
    reason: "Godišnji odmor",
  };

  assert.deepEqual(draft, {
    startDate: "2026-09-10",
    endDate: "2026-09-12",
    reason: "Godišnji odmor",
  });
  assert.equal("from" in draft, false);
  assert.equal("to" in draft, false);

  const response: EmployeeLeaveRequest = {
    id: "leave-1",
    status: "pending",
    ...draft,
  };
  assert.equal(
    formatEmployeeLeaveRequestSummary(response),
    "2026-09-10 – 2026-09-12 · Godišnji odmor",
  );
});