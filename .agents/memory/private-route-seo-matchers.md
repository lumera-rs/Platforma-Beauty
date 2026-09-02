---
name: Private routes and public SEO matchers
description: Prevent broad public metadata resolvers from treating nested account routes as public detail pages.
---

Public-detail SEO matchers must explicitly reject private route namespaces before applying broad dynamic patterns.

**Why:** A private account path can share the same segment shape as a public detail URL. The UI router may render the correct private page while a global metadata resolver independently fetches a public-detail endpoint with the private tab name, causing misleading 4xx noise and incorrect metadata.

**How to apply:** Whenever public and private routes share a prefix, test both the page router and every global URL consumer (SEO metadata, prefetching, analytics, breadcrumbs). Put private-prefix exclusions ahead of broad public regexes.