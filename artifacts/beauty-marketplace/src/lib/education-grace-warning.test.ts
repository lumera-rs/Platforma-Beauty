import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { educationGraceWarningMessage } from "./education-grace-warning";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("grace warning message covers today, one day, many days, and non-grace accounts", () => {
  assert.equal(educationGraceWarningMessage({ inGrace: false, graceDaysRemaining: 5 }), null);
  assert.equal(educationGraceWarningMessage({ inGrace: true, graceDaysRemaining: null }), null);
  assert.match(educationGraceWarningMessage({ inGrace: true, graceDaysRemaining: 0 })!, /ističe danas/);
  assert.match(educationGraceWarningMessage({ inGrace: true, graceDaysRemaining: 1 })!, /1 beogradski kalendarski dan/);
  assert.match(educationGraceWarningMessage({ inGrace: true, graceDaysRemaining: 5 })!, /5 beogradskih kalendarskih dana/);
});

test("grace warning is mounted in the persistent app shell instead of one route", () => {
  const appSource = readFileSync(join(srcRoot, "App.tsx"), "utf8");
  const businessHubSource = readFileSync(join(srcRoot, "pages/business-hub.tsx"), "utf8");

  assert.match(appSource, /<EducationGraceBanner \/>[\s\S]*<Router \/>/);
  assert.doesNotMatch(businessHubSource, /data-testid="education-grace-banner"|subStatus\?\.inGrace/);
});