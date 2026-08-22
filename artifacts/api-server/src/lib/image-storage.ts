import sharp from "sharp";
import type { ImageAssetVariantSet } from "@workspace/db";

export const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const ALLOWED_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const IMAGE_SIZES = {
  thumbnail: 320,
  medium: 960,
  large: 1920,
} as const;

type ImageSize = keyof typeof IMAGE_SIZES;
type VariantFormat = "avif" | "webp" | "fallback";

export type GeneratedImage = {
  bytes: Buffer;
  contentType: "image/avif" | "image/webp" | "image/jpeg" | "image/png";
  width: number;
  height: number;
  extension: "avif" | "webp" | "jpg" | "png";
};

export type GeneratedImageSet = {
  original: GeneratedImage;
  variants: Record<ImageSize, Record<VariantFormat, GeneratedImage>>;
};

function privateObjectRoot(): string {
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root) throw new Error("App Storage nije podešen.");
  return root.replace(/\/+$/, "");
}

export function rawPrivateObjectPath(storagePath: string): string {
  if (!storagePath.startsWith("/objects/")) throw new Error("Neispravna putanja objekta.");
  return `${privateObjectRoot()}/${storagePath.slice("/objects/".length)}`;
}

export function imageAssetStagingStoragePath(userId: string, assetId: string): string {
  return `/objects/image-staging/${userId}/${assetId}/original`;
}

export function imageAssetOriginalStoragePath(assetId: string, extension: GeneratedImage["extension"]): string {
  return `/objects/image-assets/${assetId}/original.${extension}`;
}

export function imageAssetVariantStoragePath(
  assetId: string,
  size: ImageSize,
  format: VariantFormat,
  extension: GeneratedImage["extension"],
): string {
  return `/objects/image-assets/${assetId}/${size}-${format}.${extension}`;
}

export async function signPrivateObject(
  rawPath: string,
  method: "DELETE" | "GET" | "PUT",
  ttlSeconds: number,
): Promise<string> {
  const [, bucketName, ...objectParts] = rawPath.startsWith("/") ? rawPath.split("/") : `/${rawPath}`.split("/");
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectParts.join("/"),
      method,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`App Storage nije generisao URL (${response.status}).`);
  const data = await response.json() as { signed_url?: string };
  if (!data.signed_url) throw new Error("App Storage nije vratio potpisani URL.");
  return data.signed_url;
}

export async function uploadPrivateObject(storagePath: string, bytes: Buffer, contentType: string): Promise<void> {
  const uploadUrl = await signPrivateObject(rawPrivateObjectPath(storagePath), "PUT", 120);
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`App Storage nije sačuvao sliku (${response.status}).`);
}

export async function readPrivateObject(storagePath: string, maxBytes = MAX_IMAGE_UPLOAD_BYTES): Promise<{
  bytes: Buffer;
  contentType: string;
}> {
  const downloadUrl = await signPrivateObject(rawPrivateObjectPath(storagePath), "GET", 60);
  const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`App Storage nije pronašao sliku (${response.status}).`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    response.body?.cancel();
    throw new Error("Slika prelazi dozvoljenu veličinu.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error("Slika prelazi dozvoljenu veličinu.");
  return {
    bytes,
    contentType: response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "",
  };
}

export async function deletePrivateObject(storagePath: string): Promise<void> {
  const deleteUrl = await signPrivateObject(rawPrivateObjectPath(storagePath), "DELETE", 60);
  const response = await fetch(deleteUrl, {
    method: "DELETE",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok || response.status === 404) return;
  throw new Error(`App Storage nije obrisao objekat (${response.status}).`);
}

function hasExpectedImageSignature(contentType: string, bytes: Buffer): boolean {
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "image/webp") return bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP"));
  if (contentType === "image/gif") return bytes.length >= 6 && (bytes.subarray(0, 6).equals(Buffer.from("GIF87a")) || bytes.subarray(0, 6).equals(Buffer.from("GIF89a")));
  return false;
}

async function outputMetadata(bytes: Buffer): Promise<{ width: number; height: number }> {
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Nije moguće utvrditi dimenzije slike.");
  return { width: metadata.width, height: metadata.height };
}

export async function generateOptimizedImageSet(bytes: Buffer, claimedContentType: string): Promise<GeneratedImageSet> {
  const contentType = claimedContentType.toLowerCase();
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType) || !hasExpectedImageSignature(contentType, bytes)) {
    throw new Error("Sadržaj fajla ne odgovara dozvoljenom formatu slike.");
  }

  const metadata = await sharp(bytes, { animated: false }).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Slika nema validne dimenzije.");
  if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) throw new Error("Rezolucija slike je previsoka.");

  const oriented = sharp(bytes, { animated: false }).rotate();
  const alpha = metadata.hasAlpha === true;
  const originalBytes = alpha
    ? await oriented.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    : await oriented.clone().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const originalMeta = await outputMetadata(originalBytes);
  const original: GeneratedImage = {
    bytes: originalBytes,
    contentType: alpha ? "image/png" : "image/jpeg",
    width: originalMeta.width,
    height: originalMeta.height,
    extension: alpha ? "png" : "jpg",
  };

  const variants = {} as GeneratedImageSet["variants"];
  for (const [sizeName, maxWidth] of Object.entries(IMAGE_SIZES) as [ImageSize, number][]) {
    const resized = oriented.clone().resize({
      width: maxWidth,
      height: maxWidth,
      fit: "inside",
      withoutEnlargement: true,
    });
    const [avifBytes, webpBytes, fallbackBytes] = await Promise.all([
      resized.clone().avif({ quality: 55, effort: 4 }).toBuffer(),
      resized.clone().webp({ quality: 78, effort: 4 }).toBuffer(),
      alpha
        ? resized.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
        : resized.clone().jpeg({ quality: 82, mozjpeg: true }).toBuffer(),
    ]);
    const [avifMeta, webpMeta, fallbackMeta] = await Promise.all([
      outputMetadata(avifBytes),
      outputMetadata(webpBytes),
      outputMetadata(fallbackBytes),
    ]);
    variants[sizeName] = {
      avif: { bytes: avifBytes, contentType: "image/avif", extension: "avif", ...avifMeta },
      webp: { bytes: webpBytes, contentType: "image/webp", extension: "webp", ...webpMeta },
      fallback: {
        bytes: fallbackBytes,
        contentType: alpha ? "image/png" : "image/jpeg",
        extension: alpha ? "png" : "jpg",
        ...fallbackMeta,
      },
    };
  }
  return { original, variants };
}

export function imageVariantMetadata(
  assetId: string,
  generated: GeneratedImageSet["variants"],
): ImageAssetVariantSet {
  const result = {} as ImageAssetVariantSet;
  for (const size of Object.keys(IMAGE_SIZES) as ImageSize[]) {
    result[size] = {} as ImageAssetVariantSet[ImageSize];
    for (const format of ["avif", "webp", "fallback"] as VariantFormat[]) {
      const item = generated[size][format];
      result[size][format] = {
        objectPath: imageAssetVariantStoragePath(assetId, size, format, item.extension),
        contentType: item.contentType,
        width: item.width,
        height: item.height,
        bytes: item.bytes.length,
      };
    }
  }
  return result;
}