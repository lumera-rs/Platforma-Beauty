---
name: SMS fallback audience parity
description: Admin-panel reachability signals for the emergency SMS fallback must reuse the send path's exact audience and phone predicate.
---

The admin panel shows a standing warning when the emergency SMS fallback could reach nobody. That signal is a count computed by a helper exported from the delivery-report alerts module, which applies the exact same audience (active ADMIN/SUPER_ADMIN) and phone predicate (non-null, non-whitespace) as the fallback send path itself.

**Why:** A UI notice computed with its own query (e.g. `phone IS NOT NULL` only, or ignoring `active`) can disagree with what the fallback would really do — showing "all clear" while the send path still filters everyone out (whitespace-only phones, deactivated admins), which defeats the point of the warning.

**How to apply:** Any new surface reporting "who would this alert/fallback actually reach" (dashboard banners, health endpoints) must call the shared helper or shared predicate from the alerting module — never re-derive the audience inline. If the send-path predicate changes, the helper changes with it automatically.
