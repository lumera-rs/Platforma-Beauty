---
name: Artifact release gates
description: How repository-wide release validation blocks artifact-mode publishing without replacing artifact builds.
---

In artifact-mode deployments, a named validation workflow is not automatically run by the publishing pipeline. Put mandatory repository-wide release checks in the root deployment build hook; artifact-specific production builds still run afterward.

**Why:** A validation workflow can pass when run manually yet never block Publish. Conversely, recursively building every workspace package from the root can fail because artifact builds depend on service-specific environment injected only by their managed build.

**How to apply:** Keep the root deployment build hook focused on repository-wide checks such as typechecks and isolated end-to-end gates. Leave each artifact’s production build in its artifact configuration, and make any database-backed browser gate use disposable state rather than the source database.