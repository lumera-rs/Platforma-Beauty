---
name: Provider repair write selection
description: Testing one-click provider "repair" endpoints that choose an existing provider record to overwrite
---

Repair endpoints that pick which provider-side record to CREATE vs UPDATE need write-path regression coverage separate from the read-only verdict checks: stub the provider with a STATEFUL fake (GET lists, POST appends, PUT mutates by id) so the endpoint's post-write re-check runs against what was actually stored.

**Why:** A wrong candidate pick silently rewrites a foreign or production registration; verdict-only tests never exercise the selection. Stateless stubs can't prove the reported success reflects provider state.

**How to apply:** Assert per scenario which id was written, and add a suite-wide invariant that no write ever targeted a non-app-format record and every write pointed at this deployment's URL. Candidate priority (same-origin > matching-secret > any leftover) is origin-relative — from a development origin the matching-secret fallback would select a production registration, so repair write paths must refuse development/preview origins BEFORE any provider contact (verdict softening does not protect writes), and tests must cover the dev-origin refusal with a production registration present.
