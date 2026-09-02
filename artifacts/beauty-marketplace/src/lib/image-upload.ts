const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type UploadIntent = {
  assetId: string;
  uploadUrl: string;
  finalizeUrl: string;
};

export type OptimizedImageUpload = {
  assetId: string;
  imageUrl: string;
  width: number;
  height: number;
};

async function responseError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  return new Error(typeof payload?.error === "string" ? payload.error : fallback);
}

export function validateImageUpload(file: File): string | null {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase())) {
    return "Izaberite JPG, PNG, WEBP ili GIF sliku.";
  }
  if (file.size < 1 || file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return "Slika mora biti manja od 8 MB.";
  }
  return null;
}

export async function uploadOptimizedImage(file: File): Promise<OptimizedImageUpload> {
  const validationError = validateImageUpload(file);
  if (validationError) throw new Error(validationError);

  const request = await fetch("/api/media/uploads/request-url", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type,
    }),
  });
  if (!request.ok) throw await responseError(request, "Nije moguće pripremiti upload slike.");
  const intent = await request.json() as UploadIntent;

  const upload = await fetch(intent.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!upload.ok) throw new Error("Otpremanje slike u App Storage nije uspelo.");

  const finalize = await fetch(intent.finalizeUrl, {
    method: "POST",
    credentials: "include",
  });
  if (!finalize.ok) throw await responseError(finalize, "Obrada slike nije uspela.");
  return await finalize.json() as OptimizedImageUpload;
}