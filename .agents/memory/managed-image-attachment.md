---
name: Managed image attachment
description: Atomic ownership and lifecycle rules for generic managed-image references.
---

Any mutation that persists a generic managed-image URL must claim the ready, unexpired asset for its uploader in the same database transaction as the business-row write. Derive managed asset IDs only from image fields newly supplied by that mutation.

**Why:** A post-commit claim can fail after a foreign, expired, or unfinished asset URL has already been persisted. That leaves an invalid reference even though the request reports an error, and a leased image may later disappear during cleanup.

**How to apply:** Every new image-bearing create/update route must make the business write and asset claim atomic. Unattached assets remain uploader-only with private/no-store caching; only successfully attached assets become public and immutable. Treat any future image field, upload UI, or public image format as part of this pipeline by default: generate responsive AVIF/WebP/fallback variants, use the optimized renderer, and retain legacy URL compatibility only where a migration has not happened.