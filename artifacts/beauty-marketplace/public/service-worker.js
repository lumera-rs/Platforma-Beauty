const FALLBACK_TITLE = "LUMERA";

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const scopeUrl = new URL(self.registration.scope);
  const requestedUrl = typeof payload.deepLink === "string"
    ? payload.deepLink
    : typeof payload.url === "string"
      ? payload.url
      : ".";
  let safeUrl = scopeUrl.href;
  try {
    const scopeRelativeUrl = requestedUrl.startsWith("/")
      ? requestedUrl.slice(1)
      : requestedUrl;
    const candidate = new URL(scopeRelativeUrl, scopeUrl);
    if (candidate.origin === scopeUrl.origin && candidate.pathname.startsWith(scopeUrl.pathname)) {
      safeUrl = candidate.href;
    }
  } catch {
    // Keep the safe scope URL for malformed or non-URL payload values.
  }

  event.waitUntil(self.registration.showNotification(
    typeof payload.title === "string" && payload.title.trim() ? payload.title : FALLBACK_TITLE,
    {
      body: typeof payload.body === "string" ? payload.body : "",
      icon: new URL("favicon.svg", scopeUrl).href,
      badge: new URL("favicon.svg", scopeUrl).href,
      tag: typeof payload.tag === "string" ? payload.tag : undefined,
      data: { url: safeUrl },
    },
  ));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const scopeUrl = new URL(self.registration.scope);
  let targetUrl = scopeUrl.href;
  try {
    const candidate = new URL(event.notification.data?.url || ".", scopeUrl);
    if (candidate.origin === scopeUrl.origin && candidate.pathname.startsWith(scopeUrl.pathname)) {
      targetUrl = candidate.href;
    }
  } catch {
    // Keep the safe scope URL.
  }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === scopeUrl.origin);
    if (existing) {
      await existing.navigate(targetUrl);
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl);
  })());
});