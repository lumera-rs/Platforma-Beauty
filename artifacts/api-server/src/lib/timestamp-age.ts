export function timestampAgeMinutes(
  value: unknown,
  now: Date,
): number | null {
  const parsed = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : null;

  if (!parsed || !Number.isFinite(parsed.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 60_000));
}