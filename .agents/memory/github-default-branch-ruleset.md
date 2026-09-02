---
name: GitHub default-branch rulesets
description: Default-branch required checks and the separate organization-ownership gate for GitHub merge queues
---

An active GitHub repository ruleset targeting `~DEFAULT_BRANCH` can enforce required status checks as soon as the default branch is created, unlike classic branch protection which requires an existing branch.

**Why:** A newly created repository may have a configured default branch name but no branch ref yet, so the classic branch-protection endpoint returns “Branch not found.” A ruleset preserves the intended merge gate without inventing an initial commit.

**How to apply:** Use a repository-scoped active branch ruleset with `required_status_checks` and `strict_required_status_checks_policy: true`. While the repository has no default-branch ref, set `do_not_enforce_on_create: true` so the first controlled push can create it; status and pull-request enforcement applies afterward. Keep the required-check list limited to the checks explicitly requested so existing CI gates are not changed.

GitHub merge queues require an organization-owned repository; a public repository owned by a personal account cannot accept a `merge_queue` ruleset rule even when every parameter and required check is valid.

**Why:** GitHub exposes merge queues for public organization repositories and for private Enterprise Cloud organization repositories, not repositories owned by personal accounts. The ruleset API reports the otherwise valid rule as invalid.

**How to apply:** Before planning a live `merge_group` trial, verify repository ownership. For a personal-account repository, preserve the `merge_group` workflow trigger but defer the live queue test until the repository is transferred to an eligible organization.

After a transfer, verify both repository visibility and organization OAuth-app access before treating API failures as ruleset errors.

**Why:** A transferred repository can be private on a free organization, which makes repository rulesets unavailable, and an organization with restricted third-party access returns 403 until the connected OAuth app is granted access.

**How to apply:** Confirm the destination URL and admin access, grant the existing GitHub OAuth app access to the organization, and verify that the repository is public or the organization plan supports private-repository rulesets before updating the merge queue rule.
