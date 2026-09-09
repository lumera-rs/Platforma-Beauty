import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const appPath = "artifacts/beauty-marketplace/src/App.tsx";
const serverPath = "artifacts/beauty-marketplace/seo-server.mjs";
const indexPath = "artifacts/beauty-marketplace/index.html";
const app = read(appPath);
const server = read(serverPath);
const indexHtml = read(indexPath);
const clientMetadata = read("artifacts/beauty-marketplace/src/components/client-seo-metadata.tsx");

type ReactRoute = { pattern: string; source: string };

export function collectReactRoutes(source: string): ReactRoute[] {
  const routes: ReactRoute[] = [];
  const openingTag = /<Route\s+path=(["'])([^"']+)\1[^>]*>/gu;
  for (const match of source.matchAll(openingTag)) {
    const opening = match[0];
    const start = match.index ?? 0;
    const close = opening.endsWith("/>")
      ? start + opening.length
      : source.indexOf("</Route>", start) + "</Route>".length;
    routes.push({
      pattern: match[2],
      source: source.slice(start, close > start ? close : start + opening.length),
    });
  }
  return routes;
}

const privatePrefixes = [
  "/admin",
  "/vlasnik",
  "/zaposleni",
  "/biznis",
  "/student",
  "/moj-nalog",
  "/poslovi/nalog",
  "/widget",
  "/korpa",
];
const nonIndexablePrefixes = ["/beauty-poslovi"];
const nonIndexableExact = new Set([
  "/prijava",
  "/postavi-lozinku",
  "/poslovna-prijava",
  "/poslovna-registracija",
  "/pridruzi-se-edukativni-centar",
  "/pridruzi-se-poslovi",
  "/porudzbina/pracenje",
  "/provera-statusa",
  "/lista-zelja",
  "/ponuda/:publicId",
  "/moji-oglasi",
  "/edukacije/lista-zelja",
  "/edukacije/vauceri",
  "/edukacije/moji-paketi",
]);

export function isPublicIndexableRoute(route: ReactRoute): boolean {
  if (route.source.includes("<RoleGuard")) return false;
  if (route.source.includes("<RouteRedirect") || route.source.includes("<Legacy")) {
    return false;
  }
  if (nonIndexableExact.has(route.pattern)) return false;
  if ([...privatePrefixes, ...nonIndexablePrefixes].some(
    (prefix) => route.pattern === prefix || route.pattern.startsWith(`${prefix}/`),
  )) return false;
  return true;
}

function samplePath(pattern: string): string {
  return pattern
    .replace(/:[A-Za-z][A-Za-z0-9_]*/gu, "seo-check")
    .replace(/\*/gu, "seo-check/nested");
}

function serverPathMatchers(source: string): RegExp[] {
  const matchers: RegExp[] = [];
  // A slash inside a regex character class (for example `[^/]`) is not the
  // regex-literal terminator, so account for complete character classes.
  const literal =
    /pathname\.match\(\s*\/((?:\\.|\[(?:\\.|[^\]])*\]|[^/])+)\/([dgimsuvy]*)\s*\)/gu;
  for (const match of source.matchAll(literal)) {
    matchers.push(new RegExp(match[1], match[2].replace(/[dgy]/gu, "")));
  }
  return matchers;
}

const staticPagesSource =
  server.match(/const staticPages = new Map\(\[([\s\S]*?)\]\);/u)?.[1] ?? "";
const staticPaths = new Set(
  [...staticPagesSource.matchAll(/\[\s*'([^']+)'\s*,/gu)].map((match) => match[1]),
);
const dynamicMatchers = serverPathMatchers(server);
const categoryPaths = (
  JSON.parse(read("artifacts/beauty-marketplace/src/lib/public-category-pages.json")) as
    Array<{ path: string }>
).map(({ path: routePath }) => routePath);

export function hasServerHandling(pattern: string): boolean {
  if (staticPaths.has(pattern)) return true;
  const sample = samplePath(pattern);
  if (dynamicMatchers.some((matcher) => matcher.test(sample))) return true;
  if (pattern === "/saloni/kategorija/:categorySlug") {
    return categoryPaths.length > 0
      && categoryPaths.every((routePath) => routePath.startsWith("/saloni/kategorija/"))
      && /categoryPages\.get\(pathname\)/u.test(server);
  }
  return false;
}

// Negative self-tests keep private-route classification and route matching honest.
assert.equal(
  isPublicIndexableRoute({
    pattern: "/admin/nova-javna-reč",
    source: '<Route path="/admin/nova-javna-reč"><RoleGuard /></Route>',
  }),
  false,
);
assert.equal(
  isPublicIndexableRoute({
    pattern: "/novi-javni-katalog",
    source: '<Route path="/novi-javni-katalog" component={Catalog} />',
  }),
  true,
);
assert.equal(hasServerHandling("/definitivno-nepostojeca-seo-ruta"), false);

const publicRoutes = collectReactRoutes(app).filter(isPublicIndexableRoute);
for (const route of publicRoutes) {
  assert.ok(
    hasServerHandling(route.pattern),
    `${appPath} public route ${route.pattern} needs matching rendering in ${serverPath}`,
  );
}
assert.match(
  clientMetadata,
  /taxonomyMatch\s*=\s*pathname\.match\(\/\^\\\/edukacije\\\/sekcije/u,
  "client metadata must preserve indexable education taxonomy routes after React mounts",
);

assert.match(server, /function makeMeta\([^)]*title,\s*description/u);
assert.match(server, /title:\s*clip\(title/u, "indexable metadata must retain a useful title");
assert.match(server, /description:\s*clip\(description/u, "indexable metadata must retain a useful description");
assert.match(
  server,
  /<link rel="canonical" href="\$\{escapeHtml\(canonical\)\}">/u,
  "server-rendered indexable pages must emit a canonical URL",
);
assert.match(
  server,
  /<meta name="description" content="\$\{escapeHtml\(page\.meta\.description\)\}">/u,
  "server-rendered indexable pages must emit a description",
);
assert.match(server, /<title>\$\{escapeHtml\(page\.meta\.title\)\}<\/title>/u);

const schemaContracts = [
  ["home listing", "if (pathname === '/')", "if (pathname === '/saloni')"],
  ["salon listing", "if (pathname === '/saloni')", "if (pathname === '/proizvodi')"],
  ["supplier listing", "if (pathname === '/proizvodi')", "if (pathname === '/poslovi')"],
  ["jobs listing", "if (pathname === '/poslovi')", "if (pathname === '/edukacije')"],
  ["education listing", "if (pathname === '/edukacije')", "if (['/inspiracija'"],
  ["guide listings", "if (['/inspiracija'", "const legalPage ="],
  ["salon category listing", "const categoryPage =", "const educationTaxonomyMatch"],
  ["education taxonomy listing", "const educationTaxonomyMatch", "const supplierProductMatch"],
  ["product detail", "const supplierProductMatch", "const supplierShopMatch"],
  ["supplier/category listing", "const supplierShopMatch", "const beautyJobMatch"],
  ["job detail", "const beautyJobMatch", "const salonMatch"],
  ["salon detail", "const salonMatch", "const courseMatch"],
  ["course detail", "const courseMatch", "const centerMatch"],
  ["education bundle detail", "const bundleMatch", "const centerMatch"],
  ["education center detail", "const centerMatch", "const instructorMatch"],
  ["instructor detail", "const instructorMatch", "\n  return null;\n}"],
] as const;

for (const [label, startMarker, endMarker] of schemaContracts) {
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `SEO schema contract markers changed for ${label}`);
  const handler = server.slice(start, end);
  assert.match(
    handler,
    /\bschema\s*:/u,
    `${label} must provide JSON-LD through makeMeta`,
  );
  assert.doesNotMatch(
    handler,
    /\bschema\s*:\s*undefined\b/u,
    `${label} must not selectively disable JSON-LD`,
  );
}
assert.match(
  server,
  /type="application\/ld\+json"/u,
  "JSON-LD must be injected into server-rendered documents",
);

const sitemapSerializer =
  server.match(/function sitemapXml\([^)]*\)\s*\{([\s\S]*?)\n\}/u)?.[1] ?? "";
assert.match(sitemapSerializer, /<lastmod>/u, "sitemap entries must include lastmod");
assert.match(
  sitemapSerializer,
  /lastmod\s*\?\s*`?<lastmod>/u,
  "sitemap must omit lastmod when no real source date exists instead of inventing one",
);
assert.doesNotMatch(
  server,
  /(?:serverContentLastmod|categoryContentLastmod|statSync\([^)]*\)\.mtime)/u,
  "sitemap lastmod must not use filesystem modification dates",
);
assert.doesNotMatch(
  server,
  /lastmod:\s*(?:entityLastmod\([^)]*\)|[A-Za-z]+Lastmod)\s*\?\?\s*[A-Za-z]+Lastmod/u,
  "one entity sitemap date must not fall back to a different entity's date",
);

assert.doesNotMatch(
  indexHtml,
  /(?:maximum-scale|minimum-scale|user-scalable)\s*=/iu,
  `${indexPath} must allow browser zoom`,
);
const styleAndMarkupFiles = [
  indexPath,
  "artifacts/beauty-marketplace/src/index.css",
];
for (const file of styleAndMarkupFiles) {
  assert.doesNotMatch(
    read(file),
    /(?:fonts\.(?:googleapis|gstatic)\.com|use\.typekit\.net|use\.fontawesome\.com)/iu,
    `${file} must not load a third-party font; serve approved font files locally`,
  );
}
assert.doesNotMatch(
  indexHtml,
  /rel=["']preload["'][^>]+hero-bg\.jpg/iu,
  "the home hero must not be globally preloaded on private, admin, or non-home routes",
);
assert.match(
  server,
  /heroPreload:\s*['"]\/hero-bg\.jpg['"]/u,
  "the SEO server must preload the homepage LCP image only for the homepage",
);

console.log(
  `SEO standards passed (${publicRoutes.length} public React routes, ${schemaContracts.length} schema contracts).`,
);