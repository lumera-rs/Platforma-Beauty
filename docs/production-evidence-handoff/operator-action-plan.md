# Operator action plan

No named individual is assigned here. The role named in the request register
must accept responsibility in the approved external authorization system.

1. **Documentation preparation (A, current scope):** reconcile request IDs,
   dependencies, approval classes and secure-delivery instructions locally.
2. **Target identification (future B):** the system owner obtains a
   time-bounded approval before reading the production control plane. Compare
   environment, database, region, schema and revision identifiers.
3. **Recovery readiness (future B):** the recovery owner supplies provider
   configuration/history and an actual isolated restore-rehearsal report.
   Backup configuration alone does not satisfy restore evidence.
4. **Topology (future B):** the operations owner accounts for every API
   instance, revision, worker, scheduler, startup path and writer.
5. **Access proof (future C):** only after separate C approval, the database
   and security owners prove effective read-only privileges and no escalation.
6. **Operational controls (future D):** only after separate D approval,
   independently verify session bounds, monitoring, aborts and the active
   global write fence. Documentation of a fence is insufficient.
7. **P-05 (future E then F):** PREFLIGHT and SCAN remain distinct. A successful
   PREFLIGHT does not automatically authorize SCAN.
8. **Retry/change (future G/H):** every retry or production change requires a
   new, explicit approval. Nothing in this package grants it.

For every candidate, verify source, integrity, freshness and exact production
target before recording an external reviewer disposition. Stop on ambiguity,
target change, expired approval, secret exposure, failed prerequisite, or
conflicting evidence.
