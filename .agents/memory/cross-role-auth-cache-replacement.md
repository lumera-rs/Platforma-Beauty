---
name: Cross-role auth cache replacement
description: Prevents stale role-specific navigation and background requests after switching business identities.
---

After login or registration, replace the cached current-user response with the authenticated response before navigating to a role-specific area.

**Why:** A server session can change from one business role to another while the client cache still holds the previous user. Redirecting first can briefly or persistently mount the wrong role’s navigation and background queries.

**How to apply:** Any authentication flow that returns the new user should synchronously update the canonical current-user query key before routing. Logout should clear role-scoped caches.