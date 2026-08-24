---
name: Salon-switch URL continuity
description: Preserving query-backed owner state while a full active-salon navigation reloads the page.
---

**Rule:** When an active-salon switch reloads the current owner route, derive the destination from the browser's pathname, search string, and hash—not a router pathname value alone.

**Why:** Wouter's location hook represents the pathname. Using it directly for `window.location.assign()` silently loses query-backed campaign windows, so the refreshed salon defaults to a different view than the owner intentionally selected.

**How to apply:** Keep the full browser location for same-owner-route reloads. Regression coverage for a query-backed view should switch between two isolated salons and verify the new overview and any opened detail request retain the same preset or complete custom window.