---
name: Public social image metadata
description: Rules for publishing dimensions and MIME type for public Open Graph images.
---

Publish width, height, and MIME type only when they come from the exact managed variant the public URL is pinned to. Keep external and unresolved legacy image references URL-only; never infer trusted metadata from a file extension.

**Why:** Negotiated image routes can serve different bytes for the same base URL, while external URLs and extensions do not prove either dimensions or response content type. Declaring guessed values can make SSR and client metadata disagree with the image crawlers actually receive.

**How to apply:** When a public entity selects a managed social image, resolve an explicit size and format and carry its stored metadata through the API, SSR, and post-mount client metadata. Preserve the known platform fallback image's authored metadata separately.