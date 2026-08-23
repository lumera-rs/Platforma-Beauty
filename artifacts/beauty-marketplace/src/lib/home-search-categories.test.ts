import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HOME_SEARCH_CATEGORIES,
  NON_SEO_SEARCH_CATEGORIES,
} from "./public-category-pages";

const homeSource = readFileSync(new URL("../pages/home.tsx", import.meta.url), "utf8");
const categoryDefinitions = JSON.parse(
  readFileSync(new URL("./public-category-pages.json", import.meta.url), "utf8"),
) as Array<{ apiCategory: string }>;

test("homepage search includes every public SEO category", () => {
  for (const page of categoryDefinitions) {
    assert.ok(
      HOME_SEARCH_CATEGORIES.includes(page.apiCategory),
      `homepage search is missing public category "${page.apiCategory}"`,
    );
  }
});

test("homepage search keeps the non-SEO catalog categories", () => {
  for (const category of NON_SEO_SEARCH_CATEGORIES) {
    assert.ok(
      HOME_SEARCH_CATEGORIES.includes(category),
      `homepage search is missing non-SEO category "${category}"`,
    );
  }
});

test("homepage selector uses the shared search category source", () => {
  assert.match(
    homeSource,
    /import\s*\{[\s\S]*HOME_SEARCH_CATEGORIES[\s\S]*\}\s*from "@\/lib\/public-category-pages";/,
    "home.tsx should import the shared category choices",
  );
  assert.match(
    homeSource,
    /\{HOME_SEARCH_CATEGORIES\.map\(/,
    "the category selector should render the shared category choices",
  );
  assert.doesNotMatch(
    homeSource,
    /const categories\s*=\s*\[/,
    "home.tsx should not define a separate category shortlist",
  );
});