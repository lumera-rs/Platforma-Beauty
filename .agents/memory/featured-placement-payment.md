---
name: Featured placement payment
description: Decision and compatibility boundary for future paid featured-placement payments.
---

No salon-specific IPS QR flow exists in reachable repository history. Future paid
featured placements must use one shared flow for salons, featured education
centers, and education special offers: snapshot a fixed price and duration,
create a pending charge, show the owner an IPS QR, and activate only after
manual administrator confirmation. The existing admin-only salon designation
and Education operational installment IPS QR remain separate until that flow
is implemented.

**Why:** The repository has Education-only operational IPS payments and
Education featured charges, but no prior salon payment contract to restore.

**How to apply:** Do not add a salon-specific variant by copying the Education
installment endpoint. Define the shared placement charge, owner entry point,
and admin confirmation queue together, while preserving the operational
Education QR authorization and payload contract.