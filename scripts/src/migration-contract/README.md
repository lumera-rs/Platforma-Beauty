# Migration directive header

Every `migration.sql` starts at byte zero with this header. UTF-8 BOMs are
forbidden. Lines use LF or CRLF; lone CR and control characters are rejected.

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

The migration checksum is SHA-256 over the original complete byte stream,
including the directive header, never over the parsed body.