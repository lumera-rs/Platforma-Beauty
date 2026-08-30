import assert from "node:assert/strict";
import { BUSINESS_ROLES, homeForRole } from "./role-routing";

assert.equal(
  homeForRole("EDUKATIVNI_CENTAR"),
  "/biznis",
  "education-center owners should land in the business workspace",
);
assert.ok(
  BUSINESS_ROLES.includes("EDUKATIVNI_CENTAR"),
  "education-center owners should retain business-workspace authorization",
);

console.log("Education-center role routing checks passed.");