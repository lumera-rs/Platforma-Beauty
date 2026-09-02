---
name: Education learner identity boundary
description: Separates operational booking management rights from each named participant's learning identity.
---

For participant-linked Education enrollments, only the linked user may read or change LMS progress or download the learner's certificate and enrollment calendar. Purchasers and center staff manage the group through operational booking endpoints instead. Certificates use the immutable participant name captured with the seat.

Public online booking binds the first seat to the authenticated purchaser on the server and keeps additional seats guest-linked unless a separately verified account-resolution flow exists. Client-supplied user IDs are never an impersonation mechanism.

Group payment plans and IPS instructions belong only to the purchaser or financial-management roles (`owner_admin`, `manager_reception`, and platform admin). Named learners and educators do not gain financial visibility merely by participating in or teaching the course.

**Why:** A purchaser can reserve and pay for several different people. Treating purchase ownership as learner ownership exposes or changes another person's progress and can issue a certificate in the purchaser's name.

**How to apply:** Any new progress, attendance-derived learner document, certificate, or participant-specific export must authorize the linked participant identity. Normalize booking identity server-side; keep payment data behind purchaser or financial-manager authorization, and scope teaching/attendance access separately.