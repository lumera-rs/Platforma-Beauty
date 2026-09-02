---
name: URL restore picker parity
description: Selections restored from shared/bookmarked links must obey the same constraints the UI's pickers enforce.
---

Any state restored from a query string (date ranges, filters, selections) must be validated against the same rules the interactive control enforces — not just for syntactic validity. A hand-edited or stale shared link can otherwise restore a state the user could never reach themselves (e.g. a date range ending after today when the calendar disables future days), producing an inexplicable empty view.

**Why:** The campaign period restore accepted any strictly valid YYYY-MM-DD pair, including fully-future ranges the DayPicker (`disabled={{ after: new Date() }}`) forbids — shared links showed an impossible selection with empty stats and no hint why.

**How to apply:** When parsing URL-restored state, clamp partially-out-of-range values to the reachable boundary (compare by local calendar day so "today" survives at any hour) and fall back to the default when nothing reachable remains — then let the existing URL-sync effect rewrite the link so what is re-shared matches what is shown. Inject "today"/now as a parameter for deterministic tests.
