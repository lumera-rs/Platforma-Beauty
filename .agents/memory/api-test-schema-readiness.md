---
name: API test schema readiness
description: Prevent direct Express-app regression suites from querying columns that production startup would have migrated first.
---

API regression suites that import the Express application directly do not execute
the runtime entrypoint, so they bypass its additive schema rollout. When an
endpoint begins reading a newly added database column, the suite must establish
the relevant schema before starting its server and making snapshot reads.

**Why:** Production runs schema readiness before listening, but a direct app
import can otherwise fail with a missing-column error even though the deployed
server would be healthy.

**How to apply:** For endpoint suites that bypass the runtime entrypoint, await
the owning idempotent schema-ready helper at test setup before opening the
server. Keep the helper scoped to the schema the tested endpoint queries.