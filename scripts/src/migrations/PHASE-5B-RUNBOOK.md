# Phase 5B production baseline-adoption runbook

This document is a plan. It does not authorize production adoption, migration
apply, deployment, backup deletion, or restore.

## Explicit target identity (Phase 6 guard)

For `apply` or `adopt-baseline`, supply all three operator declarations in
addition to `--database-url` and `--confirm`:

```text
--expected-database=<intended database name>
--expected-system-identifier=<intended decimal PostgreSQL cluster identifier>
--expected-transport=encrypted
```

For an intentionally unencrypted owned local disposable instance use
`--expected-transport=unencrypted`. Development schema preparation takes the same
three identity arguments. Programmatic callers pass `expectedTargetIdentity:
{ databaseName, systemIdentifier, transport }`; never populate this object by
observing an arbitrary candidate migration target. Obtain and independently
approve the intended identity from the operator's trusted provisioning records.
The CLI rejects missing, repeated, or malformed identity declarations before
connecting.

The runner reads `current_database()`, `pg_control_system().system_identifier`
(as decimal text, not an imprecise JavaScript number), and `pg_stat_ssl.ssl` for
`pg_backend_pid()` on the dedicated backend that will perform the migration.
Every `apply` and `adopt-baseline` call checks these at entry, before manifest
selection, branching, any lock, transaction setup, or ledger mutation. This
includes baseline-only `000001`, empty migration sets, and already-applied or
already-adopted replays; supplied expectations are never ignored.
NULL server address/port values are irrelevant; neither function is used.
Missing rows, NULL transport evidence, denied function access, and mismatches
refuse without fallback. Baseline-only historical characterization must declare
its owned disposable identity and remains schema-only; it is not an alternative
supported full-chain adoption command. Identity verification neither grants
production permission nor relaxes adoption eligibility or the admission-contract
development-only guard.

`encrypted` means the PostgreSQL backend reports TLS, **not** that its certificate
or hostname was verified. A proxy's frontend TLS and backend TLS may differ.
Use independently authenticated endpoints and certificate-verifying driver
settings as well. System identifiers are cluster identities, not cryptographic
attestations: physical clones may share them. Database name plus system ID plus
backend transport is a wrong-target safeguard, not a defense against a malicious
server impersonating PostgreSQL.

PostgreSQL 16 restricts `pg_control_system()` by default. Hosted Neon roles may
not have permission; provider-specific privileges/support are not established
by local disposable tests and no production connection was used to probe them.
The operator/provider must authorize access to this exact read-only function
(for example a narrowly scoped EXECUTE grant where supported), and confirm
own-backend `pg_stat_ssl` visibility. Otherwise this runner cannot proceed:
do not substitute a URL, address/port, self-declared database setting, or a weaker
identity. The additive Neon discriminator below does not bypass these required
backend queries or substitute a weaker identity.

### Neon branch discriminator

Neon branches can share all three declarations above. For a Neon-hosted target,
also supply both of these explicitly approved declarations:

```text
--expected-neon-project-id=<approved project id>
--expected-neon-branch-id=<approved br-... branch id>
```

The additive programmatic shape is
`{ databaseName, systemIdentifier, transport, neon: { projectId, branchId, timelineId? } }`.
The required pair is checked against `neon.project_id` and `neon.branch_id`.
An optional `--expected-neon-timeline-id=<32 lowercase hexadecimal characters>`
adds an exact timeline check; omitting it does not require a timeline match.
The old tenant flag is not a substitute for the required pair.

Obtain the expected project and branch IDs independently of the target SQL
connection, using an authenticated Neon control-plane account:

- Console URL: open the intended project and branch. The project route contains
  `/app/projects/<project_id>` and its branch route contains
  `/branches/<branch_id>`. Copy IDs, not display names or compute endpoint IDs.
- Console branch page: select the intended project, open **Branches**, and
  confirm the selected branch's ID and project before approving the target.
- API: authenticated `GET https://console.neon.tech/api/v2/projects` lists project
  IDs; `GET https://console.neon.tech/api/v2/projects/<project_id>/branches`
  returns branch objects whose `id` is the required `br-...` identifier.
- CLI: `neonctl projects list` and
  `neonctl branches list --project-id <project_id> --output json` provide the
  same independent identifiers. Current Neon CLI documentation uses the
  `neon` executable name for these commands; use the installed CLI's name.

