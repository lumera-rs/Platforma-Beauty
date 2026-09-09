---
name: CI history ordering
description: Ordering and limiting GitHub Actions timing history before artifact downloads
---

GitHub Actions workflow-run history must be collected across paginated responses and sorted by `run_started_at` before applying the configured report limit; timing JSON reports use their own `startedAt` field for trend ordering.

**Why:** API response order is not a stable contract, and the GitHub workflow-run field is `run_started_at`, not the report serializer’s `startedAt`. Limiting before sorting can exclude the newest usable reports.

**How to apply:** When changing any CI timing-history downloader, slurp paginated run responses, sort descending by `run_started_at`, then fetch artifacts until the configured number of valid reports is reached. Keep trend tests with shuffled run order.