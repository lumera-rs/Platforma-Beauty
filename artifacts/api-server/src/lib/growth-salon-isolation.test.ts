import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isSalonOwnerRole } from "../routes/growth";

// Runtime predicate used by every growth route (CRM, automations, packages,
// employee performance and growth AI) must never grant legacy EDU salon access.
assert.equal(isSalonOwnerRole("SALON_OWNER"), true);
assert.equal(isSalonOwnerRole("EDUKATIVNI_CENTAR"), false);
assert.equal(isSalonOwnerRole("SALON_EMPLOYEE"), false);

const source = await readFile(new URL("../routes/growth.ts", import.meta.url), "utf8");
assert.match(source, /if \(!user \|\| !isSalonOwnerRole\(user\.role\)\) return null;/);
assert.doesNotMatch(source, /\["SALON_OWNER", "EDUKATIVNI_CENTAR"\]\.includes\(user\.role\)/);
console.log("growth salon isolation tests passed");