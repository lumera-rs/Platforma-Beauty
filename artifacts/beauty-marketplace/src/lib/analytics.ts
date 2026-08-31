type AnalyticsData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void;
    };
  }
}

export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === "undefined") return;

  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never interrupt the customer flow.
  }
}

type FeaturedPlacementConfirmation = {
  activated: boolean;
  kind: string;
  scope: string;
};

export function trackFeaturedPlacementPaid(confirmation: FeaturedPlacementConfirmation): void {
  if (!confirmation.activated) return;

  trackEvent("featured_placement_paid", {
    placement_kind: confirmation.kind,
    placement_scope: confirmation.scope,
  });
}