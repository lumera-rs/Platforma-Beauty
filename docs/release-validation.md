# Release validation report

## Release candidate

- **Tested source commit:** `831fbef6ac91b5216cded0912e948c076ee4ac24`
- **Validated on:** 2026-08-23 (UTC)
- **Result:** passed — no release checks were skipped.

## Initial result and resolution

The first unfiltered `pnpm run validate:release` run, on
`261a7005e3acfd2ab38c3852700670a9c04c44fa`, stopped in the static backend
standards check. It reported that the admin salon PATCH handler did not use
`db.update(salonsTable)`.

This was a false negative in the checker: the handler correctly performs the
salon update as `tx.update(salonsTable)` inside a database transaction, then
publishes the shared `salons` catalog invalidation after the transaction
succeeds. The checker now accepts either database handle while retaining its
post-update invalidation requirement.

## Successful validation

The following commands completed successfully against the tested source
commit:

| Check | Result |
| --- | --- |
| `pnpm run validate:release` | Passed in full, including typecheck, all builds, static and database standards, tenant isolation, cache, authorization, integration, and SEO checks. |
| `pnpm run test:tenant-isolation` | Passed with no skips. The matrix exercised adversarial cross-tenant references, same-owner multi-location switching, foreign mutation rejection, public/enrolled education access, and fixture cleanup. |
| `pnpm run test:booking-journey` | Passed: 10/10 Playwright scenarios, including the mobile deep-scroll and public iframe-widget regressions. |

The raw output from the first attempt, successful release run, isolated tenant
matrix, and final booking run was retained in the validation session logs.