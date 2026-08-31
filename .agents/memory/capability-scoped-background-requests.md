---
name: Capability-scoped background requests
description: Keep client background traffic and navigation aligned with the backend capability boundary.
---

Client role groups used for broad workspace navigation must not automatically authorize narrower background API traffic. Polling, realtime streams, visible entry points, direct-route guards, and page-level queries should all use the same capability boundary as the server endpoint.

**Why:** A user can legitimately belong in a shared business workspace while lacking the salon context required by salon-only endpoints. Gating only the layout leaves direct links and deep URLs able to recreate repeated authorization errors.

**How to apply:** When adding or changing role-based background consumers, verify the endpoint's server guard first, then mirror it at every client entry and add a direct-URL regression check for a nearby role that lacks the capability.