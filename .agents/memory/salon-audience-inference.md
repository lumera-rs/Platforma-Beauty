---
name: Salon audience inference
description: Preserve men's-services discovery for existing salons without overriding an owner's explicit target-audience choice.
---

When a salon has not explicitly set whether it serves men, derive that designation from its active men's services during seed/backfill. Once the owner sets the designation, preserve their value rather than recomputing it from services.

**Why:** Existing salons can already offer men's services when a new audience field is introduced. Defaulting all of them to false silently removes valid search results; repeatedly inferring the value would instead undo an owner's intentional opt-out.

**How to apply:** Any service-driven audience backfill must distinguish inferred values from owner-controlled values. New filters may consume the stored designation, but they must not replace the owner's saved choice with taxonomy heuristics.