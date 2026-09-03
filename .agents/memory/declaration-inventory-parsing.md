---
name: Declaration inventory parsing
description: Why generated declaration safety checks use the TypeScript compiler AST instead of a purpose-built text scanner.
---

Generated TypeScript declaration inventories must derive interfaces, properties, aliases, and union members from the TypeScript compiler AST rather than delimiter-based text scanning.

**Why:** Template-literal substitutions can contain nested templates, quoted delimiters, comments, object types, and indexed access types. A lightweight scanner can silently misclassify a file-producing option, weakening a release safety check.

**How to apply:** When extending declaration-based guards, operate on parsed nodes and print normalized semantic type nodes with comments removed. Keep fixtures that combine nested substitutions, escaped delimiters, and comments, and verify the installed declarations retain their reviewed normalized output.

Untrusted declaration preflight limits must account for recursive TypeScript grammar as well as lexical delimiter depth. Deep arrow or conditional type chains can overflow the parser stack while remaining small and keeping every pair of delimiters shallow.

**Why:** A delimiter-only guard allowed thousands of nested function types through to `createSourceFile`, where they caused an uncontrolled `RangeError`.

**How to apply:** Bound input bytes and tokens, cap recursive type operators within a declaration before parsing, retain delimiter-depth checks, and normalize residual parser stack exhaustion to the same source-free complexity diagnostic.