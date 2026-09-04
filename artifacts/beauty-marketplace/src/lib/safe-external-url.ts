/**
 * Frontend mirror of the backend's safe-external-URL scheme allowlist
 * (artifacts/api-server/src/lib/safe-external-url.ts). Backend validation
 * at write time is authoritative for new data; this is defense-in-depth so
 * that a legacy or otherwise-unvalidated database value can never render
 * as a clickable javascript:/data:/... link or an unsafe media source,
 * regardless of how it got into the database.
 */

function isSafeExternalHttpUrl(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  if (trimmed === "") return true;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!parsed.hostname) return false;
  if (parsed.username || parsed.password) return false;
  return true;
}

/** Returns `url` unchanged if it is a safe, renderable external http(s) link; otherwise null. */
export function safeExternalHref(url: string | null | undefined): string | null {
  if (!url) return null;
  return isSafeExternalHttpUrl(url) ? url : null;
}
