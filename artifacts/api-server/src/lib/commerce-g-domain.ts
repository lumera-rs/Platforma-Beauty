export const PRODUCT_DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

/** Validates both declaration/extension and the non-spoofable container signature. */
export function isSupportedProductDocument(name: string, contentType: string, bytes: Uint8Array): boolean {
  const lower = name.toLowerCase();
  return contentType === "application/pdf" && lower.endsWith(".pdf")
    ? Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-"
    : contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && lower.endsWith(".docx")
      ? bytes[0] === 0x50 && bytes[1] === 0x4b
      : false;
}

/** Mirrors the public API bound before a search term reaches SQL. */
export function boundedSearchTerm(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 100).toLowerCase() : "";
}

export function isAllowedBestsellerPeriod(value: number): value is 30 | 60 {
  return value === 30 || value === 60;
}