/**
 * Normalize a product swatch without weakening validation.
 *
 * Only a valid COLOR hex value is changed. Everything else, including
 * malformed COLOR values, is returned as-is so the existing validators can
 * continue to reject it.
 */
export function canonicalizeColorSwatch<T>(swatch: T): T {
  if (swatch === null || swatch === undefined || typeof swatch !== "object") return swatch;

  const candidate = swatch as { kind?: unknown; hex?: unknown };
  if (
    candidate.kind !== "COLOR"
    || typeof candidate.hex !== "string"
    || !/^#[0-9A-Fa-f]{6}$/.test(candidate.hex)
  ) {
    return swatch;
  }

  return { ...candidate, hex: candidate.hex.toUpperCase() } as T;
}