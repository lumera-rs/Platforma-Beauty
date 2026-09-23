# Job first-publication migration evidence

## Scope and baseline

Migration `000004_job_first_publication` adds exactly one nullable column:
`public.beauty_job_listings.first_published_at TIMESTAMP WITH TIME ZONE`.
The Drizzle property is `firstPublishedAt`, following the table's existing
timezone-aware timestamp convention. There is no default, backfill, index,
trigger, admission contract, or startup DDL addition.

The transactional PostgreSQL 16 header requires the table to exist and the
column to be absent. Its postcondition checks the column's exact type,
nullability, and absence of a default. A failed precondition/postcondition or
fingerprint check rolls the transaction back; correct the cause before retrying.
The disposable integration test also forces postcondition failure, proves
catalog/ledger rollback, retries successfully, and confirms a preexisting
approved listing still has a NULL value.

The baseline remains `000001`; its checksum, structural/physical fingerprints
and object count are unchanged. `000002` and `000003` pins also remain unchanged.
Only HEAD/readiness advances to the complete `000001`–`000004` frontier.

## Computed PostgreSQL 16 head

`pnpm --filter @workspace/scripts exec tsx src/migrations/calibrate-job-publication-head.ts`
creates and owns a disposable PostgreSQL 16.10 instance, declares its database,
cluster identifier and unencrypted transport, and applies SQL through the
migration runner. It first observes the actual fingerprint during the
transaction which deliberately fails the stale previous-head pin and rolls
back. It then reapplies through the runner using those computed values,
verifies the read-only catalog, and checks readiness. No fingerprint is
hand-computed and no development connection string is used for calibration.

Verified disposable identity: database `postgres`, system identifier
`7688344968567262857`, unencrypted transport.

| Pin | Value |
| --- | --- |
| SQL SHA-256 | `0e2e866fe285d43fb7a8b5508cb60c44df4e7d333961247c31879f2f2cd91083` |
| HEAD structural | `805c6d8d8a375ffd842b92ce018073627a9f82fe40d81537ceed1494f913f7e9` |
| HEAD physical | `60400deed8e8d3521ebf2af5c2e3ae2c491be8dffa0dd654c644fe44930bf3ce` |
| Normalized objects | 5065 |
| PostgreSQL / fingerprint / format | 160010 / 4 / 2 |
| Enums / triggers / functions | 103 / 24 / 21 |

## Authorized development application

Read-only identity verification confirmed database **heliumdb**, cluster system
identifier **7675816360536354836**, PostgreSQL **160010**, and **unencrypted**
transport. Application invoked `scripts/src/migrations/cli.ts` through `tsx`,
with command `apply`, an explicitly supplied connection from the existing
environment (never printed), `--confirm`, `--expected-database=heliumdb`,
`--expected-system-identifier=7675816360536354836`, and
`--expected-transport=unencrypted`.

The runner applied only `000004` and skipped `000001`, `000002`, `000003`.
Subsequent read-only inspection confirmed:

- Every ledger entry `000001`–`000004`: **APPLIED**, transactional, expected
  checksum, no error.
- Readiness: **ready=true**, ledger **VALID**, catalog **CANONICAL**.
- Development structural/physical fingerprints and count exactly equal the
  computed disposable HEAD above.

Integration tests use the owned Phase 5 disposable runner and declared target
identities, never this development database. No production connection,
production authorization, deploy, publish, Drizzle push, or equivalent occurred.
The Phase 5B runbook records the new frontier without changing its production
gates. Local raw calibration, identity, application and verification evidence
is retained in ignored `recovery-backups/job-publication/`.

## Local migration checks

- Phase 5 unit command: 83 passed, one explicitly skipped disposable
  equivalence characterization (84 total; no failures).
- Focused migration unit command: 23/23 passed.
- Migration header/CI contract command: 60/60 passed.
- Disposable integration runs: phase4 migrations 37/37; target identity 6/6;
  supported state 15/15; supported convergence 4/4; adoption boundary 1/1;
  namespace boundary 1/1; actual entrypoint boot 5/5. Total: 69 passed.
- Scripts TypeScript `--noEmit` and `git diff --check`: passed.

The final integration manifests record successful owned-cluster cleanup under
`.local/job-publication-phase4-final/`, `.local/job-publication-identity-final/`,
`.local/job-publication-supported-state/`, and `.local/job-publication-remaining/`.
An initial combined run exceeded the shell's five-minute limit after its first
two suites; the successful final runs above are the completed evidence, not that
interrupted command. An initial output-directory refusal was also corrected to
the runner's required ignored `.local/` location.

## Legacy date meaning

Existing rows remain NULL. Application display and JobPosting `datePosted` use
the original creation time only when first publication is empty. For listings
created before this change that creation-time fallback is an **approximation**,
not a reconstructed approval date: the last-moderation timestamp is overwritten
and moderation audit history does not record every public-visibility transition.