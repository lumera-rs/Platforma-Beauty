export function safeIsoTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const date = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;

  if (!date || !Number.isFinite(date.getTime())) return null;

  try {
    return date.toISOString();
  } catch {
    return null;
  }
}
