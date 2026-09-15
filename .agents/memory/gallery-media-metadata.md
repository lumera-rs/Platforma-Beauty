---
name: Gallery media metadata
description: Atomicity, compatibility, and draft-refresh rules for metadata attached to gallery media.
---

Per-image metadata must be keyed by media identity and saved inside the same authorized transaction as the resource gallery mutation. Retained legacy or external URLs may remain editable but must not block metadata saves they cannot support.

**Why:** A standalone metadata save can commit when the resource save later fails, while index-keyed values can move to another image after reordering. Cached metadata can also overwrite newer server values if editor initialization treats loaded values as user edits.

**How to apply:** Validate every described URL against the resource's resulting gallery, update managed assets inside the resource transaction, authorize retained bound assets through resource management, and let fresh server values replace only untouched draft fields. Public metadata reads must enforce the same attachment/privacy boundary as the image.