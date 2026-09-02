---
name: Capacity harness serving boundary
description: Why capacity tests use the real request app without unrelated production schedulers.
---

Capacity tests should exercise the real Express request app and booking routes while excluding unrelated periodic workers and startup seeders.

**Why:** Starting the complete production entrypoint in a disposable multi-process load test caused scheduler and lazy-seed races that produced unrelated failures and database work. That measures whole-platform startup contention rather than booking serving capacity.

**How to apply:** Keep process count, pool configuration, database engine, schema, and request path deployment-like. Bootstrap fixtures once, start only the serving app for the measured processes, and document excluded background workloads separately.