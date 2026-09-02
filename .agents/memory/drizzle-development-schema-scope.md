---
name: Drizzle development schema scope
description: Why development schema pushes explicitly target only PostgreSQL public.
---

Keep non-interactive Drizzle development pushes explicitly scoped to the application-owned `public` schema. Do not broaden the scope unless the application intentionally adds another schema.

**Why:** Drizzle can stop at an interactive named-schema conflict prompt before applying source-declared indexes, leaving development behind source control and causing later release checks to fail. Production schema changes remain owned by Replit Publish.

**How to apply:** Preserve the explicit public-only schema filter in Drizzle configuration used by the post-merge development push. Do not add startup DDL, deployment-time pushes, or custom production migration paths.