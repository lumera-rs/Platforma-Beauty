# Phase 5 independent review — supplied findings

This is the review supplied by the owner for remediation, not a new independent
verification performed by Replit Agent.

Reviewed branch: `remove-startup-ddl-preparation`.
Reviewed HEAD: `343ea5ae`.

| ID | Severity | Supplied finding |
| --- | --- | --- |
| F-1 | HIGH | Branch contains 61 commits and 330 changed files. Actual startup DDL removal work covers seven commits and 117 files. Prepare a focused PR without losing prior work. |
| F-2 | HIGH | `supported-state.integration.test.ts:408` fails because its expected error regex does not match `LEDGER_DATA_MIGRATION_ADOPTED:000002`. Actual result was 14/15 PASS. Preserve fail-closed behavior and correct the test. |
| F-3 | HIGH | Eleven new test files are missing from package scripts and CI. Wire them into reproducible commands and appropriate CI jobs. |
| F-4 | MEDIUM | `supported-path-boot.integration.test.ts` can falsely pass with missing or incorrectly formatted PostgreSQL logs. Require valid, nonempty database-tagged logs. |
| F-5 | MEDIUM | `readiness.ts` pins PostgreSQL to exact version `160010`. Investigate PostgreSQL 16 patch compatibility without weakening schema validation. |
| F-6 | MEDIUM | `supported-convergence.integration.test.ts` hardcodes localhost port `40247` and ignores `--admin-url`. |
| F-7 | MEDIUM | The supported-path boot test modifies version-controlled evidence. Use a separate output location or explicit regeneration mode. |
| F-8 | LOW | `phase-gate-status.md` contains outdated statements that all eight startup calls remain. |
| F-9 | LOW | `DATA_CHECKSUM` and `dataMigrationChecksum` misleadingly name schema migration `000002`, not the separate data-migration files. |
| F-10 | LOW | Evidence transcripts contain 21 `git diff --check` findings. Code directories and working tree were clean. |

The reviewer verified removal of all eight ensure imports/calls and read-only,
fail-closed readiness. It reproduced 156/156 tests, but the additional supported
state suite was 14/15.

Review verdict: development PR **NOT READY**; live deployment **NOT READY**.

Replit Agent owns implementation. Claude Code is strictly the read-only
independent reviewer and must not implement fixes. Production access, persistent
database changes, publication, merging and automatic pushing/PR creation are
not authorized.