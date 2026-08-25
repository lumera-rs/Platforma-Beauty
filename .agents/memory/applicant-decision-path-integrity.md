---
name: Applicant decision path integrity
description: Rules for keeping salon applicant decisions terminal, idempotent, private, and fully audited.
---

Accepted and declined candidate decisions are terminal. Every endpoint that can write the shared applicant status—including older reply flows—must preserve an existing terminal decision unless it receives an exact same-status retry. Every first transition into a terminal decision must record the authenticated actor and decision time exactly once.

**Why:** A legacy reply path can otherwise reopen or reverse a decision, bypass private-note semantics, and leave audit history inconsistent even when the dedicated applicant-management endpoint is correct.

**How to apply:** Whenever applicant contact writes or status choices change, review all write paths together. Keep exact retries idempotent, reject conflicting transitions atomically, and never expose private notes or audit fields to applicant/public responses.