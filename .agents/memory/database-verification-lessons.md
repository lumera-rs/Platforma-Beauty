---
name: Database and fixture verification
description: Index of isolated database and fixture evidence lessons, including real session-lock cleanup proof.
---

Session-lock leak tests must distinguish a broken transport from a terminated
PostgreSQL backend, and disable pool idle/lifetime reaping.

**Why:** Backend death inherently releases session locks; reaping can also hide
an unsafe return to the pool. A live server session behind a transport blackhole
can retain its lock after the client query times out.

**How to apply:** Use an owned disposable cluster, a real transport fault, a
separate catalog observer and a third acquisition contender. Prove the failing
baseline before changing cleanup, and wait for actual backend disappearance
after connection destruction rather than assuming pool shutdown is synchronous.

Source-evidence fixtures can depend on exact line positions even when SQL text
and execution order are unchanged.

**Why:** Occurrence validation may fail before a deliberately mutated excerpt
reaches its expected checksum assertion. Do not misclassify this as SQL drift
or weaken assertions to hide it.

**How to apply:** Compare baseline and edited sources; preserve source positions
when immutable evidence cannot be updated. Full-file protected hashes are a
separate restriction: report their drift rather than silently refreshing them.
When a whole-file pin refresh is explicitly authorized only for an unchanged
protected segment, establish byte equality, both hashes/lengths, anchor
uniqueness, and parsed operation counts before refreshing that pin. SQL
inventory fingerprints and whole-file source pins are different evidence.

Run the publish chain with its normal build environment, not a blanket
`NODE_ENV=test` inherited from a database-test harness.

**Why:** That override can include development React in a Vite production build,
creating misleading bundle-budget failures even when application code is
unchanged.

**How to apply:** Keep disposable database routing explicit while leaving
NODE_ENV unset for the publish orchestrator; set test mode only for individual
test commands that require it.

Related verification lessons:
- [Disposable PostgreSQL lifecycle](disposable-postgres-lifecycle.md): short owned socket paths and asynchronous backend teardown.
- [Database-clock boundaries](database-clock-test-boundaries.md): align JavaScript and PostgreSQL clocks in deadline fixtures.
- [Cross-domain booking fixtures](cross-domain-booking-fixtures.md): canonical availability and idempotency prerequisites.
- [Lifecycle evidence](lifecycle-verification-evidence.md): retain phase logs and never count interrupted suites as complete.
- [Browser fixture failures](browser-fixture-failure-classification.md): distinguish rejected mock identities from authorization failures.