---
name: Public commerce route parity
description: Keeps duplicate public product handlers and nested product cards aligned with canonical storefront rules.
---

Any handler or nested card projection serving canonical public-product semantics must reuse the same visibility predicate, inventory interpretation, price-on-request behavior, and response contract. An earlier-mounted discovery handler can shadow a later canonical route even when generated client types describe the later implementation correctly.

**Why:** A shadow public detail route once omitted variant fields, then its separate related-card projection bypassed price-on-request and active-category hierarchy rules. Compile-time contracts did not protect the runtime response because the earlier handler owned the request.

**How to apply:** When changing a public product contract, search every mounted handler for the same path semantics plus nested related/recent card serializers. Exercise the actual browser-facing route with variant, price-on-request, and inactive-category fixtures.