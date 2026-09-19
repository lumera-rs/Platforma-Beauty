# Phase 5 review remediation

## Review scope and preservation

Source findings: [independent review](phase5-independent-review.md).
Replit Agent implemented these changes; Claude Code was not invoked to edit or
implement anything. This is an implementation/test report, not independent
approval.

The original `remove-startup-ddl-preparation` branch remains at
`343ea5aec9f9b5728484cb6ea16112a94b60f971`. Its full history and original evidence
are preserved. Work continues on local branch `phase5-focused-review`.

**Focused review base:** `80f822ac` (`fix-production-demo-seed-boundary`).
The original Phase 5 range contains seven commits and 117 files:

1. `d210643b` — DDL removal preparation.
2. `81546540` — equivalence characterization.
3. `28dc3192` — initial data migrations.
4. `5d3368ca` — subscription reconciliation.
5. `f725ed72` — phase-gate evidence.
6. `77a3a9ae` — supported migration runner.
7. `343ea5ae` — runtime readiness and startup removal.

Remediation changes are additional to that range. This is a **stacked review**
against the prerequisite base, not a standalone `main` PR. The 54 prerequisite
commits are intentionally preserved; a `main` comparison would still include
them. No reset, rebase, cherry-pick, merge, push or PR creation was used.

Review the intended range with:

```sh
git diff fix-production-demo-seed-boundary...phase5-focused-review
git log --oneline fix-production-demo-seed-boundary..phase5-focused-review
git rev-parse remove-startup-ddl-preparation
```

## Finding dispositions

| ID | Correction |
| --- | --- |
| F-1 | Separate local review branch and explicit stacked base; original branch/history preserved. A main-targeted PR is not claimed focused. |
| F-2 | Match the precise `LEDGER_DATA_MIGRATION_ADOPTED:000002` rejection; verify execution and explicit baseline adoption both preserve data and ledger. |
| F-3 | Database-free and disposable database tests have package entrypoints and CI wiring, including an executable coverage inventory. |
| F-4 | Boot evidence must prove readable, correctly tagged, live PostgreSQL logging; missing/empty/invalid evidence cannot imply zero DDL. |
| F-5 | Accept only the reviewed PostgreSQL 16 deparser family with exact catalog identity and receipt validation. Patch-only version differences no longer cause refusal by themselves. |
| F-6 | Convergence fixtures consume a validated explicit administrator URL, not a hardcoded port. |
| F-7 | Normal test outputs go outside versioned evidence; archived proof files are not rewritten during testing. |
| F-8 | Current removal/readiness status is stated directly; earlier stop-gate assessments are clearly labeled historical and use past tense. |
| F-9 | Rename to `SUPPORTED_STARTUP_MIGRATION_CHECKSUM` and `supportedStartupMigrationChecksum`; preserve checksum values and distinguish the separate data-migration namespace. |
| F-10 | Normalize only trailing whitespace/extra EOF blank lines in the two identified transcripts. Historical failures, assertions and outcomes remain intact. |

The F-10 command produced 21 diagnostic/context lines at 11 locations. The
original bytes remain recoverable from the preserved branch. Original uploaded
request attachments are not rewritten; their inherited CRLF formatting is
separate from the evidence-transcript finding.

## Compatibility and immutability

PostgreSQL 16 patch admission is conditional on the exact structural and
physical fingerprints, schema/fingerprint format versions, object counts,
reviewed deparser family and valid complete ledger. It is not a guarantee that
all future PostgreSQL patch releases have identical deparser output. Any
resulting catalog identity drift still refuses startup/adoption.

The baseline manifest's PostgreSQL 16.10 metadata remains historical evidence,
not a mutable runtime-version setting. No numbered schema or data migration
body, migration metadata file or checksum has been changed.

## Verification

Verified on 2026-09-17, using installed PostgreSQL **16.10**. Only newly
initialized temporary clusters and their owned child databases were used.

### Reproducible commands

```sh
pnpm run test:migrations:phase5:inventory
pnpm run test:migrations:phase5:unit
pnpm run test:migrations:phase5:integration -- --output-dir=/tmp/lumera-phase5-integration
# Targeted recovery regression:
pnpm run test:migrations:phase5:integration -- --suite=interrupted-recovery --output-dir=/tmp/lumera-phase5-recovery
```

The integration command initializes its own PostgreSQL 16 cluster on a random
loopback/non-5432 port. It never chooses an ambient database URL. Each file must
report nonzero tests/passes and zero failures/skips. Output is restricted to
ignored `.local/` or external directories. The runner stops and removes its
cluster and verifies child database cleanup, including on failed suites.

