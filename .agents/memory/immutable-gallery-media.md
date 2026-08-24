---
name: Immutable gallery media
description: Security rules for browser-uploaded gallery objects and their serving endpoints
---

Browser-writable upload objects must remain staging-only. Verify the uploaded bytes server-side, copy them to a server-generated final object key, and persist only that final key in the database before serving the media.

**Why:** A still-valid signed PUT URL can otherwise overwrite a gallery image after attachment, and a stable media URL can leak owner-only content through a shared cache.

**How to apply:** Keep serving routes opaque and authorization-aware; enforce final-key prefixes for attached course media, and use private no-store responses whenever a stable gallery URL can later become owner-only. Public caching requires a versioned URL plus reliable visibility-change invalidation. Revocable salon cover and gallery media need both revalidation for new responses and an edge-cache purge for previously immutable variants when visibility is revoked.

For attach operations, acquire the attachment lock and check for an existing record before reading or promoting staging bytes.

**Why:** A replay while the signed staging PUT remains valid must be idempotent; promoting first lets a replay overwrite the final object.

**How to apply:** Keep the attachment lock through verification, promotion, and row insertion, or use an equivalent durable claim state before external storage work.