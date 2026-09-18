# Deployment and maintenance checklist

Required future evidence:

- active API instances and autoscale configuration;
- all current/previous revisions and overlap state;
- background workers and schedulers per instance;
- every active write path and startup-DDL reachability;
- an exclusive maintenance mechanism and global write fence;
- a time-bound test showing no concurrent writer can bypass the fence;
- drain/start/end timestamps, monitor output and responsible operators.

Control-plane inventory, application telemetry and owner attestations must refer
to the same target/window/revision set. Source documentation is not proof that a
mechanism is enabled. Owner-specific advisory locks do not prove a global fence.

Any unaccounted instance, revision, worker, scheduler, startup path or writer
keeps EV-TOP-05 and limited scans `BLOCKED`. Do not stop services or alter
deployment while using this preparation.