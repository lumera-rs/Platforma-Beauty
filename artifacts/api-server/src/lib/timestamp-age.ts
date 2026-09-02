export function timestampAgeMinutes(
  value: Date | string | null,
  now: Date,
): number | null {
  const parsed = value instanceof Date
    ? value
    : value === null
      ? null
      : new Date(value);

  if (!parsed || !Number.isFinite(parsed.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 60_000));
}