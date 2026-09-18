# Blocking dependencies

## Critical blockers

### TOP-05 — active and tested global write fence

- **Obtained by:** operations-owner.
- **Reviewed by:** system-owner, database-owner and independent-reviewer.
- **Must prove:** the fence is active for the exact target and all API,
  background, scheduler, previous-revision and startup writers are rejected or
  drained throughout the window.
- **Not acceptable:** design documents, source code, a single stopped service,
  or an untested maintenance toggle.
- **Blocks:** limited data scan, P-05 and every operation requiring exclusive
  maintenance.

### BKP-04 — successful restore rehearsal

- **Obtained by:** recovery-owner.
- **Reviewed by:** independent-reviewer.
- **Must prove:** an actual isolated restore of the exact target-bound backup,
  with timestamps, restore point, measured duration and integrity checks.
- **Not acceptable:** “backup enabled”, a backup success badge, a runbook, or a
  development restore unrelated to the target.
- **Blocks:** production access and every dependent diagnostic.

### AUTH-02 — configuration-read approval

- **Obtained by:** system-owner through the approved authorization system.
- **Reviewed by:** security-owner or independent-reviewer.
- **Must prove:** explicit B approval for exact target, scope and time window.
- **Not acceptable:** A approval or an empty form.
- **Blocks:** every production configuration read.

### AUTH-03 — connection and diagnostic approvals

- **Obtained by:** system-and-data-owners.
- **Reviewed by:** security-owner and independent-reviewer.
- **Must prove:** distinct C and D records; C never implies D.
- **Not acceptable:** one broad “database access” approval.
- **Blocks:** database connection and every diagnostic.

### AUTH-04 — P-05 and retry approvals

- **Obtained by:** independent-reviewer through the approved authorization
  system.
- **Reviewed by:** a separate authorized reviewer.
- **Must prove:** separate E, F and G decisions; F is bound to one accepted
  PREFLIGHT and never follows automatically.
- **Not acceptable:** inherited, automatic, standing or self-approved access.
- **Blocks:** PREFLIGHT, SCAN and retry respectively.
