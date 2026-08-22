/**
 * OptimizedImage – reusable image renderer for LUMERA.
 *
 * Contract:
 *  - Managed URLs  → /api/media/images/{uuid}
 *    Emits a <picture> with AVIF + WebP + fallback <source> using
 *    query params:  size=thumbnail|medium|large  &  format=avif|webp|fallback
 *    srcSet widths: 320w / 960w / 1920w
 *
 *  - All other URLs (legacy / external) → rendered as-is, no invented srcset.
 *
 * Every <img> has:
 *  - explicit numeric width & height (default 800×600, overrideable)
 *  - decoding="async"
 *  - loading="lazy" by default; pass eager={true} + fetchPriority="high" for
 *    genuinely above-the-fold primary images.
 */

import { ImgHTMLAttributes } from "react";

// ── URL detection ─────────────────────────────────────────────────────────────

const RESPONSIVE_MANAGED_RE = /^\/api\/(?:media\/images|education\/media)\/([0-9a-f-]{36})\/?$/i;

function isManagedUrl(url: string): boolean {
  return RESPONSIVE_MANAGED_RE.test(url.split("?")[0]);
}

// ── srcSet helpers ────────────────────────────────────────────────────────────

type ImageSize = "thumbnail" | "medium" | "large";
type ImageFormat = "avif" | "webp" | "fallback";

interface SrcEntry {
  size: ImageSize;
  width: 320 | 960 | 1920;
}

const SIZES: SrcEntry[] = [
  { size: "thumbnail", width: 320 },
  { size: "medium",    width: 960 },
  { size: "large",     width: 1920 },
];

function buildSrc(base: string, size: ImageSize, format: ImageFormat): string {
  return `${base}?size=${size}&format=${format}`;
}

function buildSrcSet(base: string, format: ImageFormat): string {
  return SIZES.map(({ size, width }) => `${buildSrc(base, size, format)} ${width}w`).join(", ");
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface OptimizedImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "loading" | "decoding"> {
  /** Managed generic and Education media URLs get full srcset treatment. */
  src: string;
  /** Alt text — always required. */
  alt: string;
  /**
   * Explicit pixel width for the rendered <img>.
   * Kept as a number so the browser can calculate aspect ratio before layout.
   * @default 800
   */
  width?: number;
  /**
   * Explicit pixel height for the rendered <img>.
   * @default 600
   */
  height?: number;
  /**
   * Pass true only for genuinely above-the-fold primary images (e.g. hero).
   * Disables lazy loading and sets fetchpriority="high".
   * @default false
   */
  eager?: boolean;
  /** Hint for the browser's sizes attribute on the <source> elements. */
  sizes?: string;
}

export function OptimizedImage({
  src,
  alt,
  width = 800,
  height = 600,
  eager = false,
  sizes,
  className,
  style,
  ...rest
}: OptimizedImageProps) {
  const loading: "eager" | "lazy" = eager ? "eager" : "lazy";

  if (isManagedUrl(src)) {
    // Strip any existing query string so we control all params
    const base = src.split("?")[0];

    const commonImgProps = {
      alt,
      width,
      height,
      decoding: "async" as const,
      loading,
      ...(eager ? { fetchPriority: "high" as const } : {}),
      className,
      style,
      ...rest,
    };

    return (
      <picture>
        <source
          type="image/avif"
          srcSet={buildSrcSet(base, "avif")}
          {...(sizes ? { sizes } : {})}
        />
        <source
          type="image/webp"
          srcSet={buildSrcSet(base, "webp")}
          {...(sizes ? { sizes } : {})}
        />
        <source
          srcSet={buildSrcSet(base, "fallback")}
          {...(sizes ? { sizes } : {})}
        />
        <img
          src={buildSrc(base, "large", "fallback")}
          {...commonImgProps}
        />
      </picture>
    );
  }

  // Legacy / external URL — render as-is
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      decoding="async"
      loading={loading}
      {...(eager ? { fetchPriority: "high" as const } : {})}
      className={className}
      style={style}
      {...rest}
    />
  );
}
