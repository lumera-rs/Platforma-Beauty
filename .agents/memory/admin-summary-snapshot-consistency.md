---
name: Admin summary snapshot consistency
description: How aggregate dashboard reads remain internally consistent while related records are committed concurrently.
---

**Rule:** Run every database-backed aggregate in a read-only PostgreSQL `repeatable read` transaction, including helper-derived fields. Do not concurrently submit queries through that one transaction client.

**Why:** PostgreSQL's default `read committed` isolation grants a fresh snapshot to each aggregate, so a response can combine values from before and after one commit. A transaction has one node-postgres client, and overlapping `query()` calls are unsafe even though they may appear to work.

**How to apply:** Let shared read helpers accept a minimal query executor so the route can pass its transaction. For a regression, pause after the first aggregate has completed and established the snapshot; commit one related batch before allowing later aggregates and ranking reads to continue. The response must match the pre-commit view exactly.