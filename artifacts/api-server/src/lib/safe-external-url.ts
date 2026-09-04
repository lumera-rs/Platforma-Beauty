/**
 * Shared validator for database-backed fields that are later rendered as an
 * external link or media source (href, <video src>, iframe src, etc.).
 *
 * Rejects anything other than absolute http:/https: URLs -- javascript:,
 * data:, vbscript:, file:, blob:, custom app schemes, and protocol-relative
 * "//host" values (which have no explicit scheme at all) are all rejected.
 * Uses the WHATWG URL parser for scheme/host extraction rather than a
 * string-prefix regex, so case, IDNA hostnames, and query/fragment parts
 * are handled the same way a browser would handle them.
 */

const SAFE_EXTERNAL_URL_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * True when `value` is missing (null/undefined/empty/whitespace-only -- "no
 * URL provided") or is a syntactically valid absolute http(s) URL with a
 * non-empty host and no embedded userinfo (credentials). False for anything
 * else, including malformed URLs and any other scheme.
 *
 * Callers that require a URL to be present must check for emptiness
 * themselves; this function only judges "is this a safe URL to store and
 * later navigate to / embed", not "is a URL required here".
 */
export function isSafeExternalHttpUrl(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  if (trimmed === "") return true;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (!SAFE_EXTERNAL_URL_PROTOCOLS.has(parsed.protocol)) return false;
  if (!parsed.hostname) return false;
  if (parsed.username || parsed.password) return false;
  return true;
}
