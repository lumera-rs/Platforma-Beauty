export type EmployeeLeaveRequest = {
  id: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
};

export type EmployeeLeaveDraft = Pick<EmployeeLeaveRequest, "startDate" | "endDate" | "reason">;

export function createEmployeeLeaveDraft(date: string): EmployeeLeaveDraft {
  return { startDate: date, endDate: date, reason: "" };
}

export function formatEmployeeLeaveRequestSummary(
  request: Pick<EmployeeLeaveRequest, "startDate" | "endDate" | "reason">,
): string {
  return `${request.startDate} – ${request.endDate} · ${request.reason}`;
}