import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const web = path.join(root, "artifacts/beauty-marketplace/src");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("artifacts/beauty-marketplace/src/App.tsx");
assert.doesNotMatch(app, /^import\s+.*from\s+['"].*\/pages\//mu, "App.tsx must not eagerly import page modules");
assert.ok((app.match(/\blazy\(\(\)\s*=>\s*import\(/g) ?? []).length >= 30, "major route pages must remain lazy-loaded");
assert.match(app, /<Suspense\s+fallback=\{<RouteLoadingFallback\s*\/>\}/u, "lazy routes need a visible loading fallback");

const debounce = read("artifacts/beauty-marketplace/src/hooks/use-debounce.ts");
assert.match(debounce, /SEARCH_DEBOUNCE_MS\s*=\s*300/u, "shared search debounce must stay at 300 ms");
assert.match(debounce, /useDebounce\(value,\s*SEARCH_DEBOUNCE_MS\)/u, "search hook must use the shared constant");

const sourceFiles: string[] = [];
const collect = (directory: string): void => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(fullPath);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) sourceFiles.push(fullPath);
  }
};
collect(web);
for (const file of sourceFiles) {
  if (file.endsWith("hooks/use-debounce.ts")) continue;
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /function\s+useDebounce\s*</u, `local debounce duplicate found in ${path.relative(root, file)}`);
}

const serverSearchFiles = [
  "artifacts/beauty-marketplace/src/pages/home.tsx",
  "artifacts/beauty-marketplace/src/pages/salons.tsx",
  "artifacts/beauty-marketplace/src/pages/education-marketplace.tsx",
  "artifacts/beauty-marketplace/src/pages/business-education.tsx",
  "artifacts/beauty-marketplace/src/pages/owner/shop.tsx",
  "artifacts/beauty-marketplace/src/pages/admin/salons.tsx",
  "artifacts/beauty-marketplace/src/pages/admin/products.tsx",
  "artifacts/beauty-marketplace/src/pages/admin/orders.tsx",
  "artifacts/beauty-marketplace/src/pages/admin/reviews.tsx",
  "artifacts/beauty-marketplace/src/pages/admin/users.tsx",
];
for (const file of serverSearchFiles) {
  const source = read(file);
  assert.match(source, /useDebouncedSearch\(/u, `${file} must debounce server-bound text criteria`);
}

const paginatedSearchFiles = serverSearchFiles.filter((file) =>
  !file.endsWith("/home.tsx") && !file.endsWith("/admin/reviews.tsx"),
);
for (const file of paginatedSearchFiles) {
  const source = read(file);
  assert.match(source, /setPage\(1\)/u, `${file} must reset pagination when criteria settle`);
}

const optimisticTargets = [
  "artifacts/beauty-marketplace/src/components/salon-favorite-button.tsx",
  "artifacts/beauty-marketplace/src/pages/owner/shop.tsx",
  "artifacts/beauty-marketplace/src/pages/owner/product-detail.tsx",
  "artifacts/beauty-marketplace/src/pages/owner/checkout.tsx",
  "artifacts/beauty-marketplace/src/pages/owner/notifications.tsx",
  "artifacts/beauty-marketplace/src/pages/business-education.tsx",
];
for (const file of optimisticTargets) {
  const source = read(file);
  assert.match(source, /onMutate/u, `${file} must update immediately in onMutate`);
  assert.match(source, /rollbackQueries/u, `${file} must restore its exact snapshot on failure`);
  assert.match(source, /onSettled/u, `${file} must reconcile with the server after settlement`);
  assert.match(source, /MutationQueue\.acquire\(\)/u, `${file} must serialize rapid optimistic mutations before taking a snapshot`);
}

console.log(`Frontend performance standards passed (${serverSearchFiles.length} server searches, ${optimisticTargets.length} optimistic targets).`);