import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ownerWidgetUrl } from "./owner-widget-url";

test("owner widget preview and iframe retain nonroot mount and selected color", () => {
  assert.equal(ownerWidgetUrl("https://lumera.example", "/marketplace/", "salon-one", "#9b6b54"),
    "https://lumera.example/marketplace/widget/salon-one?boja=9b6b54");
  assert.equal(ownerWidgetUrl("https://lumera.example", "/", "salon-one", ""),
    "https://lumera.example/widget/salon-one");
  assert.equal(ownerWidgetUrl("https://lumera.example", "/marketplace", "salon one", "#ffffff"),
    "https://lumera.example/marketplace/widget/salon%20one?boja=ffffff");
});

test("owner profile uses the mount-aware URL for both preview and iframe", () => {
  const source = readFileSync(new URL("../pages/owner/profile.tsx", import.meta.url), "utf8");
  assert.match(source, /ownerWidgetUrl\(publicSiteOrigin\(\), import\.meta\.env\.BASE_URL, salon\.slug, widgetColor\)/);
  assert.match(source, /href=\{widgetUrl\}/);
  assert.match(source, /<iframe src="\$\{widgetUrl\}"/);
});