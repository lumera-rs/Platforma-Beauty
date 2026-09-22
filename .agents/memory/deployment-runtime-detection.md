---
name: Deployment runtime detection
description: Reliable safety guards for destructive isolated test harnesses in Replit workspaces.
---

Do not use `REPLIT_ENVIRONMENT=production` by itself as proof that a process is running in a published deployment.

**Why:** A development workspace can expose a production-like value for that variable, which can falsely block safe disposable-database tests. Conversely, one ambiguous variable is not a strong enough guard for destructive operations.

**Durable identity rule:** `REPLIT_ENVIRONMENT=production` can still be present while the connection is development. Process classification cannot prove database identity. Before any write, read the privileged actual-target identity on that same connection and require it to match a separately operator-declared target tuple; if that identity read is unavailable, fail closed. This establishes target identity without treating process classification as proof.

**Why identity is independent of migration selection:** Production adoption may intentionally select only the canonical baseline while development-only data migrations require separate authorization. Target protection must not depend on whether that selected set includes an admission contract.

**How to apply:** Layer explicit deployment indicators and `NODE_ENV` checks with strict disposable resource naming, manifest ownership, target identity matching, and loopback-only test services. Apply the same early refusal to direct test entry points that mutate data through an ORM; destructive safety audits must not stop at harnesses that shell out to database utilities. Refuse ambiguous targets and never weaken the disposable-name boundary.

A runner that creates disposable child databases still accesses its administration/source database. Do not bypass the source target guard merely because the child names are disposable.

**Why:** Replacing the source guard with a process-mode check allowed isolated browser checks to access the development cluster while creating their child databases, violating a no-development-access constraint.

**How to apply:** Supply a separately owned local PostgreSQL cluster as the administration/source target. Preserve the full source guard, and propagate the disposable marker only to newly created, owned child targets. Never clear the URL in a guard argument when the runner subsequently uses that same ambient URL.