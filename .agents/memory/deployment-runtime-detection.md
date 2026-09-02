---
name: Deployment runtime detection
description: Reliable safety guards for destructive isolated test harnesses in Replit workspaces.
---

Do not use `REPLIT_ENVIRONMENT=production` by itself as proof that a process is running in a published deployment.

**Why:** A development workspace can expose a production-like value for that variable, which can falsely block safe disposable-database tests. Conversely, one ambiguous variable is not a strong enough guard for destructive operations.

**How to apply:** Layer explicit deployment indicators and `NODE_ENV` checks with strict disposable resource naming, manifest ownership, target identity matching, and loopback-only test services. Apply the same early refusal to direct test entry points that mutate data through an ORM; destructive safety audits must not stop at harnesses that shell out to database utilities. Refuse ambiguous targets and never weaken the disposable-name boundary.