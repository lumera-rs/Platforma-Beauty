# Canonical policy for salon city listings

The server and browser use `listingCanonical(pathname, search)` from
`artifacts/beauty-marketplace/seo-policy.mjs` as the shared URL contract.

For `/saloni`, the unfiltered listing and a listing filtered by exactly one
non-empty `city` are indexable canonical families. Page 1 always canonicalizes
to the URL without `page`; page 2 and later retain their normalized page number.
A city combined with another filter canonicalizes to the city parent. Other
filters canonicalize to `/saloni`.

City pages use the explicit locative mapping when available, for example
`Saloni u Beogradu`. An unmapped city uses neutral wording, for example
`Saloni Nepoznat grad`, and never guesses a locative.

The SSR response marks a city listing with no public salon results as
non-indexable. Deployment policy remains authoritative: staging and any host
without the exact indexability opt-in always emits `noindex, nofollow`,
including in all SEO tests.

If the public listing API is unavailable, query responses remain non-indexable
but retain the same shared canonical decision, including city parents and
normalized page-one/page-two URLs.

## Client navigation guard proof — 22 September 2026

The existing `scripts/browser/client-seo-navigation.spec.ts` now starts on home
and navigates to a salon while that salon's actual API response is held. It
asserts that the previous page's managed JSON-LD is already absent. All original
detail-request counts, terminal-404 checks, history/pagination checks, and
staging `noindex, nofollow` assertions remain.

For late completion, Playwright intercepts only the test-served Vite metadata
module and inserts a deferred promise immediately before the real resolver's
existing guarded completion callback. The production module has no testing
flag or alternate resolver. This scheduling is necessary because the generated
visible query correctly aborts HTTP on unmount; waiting for an aborted HTTP
response would never exercise the completion guard. After the slow salon's
actual DTO is loaded and its metadata completion is held, the test navigates
to home, captures its Organization/WebSite JSON-LD, releases the held completion,
waits for that callback to settle, and requires the active home JSON-LD to be
byte-identical.

Baseline and independent scratch copies ran with `DATABASE_URL` removed and
`SITE_INDEXABLE=false`, using the existing browser command and isolated ports:

| Run | Location / port | Result |
| --- | --- | --- |
| Baseline | repository / 4197 | PASS, 1 test, 7.5 seconds test time / 10.5 seconds total |
| Late-completion mutation | `/tmp/lumera-city-late-mutant` / 4198 | Expected FAIL at spec line 218 |
| Eager-cleanup mutation | `/tmp/lumera-city-cleanup-mutant` / 4199 | Expected FAIL at spec line 131 |

The late-completion scratch copy changed exactly the successful completion
condition; the rejection-path guard was retained:

```diff
-      if (!cancelled && request === generation) {
+      if (true) {
```

Failure: **“late salon resolution must leave the active home JSON-LD
byte-identical”**. The expected value contained home's Organization/WebSite;
the actual value contained `SEO Slow Salon` HealthAndBeautyBusiness and its
BreadcrumbList.

The cleanup scratch copy removed the eager route clear and its redundant
pending-detail/list clears. Replacement with a completed DTO and error cleanup
were retained:

```diff
     if (lastRoute.current !== route) {
       preserveInitialSchema.current = false;
-      replacePageStructuredData();
+      // Scratch mutation: eager route cleanup removed.
     }
```

```diff
     if (detail && !visibleDetailReady(queryClient, detail)) {
-      if (!preserveInitialSchema.current) replacePageStructuredData();
+      // Scratch mutation: eager pending-detail cleanup removed.
       return;
     }
```

```diff
-        } else if (!preserveInitialSchema.current) replacePageStructuredData();
+        }
```

Failure: **“previous home JSON-LD must be gone while new salon data is held”**;
expected **0** managed scripts, received **1**. No production protection was
removed for either experiment.

Full logs are retained locally (ignored, not committed):

- `recovery-backups/seo-task2/daily-city-browser-baseline.log`
- `recovery-backups/seo-task2/daily-city-browser-late-mutant.log`
- `recovery-backups/seo-task2/daily-city-browser-cleanup-mutant.log`

The tested baseline metadata source SHA-256 was
`5f05d94e58638cd035201b6827e25cd0be991bc9d75b0bab04c361ece49a00c0`.
The subsequent audit refactor delegated the identical eligibility normalization
to shared `listingIndexable`, without changing either lifecycle guard or the
browser fixture. The revised source SHA-256 is
`2ec9825e47780b05493913b8803f06da1be40ce44223b26c1a4d1f00761c00a4`.
Client metadata tests passed **19/19** and frontend TypeScript passed again
after that delegation; the successful baseline also passed browser-spec
typechecking and frontend performance standards.