The inventory covers 24 entrypoints: 13 database-free, nine disposable
integration files, one already executed by the existing Phase 4 command, and
one explicitly superseded pre-removal crosswalk. The inventory guard itself is
also part of the database-free command. All eleven latest-commit entrypoints
are included. Eight independently selectable integration suites cover 53 tests.
GitHub Actions runs the same package commands and uploads the output; that
remote CI job has not been executed during this local remediation.

### Exact results

| Check | Result |
| --- | --- |
| Phase 5 database-free command | **66 passed, 0 failed, 1 skipped** (67 total). The skip is the optional, pre-removal disposable characterization inside `fixtures.test.ts`, not a Phase 5 integration success claim. |
| Final runner/inventory checks after the last guard and suite-selection edits | **8/8 passed**, no skips. |
| Fingerprint/schema-drift/eligibility tests | **115/115 passed**, no skips. |
| Migration-contract and CI-contract tests | **60/60 passed**, no skips. |
| Root `pnpm run typecheck` | Passed. |
| Scripts TypeScript after the final edits | Passed. |
| Startup DDL removal gate | Passed; 148 modules scanned. |
| GitHub workflow lint | Passed. |
| Supported state | **15/15 passed**; both adopted-data apply/adopt rejection paths leave data and ledger unchanged. |
| Supported convergence | **4/4 passed** using the supplied random-port administrator URL. |
| Adoption boundary | **1/1 passed**. |
| Namespace boundary | **1/1 passed**. |
| Actual entrypoint boot | **4/4 passed**, covering eight startup/refusal windows with live, database-tagged pre/post probes. |
| Legacy broken-state refusal | **1/1 passed**. |
| Historical startup data | **13/13 passed**. |
| Subscription reconciliation | **13/13 passed**, including tenant/owner preservation cases. |
| Interrupted recovery, corrected expectation | **1/1 passed** on a new owned cluster; two retry attempts preserve the incomplete ledger and leave rolled-back data absent. |
| Versioned evidence stability during integration testing | Before/after SHA-256 lists identical. |
| Immutable migration directories | No changes relative to reviewed HEAD. |
| Whitespace | Working diff and focused range excluding original uploaded attachments passed. No claim that inherited attachment CRLF warnings were removed. |

**Do not read this as one uninterrupted 53/53 run.** The full invocation passed
52 tests, then failed the historical recovery test. That older test expected
automatic retry of an `APPLYING` baseline. Phase 5 intentionally rejects it as
`LEDGER_INCOMPLETE:000001`. The test now verifies transaction rollback, exact
rejection and unchanged receipts over repeated attempts; the production guard
was not weakened. Its isolated rerun passed. All 53 current integration checks
therefore have passing evidence across the full run and the targeted correction.
The full default command was not rerun after this test-only correction and
suite regrouping.

Two additional setup observations are retained rather than hidden:

- The first cluster startup failed because the packaged binary expected
  `/run/postgresql`. The runner now puts sockets in its owned temporary data
  directory. That failed cluster was removed.
- A later invocation refused before creating a cluster because the editor had
  an ambiguous `REPLIT_ENVIRONMENT` label. The guard now follows the existing
  project policy: explicit deployment flags/IDs and production `NODE_ENV`
  reject; that label alone does not establish a published runtime. The final
  recovery command ran without clearing deployment indicators. All targets
  remain exclusively runner-created local clusters.

The original full-run manifest correctly remains `failed`; the targeted
recovery manifest is `passed`. Both record `ownedClusterRemoved: true` and no
cleanup errors. Complete logs, manifests and SQL evidence are preserved in
ignored `.local/phase5-review-evidence/`, including the failed attempts.

PostgreSQL 16.11 and 16.99 compatibility was checked with simulated metadata
and identical fingerprints; unsupported majors and schema/deparser drift were
rejected. Those are **not** real-server tests on those patch versions.

## Remaining limitations and readiness

- No known unresolved F-2–F-10 code finding remains. F-1 is resolved as an
  explicitly stacked review against `fix-production-demo-seed-boundary`; it is
  not a clean standalone comparison against `main`.
- **Development review: ready for read-only independent re-review.** This is
  not Claude Code approval, remote CI success or authorization to merge. The
  original independent verdict remains archived unchanged.
- **Live deployment: NOT READY / not assessed.** No production access,
  persistent project database modification, migration/adoption on a persistent
  database, publication, merge, push or PR creation was performed.
- No application workflows were restarted. Actual API health and rejection
  behavior were checked only in owned disposable test processes; no claim is
  made that the persistent preview database has been prepared for this guard.