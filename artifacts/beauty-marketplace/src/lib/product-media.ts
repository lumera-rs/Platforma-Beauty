export function canonicalProductImageUrls(
  imageUrl: string | null | undefined,
  images: readonly string[] | null | undefined,
): string[] {
  return [...new Set([imageUrl, ...(images ?? [])].filter((url): url is string => Boolean(url)))];
}

export function productImageDescriptionItems(
  imageUrl: string | null | undefined,
  images: readonly string[] | null | undefined,
  descriptions: Readonly<Record<string, string>>,
) {
  return canonicalProductImageUrls(imageUrl, images)
    .map((url) => ({ url, altText: descriptions[url] ?? "" }));
}