# Execution safety

Design-only: never execute SQL during design review. If later approved, use a dedicated least-privilege role, explicit READ ONLY transaction, statement timeout 15s, lock timeout 1s, idle transaction timeout 10s and strict connection cap.

Catalog metadata is preferred; relation scans are opt-in, allow-listed, bounded and cancellable. No pause, restart, deploy, startup invocation, migration, adoption or worker shutdown is assumed. Capture only minimized/bounded identifiers, hashes, counts and definitions: never payloads, secrets, credentials, tokens, URLs or personal data. Monitor IO, CPU, locks and connection saturation; cancel on thresholds and quarantine incomplete captures. Retry only approved idempotent captures with a new capture ID. Abort on unknown target, lock wait, timeout, result cap, privilege escalation or unexpected error. Recovery is cancellation and evidence quarantine; this design performs no mutation.

Approval requires system owner, data owner, business/policy owner and independent reviewer sign-off.

Limitations: catalog metadata cannot establish business authorization, deployment overlap, worker/scheduler behavior, retry idempotency, backup restore validity, monitoring health, or reviewer disposition. Those facts remain UNKNOWN and are represented as blockers rather than inferred query results. P-05 has ordered preflight and fixed public.shipping_rules aggregate scan statements; absent or nonmatching preflight results are BLOCKED_PRECONDITION without preparing or executing the scan.

The record-to-target manifest is an immutable input to a future executor. It preserves dynamic identities as blocked, binds every result to capture_id, record_id, and chunk_id, and requires sorted, digest-verified chunks no larger than 100. Namespace and relation allow-lists are both required for P-02; schema and approved function-name allow-lists are both required for P-08.

Malformed static identities are also blocked using a conservative case-insensitive parser-keyword set. D-04 is index-only: a validated parent table and index are both required, and constraints are not treated as index evidence.