Approve and record these values before connecting the migration runner. Reading
whichever candidate SQL URL was supplied and automatically trusting its pair
would defeat the wrong-target safeguard. A same-connection observation in a
regression proof is deliberately a test fixture, not an operator approval flow.

A point-in-time restore of an existing branch keeps that branch's ID. The backup
branch Neon creates has a different branch ID and is rejected by the original
declaration. The underlying timeline can change: if an optional timeline pin
was approved, a restore can invalidate it and requires a separately approved
replacement. Do not silently recapture it from a candidate target.
See [instant restore](https://neon.com/docs/introduction/branch-restore),
[CLI branches](https://neon.com/docs/cli/branches), and
[branching API](https://neon.com/docs/guides/branching-neon-api).

The existing single identity SELECT reads the required pair and optional timeline using
`pg_catalog.current_setting('<setting name>', true)` on the same connected
backend. There is no additional round trip, schema object, or migration.
If all queried Neon values are NULL, the target retains the existing non-Neon checks and
must not receive a supplied Neon discriminator. This preserves the non-Neon
Replit/Helium and disposable PostgreSQL paths. If Neon evidence is present, both
required values must be valid and exactly match the caller's supplied pair. Missing,
partial, malformed, or mismatched evidence fails closed with the affected
`neon.projectId`, `neon.branchId`, or the optional `neon.timelineId` named in the error. Supplied declarations
are never ignored.

The [original verification report](../../../docs/neon-target-identity/verification.md)
preserves the historical tenant/timeline implementation evidence.
The [follow-up verification report](../../../docs/neon-target-identity/follow-up-verification.md)
records project/branch evidence, setting context/source, override attempts,
and direct/pooled identity proofs for the operator-verifiable contract.

This discriminator is not cryptographic server authentication and does not
replace verified transport or independently trusted provisioning evidence.
On non-Neon PostgreSQL, a database owner can define custom `neon.*` values;
those strings prove nothing about provider identity there. Do not treat
Neon-shaped settings on an arbitrary server as proof that the server is Neon.
**This change does not authorize a Neon-hosted database for production.**
That requires a separate decision and all existing authorization gates.

`REPLIT_ENVIRONMENT=production` alone is an editor workspace label, not deployment
authorization. All five development guards reject `NODE_ENV=production`,
case-insensitive `1`/`true` in either deployment flag, and the existence (even an
empty value) of either deployment ID. This change does not authorize production.

## Required frontier after adoption

The required frontier is now `000001`, `000002`, `000003`, **`000004`**. Migration
`000003_public_salon_entrance_details` adds only four nullable TEXT columns to
`public.salons`: `entrance_directions`, `intercom`, `floor`, and `apartment`.
It is transactional PostgreSQL 16 SQL with pre/postconditions and rollback
recovery; it has no admission contract. Production will need this migration
applied after separately authorized baseline adoption and the supported-state
transition. This statement is NOT production authorization: the existing
maintenance, restore-point, identity, and deployment gates remain mandatory.
Migration `000004_job_first_publication` then adds one nullable
`TIMESTAMP WITH TIME ZONE` column, `public.beauty_job_listings.first_published_at`,
with no default and no data backfill. It follows the same transactional
PostgreSQL 16 precondition/postcondition/rollback discipline and has no admission
contract. This new frontier likewise grants no production authorization.
No startup code applies this or any other migration.

The baseline fingerprint remains the catalog after `000001`. Supported-state
admission and convergence still use that baseline. Readiness uses separate
HEAD structural/physical pins and requires every migration in the frontier,
including the checksums and APPLIED receipts for `000003` and `000004`.

## Proven repository and platform contract

- The repository configures a public Replit Autoscale deployment target; repository
  configuration alone does not prove that a deployment is currently live.
- The API requires an externally injected `DATABASE_URL`, binds the injected
  `PORT`, and exposes `/healthz`.
- Repository API startup no longer runs the eight additive schema owners.
  `artifacts/api-server/src/index.ts` imports none of them, and
  `pnpm --filter @workspace/scripts run validate:ci:startup-ddl-removal-gate`
  passes against that entry point across 148 scanned modules. The 1,459
  operations are retained as the authenticated historical inventory and must not
  change in Phase 5B.
- Repository state does not prove what the deployed revision executes. Until the
  deployed-revision startup attestation required by readiness condition TOP-04
  exists, assume a live instance may still run startup DDL and fence
  accordingly.
- The repository does not pin a `[deployment]` run command. The configured
  build and artifact package start commands do not invoke `drizzle-kit push`,
  migration apply, or baseline adoption. Replit's exact revision-overlap and implicit
  production-schema-diff behavior is not proven. Treat it as unknown.
- Replit documents managed daily backups and point-in-time recovery. Current
  account retention, restore permissions, restore target behavior, and manual
  `pg_dump` access must be confirmed by the operator before Phase 5B.

## Mandatory restore-point acceptance

Do not proceed until evidence identifies the intended production database and
records a backup timestamp. Restore that point into an isolated disposable
PostgreSQL instance, prove it starts, verify expected schemas/tables and
representative aggregate row counts, inspect ledger state, calculate the v4
fingerprint, and prove production was not mutated during verification. A backup
that has not been restored successfully is not accepted.

No fixed maximum backup age is inferred. The operator must confirm the restore
point is current for the announced maintenance window and recreate it after any
unexpected deployment or schema change.

## Maintenance and exclusivity

1. Announce maintenance.
2. Freeze Publish, deployments, schema push, administrative DDL, startup schema
   actors, and every application revision capable of booting.
3. Because Autoscale instance overlap is unproven, stop application traffic or
   otherwise prove exclusive single-operator schema control.
4. Prove no second instance can boot between fingerprint inspection and ledger
   adoption.
5. Create and restore-test the current restore point.

## Read-only preflight

Run separately from Publish, with an explicit target and no URL logging:

```text
read -rsp 'Production database URL: ' DATABASE_URL_VALUE
printf '%s' "$DATABASE_URL_VALUE" | \
  pnpm migrations:preflight-adoption --database-url-file=/dev/stdin --confirm-preflight
unset DATABASE_URL_VALUE
```

The command performs one bounded `REPEATABLE READ READ ONLY` catalog snapshot.
It does not create the ledger, apply SQL, adopt, repair, seed, or call production
startup code. Capture its compact JSON output and require `readiness: READY`,
exact v4/format-2 structural and physical matches, counts 5060/103/24/21,
PostgreSQL 16.10, required extensions, and a missing ledger.

Abort on any mismatch, unsupported version, missing extension, unknown
migration, checksum/mode mismatch, `FAILED`/`APPLYING` row, uncertain target,
unverified restore, loss of exclusivity, stale backup, or schema change after
preflight. Never run the baseline migration against a mismatched existing DB.

## Future Phase 5B sequence

After separate human authorization only:

1. Record timestamp, release commit, migration ID/checksum, PostgreSQL version,
   restore-test status, pre-fingerprints/counts, and ledger state.
2. Execute explicit `adopt-baseline` once against the same explicit target.
3. Immediately inspect the ledger read-only.
4. Rerun preflight/fingerprint and require identical application fingerprints
   and counts with baseline state `ADOPTED`.
5. Run application readiness/smoke checks, exit maintenance, and monitor.

Successful adoption may change only migration-management state. The exact
`public.lumera_migration_ledger` ownership exception keeps that table outside
the application fingerprint; unrelated tables, routines, triggers, policies,
and extensions remain fingerprinted.

## Abort and restore decision

- If adoption was not attempted: fix the blocker; do not restore.
- If only a correctable ledger-only problem occurred and application schema/data
  are unchanged: keep maintenance active and obtain explicit review before any
  ledger correction. Do not automatically perform a full restore.
- If application schema changed unexpectedly: keep the system stopped and choose
  schema correction or verified restore based on evidence.
- If target identity was wrong, data/schema integrity is uncertain, or the
  application failure is plausibly caused by the procedure: invoke the verified
  provider restore plan.

Restoring an older full snapshot can discard production writes. Ledger-only
correction, schema correction, and full restore are separate operator decisions.

## Redacted evidence record

Record: timestamp, commit SHA, migration ID and SHA-256, fingerprint/format
versions, pre/post structural and physical match results, object counts,
PostgreSQL version, backup and restore-test status, adoption result, and ledger
state. Never record database URLs, hosts, usernames, passwords, tokens, SSL
secrets, SQL payloads, or customer data.