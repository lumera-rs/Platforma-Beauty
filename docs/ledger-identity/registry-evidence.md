# Destructive-harness registry evidence

The database-free focused command completed with exit code `0` and reported
`tests 40`, `pass 40`, and `fail 0`. Its unaltered streams and status are:

- `.local/ledger-identity/registry/focused-registry.stdout`
- `.local/ledger-identity/registry/focused-registry.stderr`
- `.local/ledger-identity/registry/focused-registry.exit-code`

The focused test is persistently included in
`test:api-regressions-lifecycle`. The following are all 38 mutation failure
messages quoted from the preserved focused stdout, in emitted order:

> `isolated browser must invoke the shared destructive-runtime guard`
>
> `isolated API must invoke the shared destructive-runtime guard`
>
> `isolated API regression must invoke the shared destructive-runtime guard`
>
> `booking load must invoke the shared destructive-runtime guard`
>
> `booking load HTTP suite must invoke the shared destructive-runtime guard`
>
> `API regression lifecycle must invoke the shared destructive-runtime guard`
>
> `owned disposable PostgreSQL runner must invoke the shared destructive-runtime guard`
>
> `schema drift audit must invoke the shared destructive-runtime guard`
>
> `schema fingerprint must invoke the shared destructive-runtime guard`
>
> `schema baseline eligibility must invoke the shared destructive-runtime guard`
>
> `schema fingerprint golden fixture must invoke the shared destructive-runtime guard`
>
> `schema fingerprint integration must invoke the shared destructive-runtime guard`
>
> `schema drift integration must invoke the shared destructive-runtime guard`
>
> `backend standards database fixtures must invoke the shared destructive-runtime guard`
>
> `backend standards combined runner must invoke the shared destructive-runtime guard`
>
> `external database pool integration must invoke the shared destructive-runtime guard`
>
> `admin summary must invoke the shared destructive-runtime guard`
>
> `booking P1 regressions must invoke the shared destructive-runtime guard`
>
> `business growth schema must invoke the shared destructive-runtime guard`
>
> `final booking hardening must invoke the shared destructive-runtime guard`
>
> `HTTP security hardening must invoke the shared destructive-runtime guard`
>
> `query count must invoke the shared destructive-runtime guard`
>
> `retail checkout must invoke the shared destructive-runtime guard`
>
> `shipping configuration must invoke the shared destructive-runtime guard`
>
> `marketplace query budget must invoke the shared destructive-runtime guard`
>
> `Education extras must invoke the shared destructive-runtime guard`
>
> `Education financial must invoke the shared destructive-runtime guard`
>
> `appointment routes must invoke the shared destructive-runtime guard`
>
> `education sessions must invoke the shared destructive-runtime guard`
>
> `education gallery browser must invoke the shared destructive-runtime guard`
>
> `referral lifecycle must invoke the shared destructive-runtime guard`
>
> `social OAuth referral context must invoke the shared destructive-runtime guard`
>
> `anonymized dump shell must invoke the shared destructive-runtime guard`
>
> `anonymized dump shell tests must invoke the shared destructive-runtime guard`
>
> `B2B catalog shell must invoke the shared destructive-runtime guard`
>
> `damaged timestamp serialization shell must invoke the shared destructive-runtime guard`
>
> `marketplace discovery shell must invoke the shared destructive-runtime guard`
>
> `browser preflight must invoke the shared destructive-runtime guard`

The old-contract reproduction is separately preserved at
`.local/ledger-identity/registry/current-old-contract-reproduction.stdout`,
`.stderr`, and `.exit-code`. It is a current reproduction against the exact
current HTTP-security and external-pool sources, not a historical run. Its two
direct diagnostics are:

> `current reproduction: original predicate accepted import-only external database pool integration mutation`
>
> `current reproduction: original predicate accepted import-only HTTP security hardening mutation`