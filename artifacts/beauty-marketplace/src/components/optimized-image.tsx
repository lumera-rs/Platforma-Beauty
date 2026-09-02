import type { ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type OptimizedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height" | "loading" | "decoding"> & {
  src: string;
  width?: number;
  height?: number;
  priority?: boolean;
  eager?: boolean;
  responsiveSizes?: string;
  preferredSize?: "thumbnail" | "medium" | "large" | "original";
};

function isManagedMediaUrl(src: string) {
  return /^\/api\/media\/(?:images\/)?[0-9a-f-]{36}(?:\?|$)/i.test(src);
}

export function optimizedMediaUrl(
  src: string,
  size: "thumbnail" | "medium" | "large" | "original",
  format?: "avif" | "webp" | "fallback" | "original",
) {
  if (!isManagedMediaUrl(src)) return src;
  const [path, query = ""] = src.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("size", size);
  if (format) params.set("format", format);
  return `${path}?${params.toString()}`;
}

export function OptimizedImage({
  src,
  alt,
  width = 800,
  height = 600,
  priority = false,
  eager = false,
  responsiveSizes,
  preferredSize = "large",
  className,
  sizes,
  ...imgProps
}: OptimizedImageProps) {
  const highPriority = priority || eager;
  const sourceSizes = responsiveSizes ?? sizes;
  const image = (
    <img
      {...imgProps}
      src={optimizedMediaUrl(src, preferredSize)}
      alt={alt}
      width={width}
      height={height}
      loading={highPriority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={highPriority ? "high" : "auto"}
      sizes={sourceSizes}
      className={cn(className)}
    />
  );

  if (!isManagedMediaUrl(src)) return image;
  const compatibilityWidths = /^\/api\/media\/images\//i.test(src)
    ? { thumbnail: 320, medium: 960, large: 1920 }
    : { thumbnail: 320, medium: 800, large: 1600 };
  const srcSet = (format: "avif" | "webp") => [
    `${optimizedMediaUrl(src, "thumbnail", format)} ${compatibilityWidths.thumbnail}w`,
    `${optimizedMediaUrl(src, "medium", format)} ${compatibilityWidths.medium}w`,
    `${optimizedMediaUrl(src, "large", format)} ${compatibilityWidths.large}w`,
  ].join(", ");

  return (
    <picture>
      <source type="image/avif" srcSet={srcSet("avif")} sizes={sourceSizes} />
      <source type="image/webp" srcSet={srcSet("webp")} sizes={sourceSizes} />
      {image}
    </picture>
  );
}

export function AvatarImage(props: Omit<OptimizedImageProps, "width" | "height" | "preferredSize"> & { size?: number }) {
  const { size = 96, className, ...rest } = props;
  return (
    <OptimizedImage
      {...rest}
      width={size}
      height={size}
      preferredSize="thumbnail"
      responsiveSizes={`${size}px`}
      className={cn("rounded-full object-cover", className)}
    />
  );
}