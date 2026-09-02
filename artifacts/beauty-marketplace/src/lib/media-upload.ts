export type MediaUploadScope =
  | "salon-profile"
  | "salon-gallery"
  | "employee-avatar"
  | "product"
  | "product-document"
  | "supplier"
  | "education-cover"
  | "education-gallery"
  | "education-center"
  | "instructor-avatar"
  | "service-category"
  | "product-category"
  | "treatment-photo"
  | "jobseeker-portfolio";

export type FinalizedMediaAsset = {
  id: string;
  imageUrl: string;
  width: number;
  height: number;
  contentHash: string;
};

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SUPPORTED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword"
]);
const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(body?.error || fallback);
}

export async function uploadDocument(
  file: File,
  scope: MediaUploadScope,
  resourceId?: string | null,
): Promise<{ url: string; displayName: string }> {
  if (!SUPPORTED_DOCUMENT_TYPES.has(file.type.toLowerCase()) || file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) {
    throw new Error("Izaberite PDF ili DOCX dokument do 12 MB.");
  }

  const ticketResponse = await fetch("/api/media/uploads", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope,
      resourceId: resourceId || null,
      name: file.name,
      size: file.size,
      contentType: file.type.toLowerCase(),
      isDocument: true,
    }),
  });
  if (!ticketResponse.ok) throw await apiError(ticketResponse, "Nije moguće pripremiti upload dokumenta.");
  const ticket = await ticketResponse.json() as { uploadId: string; uploadUrl: string };

  const uploadResponse = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type.toLowerCase() },
    body: file,
  });
  if (!uploadResponse.ok) throw new Error("Otpremanje dokumenta nije uspelo.");

  const finalizeResponse = await fetch(`/api/media/uploads/${ticket.uploadId}/finalize`, {
    method: "POST",
    credentials: "include",
  });
  if (!finalizeResponse.ok) throw await apiError(finalizeResponse, "Obrada dokumenta nije uspela.");

  const result = await finalizeResponse.json() as { imageUrl: string };
  return { url: result.imageUrl, displayName: file.name };
}

export async function uploadOptimizedImage(
  file: File,
  scope: MediaUploadScope,
  resourceId?: string | null,
): Promise<FinalizedMediaAsset> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase()) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("Izaberite JPG, PNG, WEBP ili AVIF fotografiju do 12 MB.");
  }

  const ticketResponse = await fetch("/api/media/uploads", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope,
      resourceId: resourceId || null,
      name: file.name,
      size: file.size,
      contentType: file.type.toLowerCase(),
    }),
  });
  if (!ticketResponse.ok) throw await apiError(ticketResponse, "Nije moguće pripremiti upload fotografije.");
  const ticket = await ticketResponse.json() as { uploadId: string; uploadUrl: string };

  const uploadResponse = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type.toLowerCase() },
    body: file,
  });
  if (!uploadResponse.ok) throw new Error("Otpremanje fotografije u App Storage nije uspelo.");

  const finalizeResponse = await fetch(`/api/media/uploads/${ticket.uploadId}/finalize`, {
    method: "POST",
    credentials: "include",
  });
  if (!finalizeResponse.ok) throw await apiError(finalizeResponse, "Obrada fotografije nije uspela.");
  return finalizeResponse.json() as Promise<FinalizedMediaAsset>;
}