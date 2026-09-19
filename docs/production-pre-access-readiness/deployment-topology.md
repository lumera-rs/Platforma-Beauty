# Deployment topology

## Intended topology found in source

- `.replit` selects Replit autoscale deployment and application routing.
- The API package builds and starts one Node process per application instance.
- API startup invokes eight schema/index ensure or reconciliation owners before
  listening.
- A legacy media-reference migration is launched after listen.
- The API process constructs numerous scheduled jobs/workers and runs startup
  and recurring schedules in-process.
- Graceful shutdown clears timers, stops jobs/listeners and closes the DB pool.
- Some startup owners and domain operations use PostgreSQL advisory locks.
- Scheduler health/capacity guards are partly process-local; selected workers
  add durable DB coordination.

These statements are `VERIFIED` only as source/configuration facts.

## Unknown production topology

The repository does not prove:

- live API instance count or autoscale cardinality;
- current and previous deployed revisions or rollout overlap;
- which workers/schedulers are active in each instance;
- whether startup DDL remains reachable in the deployed revision;
- process drain state, in-flight writers or background queue state;
- live lock/session state;
- a separately deployed scheduler/worker topology.

All are `UNKNOWN`.

## Exclusive maintenance assessment

No global maintenance switch, endpoint-wide write fence, global advisory lock
honored by every request/worker, or proven revision-drain mechanism was found.
Owner-specific startup locks and business-key locks do not fence the platform.
Graceful shutdown is not maintenance exclusivity.

Therefore an exclusive maintenance mode is **not proven** and readiness is
`BLOCKED`. Future evidence must be a fresh system/operations-owner attestation
and control-plane inventory showing revision, instances, writers, workers,
schedulers, startup reachability, drain/fence mechanism, window and rollback.
This preparation does not stop or reconfigure any process.