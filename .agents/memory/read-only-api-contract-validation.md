---
name: Read-only API contract validation
description: How to check shared Orval outputs before browser suites without changing checked-in generated files.
---

Generate API contracts into a temporary output root and compare the complete generated directories after the normal post-generation normalization, rather than running the regular codegen command against the checkout.

**Why:** The browser preflight must catch contract drift before fixtures run, but regular Orval generation clears and rewrites its configured output directories. Orval also resolves the React client mutator from that output workspace, so the temporary workspace needs that source file staged first.

**How to apply:** Keep the generator and its normalizer able to use a temporary output root. The validator should stage required generator inputs there, regenerate, normalize, compare every generated file to the tracked output, and clean up in a `finally` block. Error text must name the OpenAPI contract and each drifted generated artifact.