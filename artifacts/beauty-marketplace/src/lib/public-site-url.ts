function configuredPublicSiteOrigin(): string | undefined {
  const ssrValue = document.querySelector<HTMLMetaElement>(
    'meta[name="lumera:public-site-url"]',
  )?.content.trim();
  const configured = ssrValue || import.meta.env.VITE_PUBLIC_SITE_URL?.trim();
  if (!configured) return undefined;

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("Public site URL must be a valid absolute HTTPS origin.");
  }
  if (url.protocol !== "https:" || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Public site URL must be a valid absolute HTTPS origin.");
  }
  return url.origin;
}

export function publicSiteOrigin(): string {
  const configured = configuredPublicSiteOrigin();
  if (configured) return configured;
  if (import.meta.env.DEV) return window.location.origin;
  throw new Error("Public site URL is not configured.");
}

export function publicSiteUrl(path: string): string {
  return new URL(path, `${publicSiteOrigin()}/`).toString();
}