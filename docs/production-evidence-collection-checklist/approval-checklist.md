# Approval checklist

| Class | Activity | Current state |
|---|---|---|
| A | Documentation preparation | AUTHORIZED |
| B | Read production configuration | NOT_AUTHORIZED |
| C | Connect to production database | NOT_AUTHORIZED |
| D | Execute one diagnostic | NOT_AUTHORIZED |
| E | Execute P-05 PREFLIGHT | NOT_AUTHORIZED |
| F | Execute P-05 SCAN | NOT_AUTHORIZED |
| G | Retry | NOT_AUTHORIZED |
| H | Migrations/production changes | NOT_AUTHORIZED |

Every future approval record requires exact scope, target environment,
responsible signers, start/expiry, prerequisites, allowed operations, prohibited
operations and abort conditions. It is activity-specific and non-transitive.

P-05 SCAN requires the exact successful unique PREFLIGHT plus a separate manual
independent approval. No automatic transition is allowed. Retry requires a new
approval after cause review and fresh gates. An empty form, repository access,
credential availability or earlier conversation is not approval.