/**
 * Navigation guard for pages with unsaved, save-to-apply form state.
 *
 * Browser Back/Forward cannot be guarded from inside a page component:
 * wouter's location store subscribes to popstate when the app first renders,
 * and its useSyncExternalStore listener re-renders synchronously during the
 * event dispatch. When the route changes, the page unmounts and React's
 * effect cleanup removes the page's own popstate listener before the browser
 * ever reaches it in that same dispatch — the guard silently never runs.
 *
 * This module therefore owns a single window-level popstate listener that is
 * registered at import time. `main.tsx` imports it before rendering, so it is
 * registered ahead of the router's subscription and runs first: it can block
 * on window.confirm and, on cancel, push the guarded URL back within the same
 * task. The router's listener then observes an unchanged location, nothing
 * re-renders, and the page's unsaved values survive.
 */

type ActiveGuard = { href: string; message: string; leaving: boolean };

let activeGuard: ActiveGuard | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    const guard = activeGuard;
    if (!guard || guard.leaving) return;
    if (window.location.href === guard.href) return;
    if (window.confirm(guard.message)) {
      // Let the router process this same event and navigate normally.
      guard.leaving = true;
      return;
    }
    // Restore the guarded entry before the router's listener runs, so the
    // page component never unmounts and the unsaved form state is preserved.
    window.history.pushState(window.history.state, "", guard.href);
  });
}

/**
 * Arms the history-traversal guard for the current location. Returns a
 * disarm function; call it when the form is clean again or on unmount.
 * Only one guard can be active at a time (last armed wins).
 */
export function armHistoryTraversalGuard(message: string): () => void {
  const guard: ActiveGuard = { href: window.location.href, message, leaving: false };
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}
