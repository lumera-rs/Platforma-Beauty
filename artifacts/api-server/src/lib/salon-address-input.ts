/** Trim only the four optional address details before generated validation.
 * Omitted means unchanged; blank/null means clear. Non-strings remain invalid.
 */
export const salonAddressDetailKeys = ["entranceDirections", "intercom", "floor", "apartment"] as const;

export function normalizeSalonAddressInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const result = { ...input } as Record<string, unknown>;
  for (const key of salonAddressDetailKeys) {
    if (typeof result[key] === "string") result[key] = result[key].trim() || null;
  }
  return result;
}