# Authorized second-test-branch rehearsal

Only `LUMERA_NEON_TEST_BRANCH2_URL` was read. No other Neon URL or secret,
development database, or production environment was selected. The disposable
source was built through the migration runner. No application schema was
created or changed on Neon.

## Declaration and authority

The pinned declaration was taken from the prior authorized test evidence in
`docs/neon-target-identity/follow-up-verification.md`, not inferred from the
current candidate connection:

- database: `neondb`
- system identifier: `7688718332222926027`
- backend transport observation: `unencrypted`
- Neon project: `patient-band-58516090`
- Neon branch: `br-odd-sound-b1os4cyc`

This is reuse of a prior test record for the specifically authorized branch,
**not independently authenticated control-plane proof or production approval**.
The backend transport observation is not a claim that the external client
connection lacks TLS. The harness verifies every declared component before
calling the existing binding CLI.

## Actual execution

The process ran with a clean environment containing HOME, a PostgreSQL-free
PATH, CI/test markers, `LUMERA_POSTGRES_16_BIN`, and only the authorized named
secret. Actual output:

```text
BINARY_PROOF command -v initdb: not found
NEON_DECLARATION verified=1 prior_record=1 control_plane_proof=0
{
  "bound": [
    "000001",
    "000002",
    "000003",
    "000004"
  ]
}
NEON_REHEARSAL status=rehearsed tables=256 blockers=0 vacuum_recommended=true
NEON_AFTER readiness=true data_unchanged=true ledger_unchanged=true triggers_unchanged=true structural_unchanged=true physical_unchanged=true
OWNED_SOURCE_REMOVED
```

The log also contains the PostgreSQL driver's SSL-mode compatibility warning;
it is retained in `.local/data-transfer-fix/neon-rehearsal.log`, not hidden or
reported as a connection verification result. The exit file contains `0`.

The harness privately copied target application seed rows into the owned
disposable source, never its ledger, then inserted one synthetic category in
that source. It used the real transfer engine with `rehearsal: true`.
The engine verified the proposed transfer and rolled back rather than committed.
All 256 proposed table counts and hashes matched. Before/after comparison covers
every target application table, the target ledger receipts, trigger states,
structural and physical fingerprints, and readiness.

The ledger comparison baseline is **after the authorized bind**. Binding the
four previously unbound target receipts is the sole intended persistent change.
No transferred row remained. The source cluster was removed.

The report recommends VACUUM after the rolled-back rehearsal; no VACUUM was
performed on the authorized branch as part of this task.

The runnable harness is `scripts/src/data-transfer-proof/neon-rehearsal.ts`.
It requires the explicit `--authorized-branch2-rehearsal` argument and is **not a
CI entry point**. Its JSON evidence contains only names, counts, hashes, safe
codes and status, never row contents or connection strings.

## Final-core repeat, without binding

After the engine's origin-session guard and SQLSTATE refinements, the harness
was rerun with `--authorized-branch2-rehearsal --already-bound`. This mode
refuses to bind or repair an unready target; it first verifies the pinned
identity and existing bound-ledger readiness. No further persistent change
was authorized or made.

The exact final output, apart from the same retained driver warning, was:

```text
BINARY_PROOF command -v initdb: not found
NEON_DECLARATION verified=1 prior_record=1 control_plane_proof=0
NEON_BIND already_bound_ready=true binding_skipped=true
NEON_REHEARSAL status=rehearsed tables=256 blockers=0 vacuum_recommended=true
NEON_AFTER readiness=true data_unchanged=true ledger_unchanged=true triggers_unchanged=true structural_unchanged=true physical_unchanged=true
OWNED_SOURCE_REMOVED
```

Evidence: `.local/data-transfer-fix/neon-rehearsal-final.log` and
`.local/data-transfer-fix/neon-rehearsal-final.exit` (`0`). The JSON evidence
was refreshed with the final run's before/after counts and hashes. Thus the
already-bound ledger, all application data, every trigger state, and both
fingerprints were unchanged during this repeat.