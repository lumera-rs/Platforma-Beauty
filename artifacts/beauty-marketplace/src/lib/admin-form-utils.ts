/**
 * Shared admin form utilities — error extraction and numeric parsing.
 *
 * Rules:
 *  - extractApiError: handles generated ApiError.data shape AND plain fetch errors
 *    with structured { error, code, issues } bodies.
 *  - parseStrictInt / parseStrictDecimal: raw strings stay in state until submit;
 *    parsing happens on submit. Returns { ok, value } or { ok: false, message }.
 */

import { getApiErrorMessage } from "@workspace/api-client-react";

// ─── Error extraction ───────────────────────────────────────────────────────

/**
 * Extract a human-readable Serbian message from an unknown mutation error.
 * Works with:
 *   - generated ApiError (err.data.error)
 *   - plain Error rejections
 *   - structured { error, code, issues } bodies
 */
export function extractApiError(err: unknown, fallback = "Pokušajte ponovo."): string {
  return getApiErrorMessage(err, fallback);
}

// ─── Numeric parsing ────────────────────────────────────────────────────────

export type ParseResult<T extends number = number> =
  | { ok: true; value: T }
  | { ok: false; message: string };

interface IntOptions {
  /** Allow negative values (default: false) */
  allowNegative?: boolean;
  /** Allow zero (default: true) */
  allowZero?: boolean;
  min?: number;
  max?: number;
  /** Field label for error messages */
  label?: string;
}

interface DecimalOptions {
  allowNegative?: boolean;
  allowZero?: boolean;
  min?: number;
  max?: number;
  label?: string;
}

/**
 * Strictly parse a string as an integer.
 * Rejects: empty, whitespace-only, non-numeric text, NaN, Infinity,
 * non-integer (e.g. "1.5"), negative when disallowed, zero when disallowed,
 * range violations.
 */
export function parseStrictInt(raw: string, opts: IntOptions = {}): ParseResult<number> {
  const {
    allowNegative = false,
    allowZero = true,
    min,
    max,
    label = "Vrednost",
  } = opts;

  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, message: `${label} je obavezno polje.` };

  // Reject anything that isn't a plain integer string (optional sign + digits)
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, message: `${label} mora biti ceo broj.` };
  }

  const n = Number(trimmed);

  if (!Number.isFinite(n)) return { ok: false, message: `${label} mora biti ispravan broj.` };
  if (!Number.isInteger(n)) return { ok: false, message: `${label} mora biti ceo broj.` };

  if (!allowNegative && n < 0) return { ok: false, message: `${label} ne može biti negativan.` };
  if (!allowZero && n === 0) return { ok: false, message: `${label} mora biti veće od 0.` };

  if (min !== undefined && n < min) return { ok: false, message: `${label} mora biti najmanje ${min}.` };
  if (max !== undefined && n > max) return { ok: false, message: `${label} ne može biti veće od ${max}.` };

  return { ok: true, value: n };
}

/**
 * Strictly parse a string as a decimal number.
 * Rejects: empty, whitespace-only, non-numeric text, NaN, Infinity,
 * negative when disallowed, zero when disallowed, range violations.
 */
export function parseStrictDecimal(raw: string, opts: DecimalOptions = {}): ParseResult<number> {
  const {
    allowNegative = false,
    allowZero = true,
    min,
    max,
    label = "Vrednost",
  } = opts;

  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, message: `${label} je obavezno polje.` };

  // Reject anything that can't be a decimal (optional sign, digits, optional dot+digits)
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return { ok: false, message: `${label} mora biti broj.` };
  }

  const n = Number(trimmed);

  if (!Number.isFinite(n)) return { ok: false, message: `${label} mora biti ispravan broj.` };

  if (!allowNegative && n < 0) return { ok: false, message: `${label} ne može biti negativan.` };
  if (!allowZero && n === 0) return { ok: false, message: `${label} mora biti veće od 0.` };

  if (min !== undefined && n < min) return { ok: false, message: `${label} mora biti najmanje ${min}.` };
  if (max !== undefined && n > max) return { ok: false, message: `${label} ne može biti veće od ${max}.` };

  return { ok: true, value: n };
}
