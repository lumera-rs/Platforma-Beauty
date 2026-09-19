# Collection sequence

The sequence describes dependencies; it does not authorize execution.

1. **A — reconcile documentation:** validate 32 requests against the approved
   evidence register and readiness matrix.
2. **AUTH-02 / B:** obtain separate approval for one scoped configuration read.
3. **ENV-01…04:** identify and cross-check exact production target, database,
   region, PostgreSQL version, schema, revision and environment separation.
4. **BKP-01…05:** confirm backup configuration/history, then obtain an actual
   isolated restore-rehearsal report and measured RPO/RTO.
5. **TOP-01…04:** inventory autoscaling, instances/revisions, background work
   and startup DDL/write reachability.
6. **OPS-01:** establish incident, database, recovery and escalation operator
   coverage for the approved future collection window.
7. **AUTH-03 / C:** separately approve one database connection only after the
   target and recovery gates are accepted.
8. **DB-01…03:** prove the dedicated identity, effective read-only grants and
   absence of escalation. C does not authorize a diagnostic.
9. **AUTH-03 / D:** separately approve each exact control verification.
10. **DB-04…08, OPS-02…05, TOP-05:** only after the separate D approval in
    step 9, verify session controls, abort behavior, active monitors and alert
    delivery, approved thresholds, maximum elapsed duration, and the active,
    tested global fence with every writer accounted for. OPS-03–05 must not be
    executed before D approval.
11. **AUTH-04 / E:** independently authorize one exact P-05 PREFLIGHT.
12. **AUTH-04 / F:** only after independently accepted PREFLIGHT evidence,
    manually authorize one exact SCAN. Never promote automatically.
13. **G/H:** retry or change only under a new independent approval.

Any failed or stale predecessor blocks all dependent steps.
