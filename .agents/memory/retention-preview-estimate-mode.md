---
name: Retention preview estimate mode
description: Rules for the sampled-estimate fallback of the admin threshold impact preview
---

Above the exact-preview customer cap, the retention threshold preview must answer with a sampled estimate instead of refusing — but estimates carry hard rules:

**Rule:** Every extrapolated number is flagged (isEstimate + sampleSize) and rendered as approximate ("~ / procena") in the UI; the reclassified total is derived from the scaled shifts so the estimate stays internally consistent; the per-salon "most affected" breakdown is intentionally EMPTY in estimate mode; the sample size is clamped to the exact-mode cap.

**Why:** A uniform customer sample is far too noisy at individual-salon granularity — a misleading per-salon list is worse than none. Independent scaling of totals vs. shifts would make the numbers visibly disagree. An estimate that costs more than the largest allowed exact preview defeats the guard. Exact counts and estimates must never be confusable, or admins will act on sampled noise as fact.

**How to apply:** Any future surface that consumes RetentionSettingsPreview (exports, alerts, per-salon drilldowns like "small salons hit hardest") must branch on isEstimate: never present scaled counts as exact, and never extrapolate per-salon numbers from the uniform sample — a per-salon feature needs stratified or per-salon sampling instead. The time budget and per-customer appointment-row budget still apply in estimate mode (503 on breach); only the row-count refusal was replaced by sampling.

**Rule:** The sampled preview's platform-wide reclassified total carries an integer 95% margin of error, while exact previews return no margin. Use a Wilson interval with finite-population correction rather than a simple normal/Wald interval.

**Why:** A normal/Wald interval reports ±0 for a small sample that happens to contain no reclassifications (or all reclassifications), falsely suggesting certainty precisely when sampling error is largest.

**How to apply:** Keep the margin attached only to the aggregate reclassified headline and always pair it with the estimate marker and plain-language explanation. Do not derive per-salon margins from this uniform sample; those need a dedicated sampling design.

**Sampling must be bounded work:** ORDER BY random() LIMIT n visits and heap-sorts every row — at the very scale that triggers estimate mode it can itself exhaust the time budget. Use PostgreSQL TABLESAMPLE SYSTEM (page-level, I/O proportional to the requested percentage) with the percentage derived from a hard source-row budget (a few × the target sample plus a small constant floor for tiny tables) and a LIMIT of that budget on the query. NEVER escalate the percentage when the page sample under-delivers — 100% degenerates to a full platform scan; keep the smaller sample and report its true size, and refuse honestly on an empty sample. Likewise, no estimate-mode helper query may scan the whole platform — e.g. salon medians are computed only for the salons present in the sample, in bounded chunks.
