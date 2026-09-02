export function getSafeReturnTo(searchString: string): string | null {
  const candidate = new URLSearchParams(searchString).get("returnTo");
  if (!candidate) return null;

  try {
    const url = new URL(candidate, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/") || url.pathname.startsWith("//")) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function loginPathWithReturnTo(loginPath: string, currentPath: string) {
  const url = new URL(loginPath, window.location.origin);
  if (currentPath.startsWith("/") && !currentPath.startsWith("//")) {
    url.searchParams.set("returnTo", currentPath);
  }
  return `${url.pathname}${url.search}`;
}