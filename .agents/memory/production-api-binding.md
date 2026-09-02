---
name: Production API binding
description: Deployment requirement for artifact API servers using an explicit port.
---

Artifact API servers must bind their HTTP listener to `0.0.0.0`, not only the default loopback interface.

**Why:** The deployment health and port-detection process reaches the configured artifact port outside the process's loopback-only listener. A loopback bind can make a healthy local server appear unavailable in production.

**How to apply:** Whenever an API server starts from the artifact-managed production command, pass `0.0.0.0` as the host and verify its configured `/api/healthz` route after restarting the workflow.