# Authorization matrix

Authorization is explicit, activity-specific, time-bounded and non-transitive.
Repository access, credentials, earlier conversation or approval of another
phase never implies production authority.

| Class | Activity | Current status | Separate authority required |
|---|---|---|---|
| A | Prepare this documentation from local source/docs | AUTHORIZED | Current user instruction |
| B | Read production configuration/control-plane data | NOT_AUTHORIZED | System owner and security/operations owner |
| C | Connect to the production database | NOT_AUTHORIZED | System owner, data/DB owner, security and independent reviewer |
| D | Execute one approved diagnostic | NOT_AUTHORIZED | C plus procedure/diagnostic-specific approval |
| E | Execute P-05 PREFLIGHT | NOT_AUTHORIZED | D plus explicit P-05 preflight approval |
| F | Execute P-05 SCAN | NOT_AUTHORIZED | Successful unique PREFLIGHT plus separate independent manual approval |
| G | Retry any access/diagnostic | NOT_AUTHORIZED | New explicit approval after cause review and fresh gates |
| H | Run migrations or change production | NOT_AUTHORIZED | Separate change-management authorization; outside this package |

P-05 never transitions automatically. PREFLIGHT and SCAN retain the approved
shared capture binding but distinct phase evidence, and SCAN remains forbidden
until its exact successful preflight and independent approval exist.

No role listed here is asserted to be staffed. Responsible parties and their
authority remain evidence requirements.