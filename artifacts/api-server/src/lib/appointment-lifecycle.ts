export type AppointmentLifecycleAction = "confirm" | "arrive" | "start" | "complete" | "cancel" | "no-show";

export type AppointmentLifecycleState = {
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no-show";
  arrivedAt: Date | null;
  actualStartedAt: Date | null;
  createdAt?: Date;
  confirmedAt?: Date | null;
};

export function canTransitionAppointmentLifecycle(
  state: AppointmentLifecycleState,
  action: AppointmentLifecycleAction,
  occurredAt?: Date,
): boolean {
  if (occurredAt && state.createdAt && occurredAt < state.createdAt) return false;
  if (occurredAt && action === "arrive" && state.confirmedAt && occurredAt < state.confirmedAt) return false;
  if (occurredAt && action === "start" && state.arrivedAt && occurredAt < state.arrivedAt) return false;
  if (occurredAt && action === "complete" && state.actualStartedAt && occurredAt < state.actualStartedAt) return false;
  if (action === "confirm") return state.status === "pending";
  if (action === "arrive") return state.status === "confirmed" && !state.arrivedAt && !state.actualStartedAt;
  if (action === "start") return state.status === "confirmed" && Boolean(state.arrivedAt) && !state.actualStartedAt;
  if (action === "complete") return state.status === "confirmed" && Boolean(state.actualStartedAt);
  if (action === "cancel") return (state.status === "pending" || state.status === "confirmed") && !state.arrivedAt && !state.actualStartedAt;
  return (state.status === "pending" || state.status === "confirmed") && !state.arrivedAt && !state.actualStartedAt;
}

export function isAllowedLifecycleOccurredAt(occurredAt: Date, serverNow: Date, correctionWindowMs = 5 * 60_000): boolean {
  return Math.abs(occurredAt.getTime() - serverNow.getTime()) <= correctionWindowMs;
}

/** Converts a salon calendar date/time to its real instant, including DST. */
export function zonedAppointmentInstant(date: string, time: string): Date {
  const desired = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(time.slice(0, 2)),
    Number(time.slice(3, 5)),
  );
  let result = desired;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Belgrade",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(result));
    const value = (kind: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === kind)?.value);
    const represented = Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
    );
    result += desired - represented;
  }
  return new Date(result);
}