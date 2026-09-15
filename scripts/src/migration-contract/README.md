# Migration directive header

Every `migration.sql` starts at byte zero with this header. UTF-8 BOMs are
forbidden. Lines use LF or CRLF; lone CR and control characters are rejected.

Tabs are not permitted anywhere in `migration.sql`, including the SQL body.
Use spaces for indentation.

```text
-- lumera:migration-format 1
-- lumera:id NNNNNN
-- lumera:mode transactional|nontransactional
-- lumera:description VALUE
-- lumera:min-postgres INTEGER
-- lumera:max-postgres INTEGER
-- lumera:precondition-sql VALUE
-- lumera:postcondition-sql VALUE
-- lumera:recovery VALUE
-- lumera:end-header
SQL BODY
```

The first line is exact. Every other header line has the exact ASCII shape
`-- lumera:key value`: one space after `--`, one space between key and value,
no indentation, tabs, or leading/trailing value whitespace. Header values
also reject Unicode control (`Cc`), format (`Cf`), line-separator U+2028, and
paragraph-separator U+2029 characters, including C1 controls and bidi
controls. `end-header` has no value. Singleton directives are required exactly once; condition
directives are optional and repeatable. Unknown directives fail closed.

Description values are limited to 500 UTF-16 code units, recovery values to
2,000, and each condition to 4,000. At most 100 preconditions and 100
postconditions are accepted. The ID must match the six-digit directory ID.
The format is exactly `1`; modes have no aliases. Every integer major in the
inclusive PostgreSQL range must occur in the shared supported-major list.

The body must be non-whitespace and is returned verbatim. A small lexical
scanner reserves lowercase `lumera:` directive lines in SQL `--` comments,
including unknown keys and malformed directive whitespace. It deliberately
skips single-quoted strings (including doubled quotes and `E` escape strings),
double-quoted identifiers, tagged or untagged dollar-quoted strings, and
nested `/* */` comments. Unterminated forms fail closed. This scanner only
protects the directive namespace; it does not parse or validate SQL.
Conditions are parsed and stored only. Read-only safety and execution are
deferred to P.2e/P.2g because a catalog-regex validator is not a SQL parser.
Mode-specific body validation is likewise deferred to P.2g.
P.2g must reject migration bodies containing no executable SQL statement.
Bodies containing only semicolons or comments can currently pass the
non-empty-body check; that behavior is not changed by this documentation.

The migration checksum is SHA-256 over the original complete byte stream,
including the directive header, never over the parsed body.

## CI command

`pnpm run validate:ci:migration-contract` accepts no path arguments. When run
locally it validates only the complete working migration set. In Branch CI,
the native event payload is authoritative: pull requests use
`pull_request.base.sha` and merge groups use `merge_group.base_sha`. The
workflow compatibility base value is required for pull requests and merge
groups, and must equal the corresponding native payload SHA. The validator
fetches only that exact SHA and retries ancestry proof with bounded deepen
counts of 32, 128, and 512;
it never substitutes a branch or performs an unbounded/full fetch. Pull
requests and merge groups compare protected history; pushes and manual
dispatches validate the current set only.

The command rejects nonempty `DATABASE_URL`, `*_DATABASE_URL`,
`DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `PGHOST`, `PGPORT`, `PGDATABASE`,
`PGUSER`, and `PGPASSWORD`, and removes those names from Git subprocesses.
If any native GitHub context variable is present, all of `GITHUB_ACTIONS=true`,
`GITHUB_EVENT_NAME`, `GITHUB_EVENT_PATH`, `GITHUB_SHA`, and `GITHUB_REF` are
required. The payload must be valid JSON, and the optional custom event value
must match the native event. Local mode is available only when no native
GitHub context is present.

The AST capability test is intentionally narrow rather than a general-purpose
security analyzer. It allows this CI validator's single `spawn("git", argv)`
helper with array-literal call sites and `shell: false`, while rejecting other
executables, shell enabling, DB/network/runtime imports, eval-like execution,
and unexpected subprocess forms.
