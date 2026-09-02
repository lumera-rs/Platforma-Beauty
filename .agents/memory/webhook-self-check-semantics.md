---
name: Webhook self-check semantics
description: How the admin "verify webhook" self-check stays side-effect free for delivery state and freshness monitoring.
---

The admin webhook self-check posts a synthetic delivery event to the app's own provider webhook endpoint over loopback, using the saved secret as the path token — the full production path (routing, parsing, timing-safe token check) with no bypass.

**Why:** A verification event must never alter delivery state or mask real monitoring. Synthetic references use a reserved prefix that can never match a persisted outbound send (always classified unmatched), and batches consisting solely of such references are excluded from delivery-report receipt tracking — otherwise a self-check would silence the report-staleness warning, which is meant to detect *provider* silence, not endpoint health.

**How to apply:** Any future webhook monitoring or delivery accounting must treat verification-prefixed references as non-provider traffic. Mixed batches (real + synthetic events) still count as provider receipts. The marker grants no authentication shortcut — forged tokens are still rejected 401 regardless of the marker.
