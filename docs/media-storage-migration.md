# Image storage migration

LUMERA's image pipeline stores immutable originals and generated thumbnail,
medium and large variants in Replit App Storage. Database records contain only a
stable `/api/media/:assetId?v=:contentHash` application URL and searchable
metadata; private App Storage paths are never returned to the browser.

The startup migration is repeatable and non-destructive. It promotes available
local `/lumera-media/*`, managed Education gallery objects, App Storage object
references, and legacy service-category objects before updating a database
reference. The old source is intentionally retained after promotion so a
rollback cannot lose a photograph.

External HTTP(S) references and missing source objects are left unchanged and
reported in the API workflow log as `external-source-left-in-place` or
`source-unavailable`. They are never deleted automatically. A later run retries
sources that become available. The same completion log includes a
`remainingSources` audit list with the affected scope, resource and safe source
path. Query parameters are stripped from external URLs so signed credentials
cannot reach logs.

The twelve historical service-category sources are the only approved exception:
each exact legacy source is mapped to an original LUMERA replacement in
`/lumera-media/categories/` before it enters the same image validation,
variant-generation and App Storage promotion path. The replacements were
generated for this project on 2026-08-22 and approved for LUMERA application
use; they do not copy third-party website files. Unknown external category
sources retain the safe leave-in-place and audit behavior above.

New salon profile/gallery, employee avatar, product/gallery, Education
cover/gallery, and administrative category uploads all use the staged,
owner-scoped upload pipeline and no longer write to the deployment filesystem.