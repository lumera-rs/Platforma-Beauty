# Client robots: preserve the server decision while waiting

## Corrected rule (supersedes the previous afternoon interpretation)

The earlier instruction and implementation incorrectly tightened initial
SSR `index, follow` to noindex during loading/error and waited for success to
recover. **That behavior is superseded.** On the URL rendered by the server,
loading, errors, paused requests, missing data and malformed bodies preserve
the original SSR robots **exactly**. A temporary client failure is not evidence
against the server's result. Only a definitive successful response may tighten
that decision. Nothing lifts original SSR noindex for that URL.

The immutable snapshot is captured per Document before any metadata write,
including the visible-detail wait branch. DOM changes and component remounts
do not replace it. Different SPA URLs have no server decision: pending/error/
no-data responses are noindex even when the previous page was indexable.
Returning to the original URL reuses its server decision.

Route identity uses the shared `normalizedQuery` helper extracted into
`seo-policy.mjs` and reused by canonical listing logic: URLSearchParams sorting
and removal of empty values. The route key retains all nonempty filters and
page numbers; it does **not** use `listingCanonical`, which can fold distinct
filtered pages to a common parent. No pre-existing standalone sorted/empty-query
normalizer existed in this checkout, so this helper centralizes that behavior.

## Applied-head matrix

On an allowed site, for city listings:

| Current response | Initial SSR index | Initial SSR noindex | Different SPA URL, from either initial decision |
| --- | --- | --- | --- |
| Loading / paused | Exact SSR index | Exact SSR noindex | noindex |
| Error, including stale cached rows | Exact SSR index | Exact SSR noindex | noindex |
| No data / malformed body | Exact SSR index | Exact SSR noindex | noindex |
| Successful, populated | index | noindex | index |
| Successful, empty | noindex | noindex | noindex |

Existing `nofollow` is retained for unverified SPA states; original SSR
`noindex, nofollow` also remains restrictive after success. Staging/disabled-host
policy remains unconditionally `noindex, nofollow`. Pure populated-city
eligibility remains true, separately from the applied SSR restriction.
An empty education array is a definitive response, but education does not use
the empty-city exclusion; an absent/non-array education body is **not**
successful and cannot invent indexability.

## Tests and wiring

- The former “recovery after temporary loading noindex” test now requires exact
  initial SSR index through loading and error.
- `applySeo` is exercised for the server-index/noindex × loading/error/
  populated/empty matrix, followed by SPA navigation.
- An intentionally changed previous DOM robots value differs from the original
  snapshot, catching argument swapping as well as omitted snapshot wiring.
- Visible-detail waiting preserves initial SSR index and makes unrelated SPA
  routes noindex without replacing SSR titles/images.
- Normalized sorted/empty query variants keep the snapshot; distinct pages and
  filters sharing a canonical parent do not.
- Education undefined/null/object/malformed-list bodies exercise the actual
  `resolvePostMountSeo` → `applySeo` path with both SSR decisions and SPA routing.
- The original staging standards document remains unchanged. A **second**
  fake document has site indexing enabled and genuine SSR index, restoring
  positive `applySeo` integration coverage without toggling staging's flag.

## Local verification

- Client metadata: 33/33 passed, including a final post-mutation run.
- Exact `pnpm --filter @workspace/scripts run test:seo-standards`: passed
  (5 public-address tests, 4 address-input tests, 32 public React routes,
  16 schema contracts).
- Combined SEO policy/server suites: 50/50 passed.
- Marketplace and scripts `tsc -p tsconfig.json --noEmit`: passed.
- `git diff --check`: passed.

## Four independent scratch mutations

Each copy starts from the fixed source under
`/tmp/lumera-robots-preserve-FPSNN1/{loading,swap,omit,education}`. Only the named
mutation is applied in each copy; dependencies are shared, source is not.
All four exit 1 under the client suite, including actual `applySeo` assertions:

| Mutation | Pass / fail | Representative exact assertion message |
| --- | --- | --- |
| Write noindex instead of returning the initial SSR decision while waiting | 24 / 9 | `applySeo initial index, follow / loading` |
| Swap previous and server robots arguments in `applySeo` | 30 / 3 | `applySeo must not confuse previous robots with normalized original SSR robots` |
| Omit server snapshot argument in `applySeo` | 30 / 3 | `applySeo must receive the SSR snapshot during loading` |
| Restore `data?.items ?? data?.products ?? []` and remove the non-array guard | 32 / 1 | `SPA education no-data must not invent indexability` |

Each message is an `AssertionError [ERR_ASSERTION]`. The first three quoted
failures have actual `noindex, follow`, expected `index, follow`; the education
failure has actual `index, follow`, expected `noindex, follow`. Full failures
(including every additional failing test) and commands/results are retained in
ignored `recovery-backups/robots-preserve-ssr/`: `mutation-loading.log`,
`mutation-swap.log`, `mutation-omit.log`, `mutation-education.log`,
`scratch-root.txt`, `client-final.log`, `standards.log`, `policy-server.log`,
`client-typecheck.log`, and `scripts-typecheck.log`.

No unsafe mutation was applied to repository source. No browser, database,
production or deployment validation was performed, and no CI result is claimed.
Earlier evidence under `recovery-backups/afternoon-robots/` belongs to the
superseded instruction and is retained only as historical local evidence.
Timing attribution and protected-hash classification are handled separately;
this implementation did not amend manifests, provenance or historical tiers.