import { useQuery } from "@tanstack/react-query";

export type MediaDescription = { url: string; altText: string };

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(body?.error || fallback);
}

export async function getMediaDescriptions(urls: readonly string[]): Promise<Record<string, string>> {
  const uniqueUrls = [...new Set(urls.filter(Boolean))].slice(0, 20);
  if (!uniqueUrls.length) return {};
  const response = await fetch("/api/media/descriptions", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls: uniqueUrls }),
  });
  if (!response.ok) throw await responseError(response, "Opisi fotografija nisu dostupni.");
  const body = await response.json() as { items: MediaDescription[] };
  return Object.fromEntries(body.items.map((item) => [item.url, item.altText]));
}

export function useMediaDescriptions(urls: readonly string[]) {
  const stableUrls = [...new Set(urls.filter(Boolean))].slice(0, 20).sort();
  return useQuery({
    queryKey: ["media-descriptions", stableUrls],
    queryFn: () => getMediaDescriptions(stableUrls),
    enabled: stableUrls.length > 0,
    staleTime: 0,
  });
}