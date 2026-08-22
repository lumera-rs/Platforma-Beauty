---
name: EventSource reconnect recovery
description: Covers reliable browser recovery for long-lived EventSource connections after connectivity returns.
---

Do not rely only on EventSource's native retry after a browser transitions offline and back online. Reconnect explicitly on stream errors and the browser's `online` event, then rehydrate authoritative state when the new stream opens.

**Why:** Chromium network restoration did not promptly reopen an existing stream during forced-drop coverage, leaving missed updates stale until the polling fallback ran.

**How to apply:** Use this pattern for browser realtime consumers that must recover missed server events after laptop sleep, mobile network changes, or temporary connection loss.