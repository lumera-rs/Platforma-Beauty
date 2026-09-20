# Phase 5B production baseline-adoption runbook

This document is a plan. It does not authorize production adoption, migration
apply, deployment, backup deletion, or restore.

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