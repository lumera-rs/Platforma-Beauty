# Client robots: unavailable current-page responses

The client requires a successful response matched to the current route before
relaxing the existing robots directive (initially supplied by SSR). Loading,
paused requests, errors, absent data, and mismatched/inactive listing queries
are not successful responses. All listing families fail closed in these states;
the final head policy also protects static/fallback metadata and preserves
`nofollow` when no successful response is available. Detail loading tightens
robots without replacing SSR titles/images. Cached detail errors cannot confer
successful-response status. The original document's SSR robots are captured
before any metadata write, independently of the mutable DOM, and remain a
ceiling for that exact pathname and search string.

On an indexing-enabled host, independently of the staging override:

| City response | Policy | SSR noindex outcome |
| --- | --- | --- |
| Successful, at least one salon | indexable | Remains noindex |
| Successful, empty | noindex | Remains noindex |
| API error (including stale cached rows) | noindex | Remains noindex |
| Loading | noindex | Remains noindex |

Pure policy and the applied head are separate: successful populated data is
indexable by policy, but cannot override the original SSR noindex for that URL.
Conversely, original SSR index followed by temporary loading noindex can recover
to index after a successful populated response. A different SPA URL does not
inherit the original URL's ceiling; without a successful response it still
cannot relax the current DOM robots. Returning to the original URL reapplies
its original ceiling. The snapshot is held per Document (not per component
mount), and URL matching includes city/page search parameters rather than just
the canonical path. Site-wide staging/disabled-host noindex remains unconditional.
Static pages without an API response may preserve an existing index directive
but cannot lift an existing noindex. Missing-page-number query keys mean page 1,
never permission to reuse page 1 for page 2.

## Verification and mutation

Existing staging assertions are unchanged. The client suite adds allowed-host
policy tests for populated/empty/error/loading/no-data/paused/refetch-error,
general metadata restrictions, active stale city/page data, original-SSR-index
recovery, and URL-scoped SSR ceilings across navigation and return.

- Final client suite: 30/30 passed, including a repeat after mutation.
- SEO policy: 4/4 passed.
- SEO build lifecycle: 1/1 passed.
- SEO server: 44/44 passed on isolated rerun.
- Marketplace `tsc -p tsconfig.json --noEmit`: passed.

The initial combined Node invocation ran the build lifecycle (which removes
`dist`) concurrently with server tests: 48 passed, one failed with `ENOENT`
opening `dist/public/index.html`. Separate runs above pass; the full initial
failure is retained rather than presented as an application regression.

Final mutation was confined to `/tmp/lumera-afternoon-robots-final-3USnv8`, copying the
marketplace source and sharing dependencies only. Changing the listing error
branch back to `indexable: true` produced exit 1, 28 passes and two failures:

> AssertionError [ERR_ASSERTION]: city error: policy must require a successful populated current response
> true !== false

The second failure is the corresponding `city refetch-error` assertion.
This verifies the underlying policy, not a staging-masked head result; the
independent head guard remains defense in depth. Repository source was never
mutated to the unsafe behavior.

Full local evidence is ignored under `recovery-backups/afternoon-robots/`:
final proof: `mutation-final-failure.log`, `scratch-final-path.txt`,
`client-final-ssr-ceiling.log`, `client-final-after-mutation.log`,
`typecheck-final-ssr-ceiling.log`, `seo-policy-final.log`, `seo-server-final.log`.
Earlier iteration and build evidence: `mutation-failure.log`, `scratch-path.txt`, `client-tests.log`,
`client-fixed-after-mutation.log`, `typecheck.log`, `seo-suites.log`,
`seo-policy.log`, `seo-build.log`, and `seo-server-rerun.log`.
These are local recovery artifacts, not portable CI attachments. No browser or
production verification was performed; no staging override was disabled.

## SEO standards harness correction

CI exposed a stale assertion in `scripts/src/seo-standards.test.ts`: after
applying staging metadata, the harness changed the same document's site-indexable
flag to true and expected `index, follow`. Runtime correctly returned
`noindex, nofollow`. The harness now retains staging configuration throughout,
seeds genuine SSR robots and a complete URL, and asserts that successful
metadata still leaves the document noindex. Pure helper assertions separately
cover SSR-index recovery and the SSR-noindex ceiling without enabling the
staging document. No runtime policy was weakened.

- Exact `pnpm --filter @workspace/scripts run test:seo-standards`: passed
  (5 public-address tests, 4 address-input tests, 32 public React routes and
  16 schema contracts).
- Client metadata suite: 30/30 passed.
- Scripts `tsc -p tsconfig.json --noEmit`: passed.
- `git diff --check`: passed.

Local evidence: `seo-standards-correction.log`,
`client-after-standards-correction.log`, and `scripts-typecheck-correction.log`
under the same ignored recovery directory. The standards test is listed in the
protected operation-matrix manifest; its changed source needs the owning
agent's normal inventory/provenance classification review. No manifest or historical hash
entries were changed as part of this test correction.