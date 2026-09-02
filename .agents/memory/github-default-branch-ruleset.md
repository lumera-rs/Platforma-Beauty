---
name: GitHub default-branch rulesets
description: How to enforce required CI checks when the repository default branch may not exist yet
---

An active GitHub repository ruleset targeting `~DEFAULT_BRANCH` can enforce required status checks as soon as the default branch is created, unlike classic branch protection which requires an existing branch.

**Why:** A newly created repository may have a configured default branch name but no branch ref yet, so the classic branch-protection endpoint returns “Branch not found.” A ruleset preserves the intended merge gate without inventing an initial commit.

**How to apply:** Use a repository-scoped active branch ruleset with `required_status_checks` and `strict_required_status_checks_policy: true`. While the repository has no default-branch ref, set `do_not_enforce_on_create: true` so the first controlled push can create it; status and pull-request enforcement applies afterward. Keep the required-check list limited to the checks explicitly requested so existing CI gates are not changed.
