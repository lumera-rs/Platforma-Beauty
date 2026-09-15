---
name: Audit SQL normalization proofs
description: Fail-closed rules for treating PostgreSQL deparser differences as audit-only representation noise.
---

Audit-only SQL normalization may erase syntax only when equivalence is proven for the complete affected expression. Adjacent characters or a recognized suffix are not enough: validate the whole operand or argument, its nesting level, its resolved type, and the complete qualified function identity. Overloaded built-ins require signature-aware input proof, and unknown or schema-qualified functions remain strict.

**Why:** Adversarial review repeatedly found semantic false equivalences when prefix-only checks mistook nested array arguments for whole elements, compound expressions for direct columns, overloaded functions for text functions, or qualified custom functions for built-ins.

**How to apply:** For future audit normalizers, keep behavior out of fingerprint paths; add both live-shaped positive fixtures and executable semantic counterexamples for grouping, casts, overloads, qualification, arrays, and custom operators. Preserve the original syntax whenever proof is incomplete.