import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

process.env.NODE_ENV = "test";
type SeoPayload = {
  title: string;
  description: string;
  image?: string;
  indexable: boolean;
  canonicalPath?: string;
};
type SeoQueryClient = {
  getQueryData: () => undefined;
  getQueryState: () => undefined;
  fetchQuery: <T>(options: { queryFn: () => Promise<T> }) => Promise<T>;
};
type SeoHeadMetadata = {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  image: string;
  openGraph: {
    title: string;
    description: string;
    url: string;
    image: string;
  };
  twitter: {
    title: string;
    description: string;
    url: string;
    image: string;
  };
};
const moduleUrl = (relativePath: string) =>
  pathToFileURL(path.join(root, relativePath)).href;
const { createSeoResponse } = await import(moduleUrl(serverPath)) as {
  createSeoResponse: (
    request: { url: string; headers: Record<string, string> },
    template: string,
  ) => Promise<{ status: number; body: string }>;
};
const { resolvePostMountSeo, seoHeadMetadata } = await import(
  moduleUrl("artifacts/beauty-marketplace/src/components/client-seo-metadata.tsx")
) as {
  resolvePostMountSeo: (
    pathname: string,
    searchString: string,
    queryClient: SeoQueryClient,
  ) => Promise<SeoPayload>;
  seoHeadMetadata: (
    pathname: string,
    payload: SeoPayload,
    origin: string,
  ) => SeoHeadMetadata;
};

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

type DynamicRouteContract = {
  pattern: string;
  pathname: string;
  missingPathname: string;
};

const staticRouteContracts = [
  "/",
  "/za-biznise",
  "/za-biznise/saloni",
  "/za-biznise/edukativni-centri",
  "/za-biznise/poslovi",
  "/za-biznise/edukacije",
  "/saloni",
  "/poslovi",
  "/proizvodi",
  "/inspiracija",
  "/recnik",
  "/brendovi",
  "/edukacije",
  "/uslovi-koriscenja",
  "/politika-privatnosti",
  "/politika-kolacica",
  "/uslovi-kupovine",
  "/otkazivanje-termina",
  "/povracaj-sredstava",
] as const;

const publicStaticPatterns = publicRoutes
  .filter(({ pattern }) => !pattern.includes(":") && !pattern.includes("*"))
  .map(({ pattern }) => pattern)
  .sort();
assert.deepEqual(
  [...staticRouteContracts].sort(),
  publicStaticPatterns,
  "every public static React route must have an SSR/client metadata contract fixture",
);

const courseId = "11111111-1111-4111-8111-111111111111";
const dynamicRouteContracts: DynamicRouteContract[] = [
  {
    pattern: "/saloni/kategorija/:categorySlug",
    pathname: "/saloni/kategorija/frizerski-saloni",
    missingPathname: "/saloni/kategorija/nepostojeca-kategorija",
  },
  {
    pattern: "/saloni/:slug",
    pathname: "/saloni/glow-studio",
    missingPathname: "/saloni/nepostojeci-salon",
  },
  {
    pattern: "/poslovi/:slug/:listingId",
    pathname: "/poslovi/frizer/glow-job",
    missingPathname: "/poslovi/nepostojeci/nepostojeci-oglas",
  },
  {
    pattern: "/shop/:supplierSlug/proizvod/:productId",
    pathname: "/shop/glow-supply/proizvod/glow-product",
    missingPathname: "/shop/glow-supply/proizvod/nepostojeci-proizvod",
  },
  {
    pattern: "/shop/:supplierSlug",
    pathname: "/shop/glow-supply",
    missingPathname: "/shop/nepostojeci-dobavljac",
  },
  {
    pattern: "/shop/:supplierSlug/*",
    pathname: "/shop/glow-supply/nega-lica",
    missingPathname: "/shop/glow-supply/nepostojeca-kategorija",
  },
  {
    pattern: "/edukacije/instruktori/:instructorId",
    pathname: "/edukacije/instruktori/glow-instructor",
    missingPathname: "/edukacije/instruktori/nepostojeci-instruktor",
  },
  {
    pattern: "/edukacije/sekcije/:sectionSlug/:categorySlug/:subcategorySlug",
    pathname: "/edukacije/sekcije/nega/lice/hidratacija",
    missingPathname: "/edukacije/sekcije/nega/lice/nepostojeca-tehnika",
  },
  {
    pattern: "/edukacije/sekcije/:sectionSlug/:categorySlug",
    pathname: "/edukacije/sekcije/nega/lice",
    missingPathname: "/edukacije/sekcije/nega/nepostojeca-kategorija",
  },
  {
    pattern: "/edukacije/sekcije/:sectionSlug",
    pathname: "/edukacije/sekcije/nega",
    missingPathname: "/edukacije/sekcije/nepostojeca-sekcija",
  },
  {
    pattern: "/edukacije/centri/:centerId",
    pathname: "/edukacije/centri/glow-center",
    missingPathname: "/edukacije/centri/nepostojeci-centar",
  },
  {
    pattern: "/edukacije/paketi/:bundleId",
    pathname: "/edukacije/paketi/glow-bundle",
    missingPathname: "/edukacije/paketi/nepostojeci-paket",
  },
  {
    pattern: "/edukacije/:courseId",
    pathname: `/edukacije/${courseId}`,
    missingPathname: "/edukacije/22222222-2222-4222-8222-222222222222",
  },
];

const publicDynamicPatterns = publicRoutes
  .filter(({ pattern }) => pattern.includes(":") || pattern.includes("*"))
  .map(({ pattern }) => pattern)
  .sort();
assert.deepEqual(
  dynamicRouteContracts.map(({ pattern }) => pattern).sort(),
  publicDynamicPatterns,
  "every public dynamic React route must have an SSR/client metadata contract fixture",
);

const supplier = {
  id: "glow-supplier",
  slug: "glow-supply",
  name: "Glow Supply",
  description: "Profesionalni proizvodi za negu.",
  active: true,
  scope: "B2C",
  logoUrl: "https://cdn.example/glow-supply.jpg",
};
const product = {
  id: "glow-product",
  supplierId: supplier.id,
  name: "Glow serum za intenzivnu hidrataciju i profesionalnu svakodnevnu negu lica",
  description: "Profesionalni serum za svakodnevnu negu lica koji pruža intenzivnu hidrataciju, podržava prirodnu zaštitnu barijeru kože i ostavlja kožu glatkom, mekom i blistavom tokom celog dana.",
  price: 2400,
  category: "Nega lica",
  images: ["/glow-serum.jpg"],
};
const salon = {
  id: "glow-salon",
  slug: "glow-studio",
  name: "Glow Studio",
  city: "Beograd",
  description: "Salon za negu lica i kose.",
  gallery: ["/glow-studio.jpg"],
  services: [],
};
const beautyJob = {
  id: "glow-job",
  slug: "frizer",
  title: "Frizer",
  description: "Tražimo iskusnog frizera.",
  type: "job",
  intent: "offering",
  city: "Beograd",
  region: "Beograd",
  authorDisplayName: "Glow Studio",
  photos: ["/glow-job.jpg"],
};
const course = {
  id: courseId,
  title: "Napredna nega lica",
  description: "Praktičan kurs profesionalne nege lica.",
  publisher: "Glow Akademija",
  imageUrl: "/glow-course.jpg",
  learningOutcomes: [],
};
const taxonomy = [{
  id: "section-nega",
  slug: "nega",
  name: "Nega",
  categories: [{
    id: "category-lice",
    slug: "lice",
    name: "Nega lica",
    subcategories: [{
      id: "subcategory-hidratacija",
      slug: "hidratacija",
      name: "Hidratacija",
    }],
  }],
}];
const category = {
  id: "category-nega-lica",
  path: "nega-lica",
  name: "Nega lica",
  active: true,
};
const center = {
  id: "glow-center",
  name: "Glow Akademija",
  description: "Centar za profesionalne beauty edukacije.",
  imageUrl: "/glow-center.jpg",
  courses: [],
};
const bundle = {
  id: "glow-bundle",
  name: "Glow paket",
  description: "Paket kurseva za profesionalnu negu.",
  price: 12000,
  courses: [],
};
const instructor = {
  id: "glow-instructor",
  name: "Ana Glow",
  biography: "Instruktorka profesionalne nege lica.",
  photoUrl: "/ana-glow.jpg",
  courses: [],
};

function responseJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  const url = new URL(rawUrl, "https://seo-contract.test");
  const requestPath = `${url.pathname}${url.search}`;

  if (requestPath.startsWith("/api/salons?")) return responseJson([salon]);
  if (url.pathname === `/api/salons/${salon.slug}`) return responseJson(salon);
  if (url.pathname === `/api/beauty-jobs/${beautyJob.id}`) return responseJson(beautyJob);
  if (url.pathname === `/api/suppliers/${supplier.slug}/public-products/${product.id}`) {
    return responseJson(product);
  }
  if (url.pathname === `/api/suppliers/${supplier.slug}/public-products`) {
    return responseJson({ items: [product] });
  }
  if (url.pathname === `/api/suppliers/${supplier.slug}/categories`) {
    return responseJson([category]);
  }
  if (url.pathname === `/api/suppliers/${supplier.slug}`) return responseJson(supplier);
  if (url.pathname === "/api/education/public/taxonomy") return responseJson(taxonomy);
  if (url.pathname === `/api/education/public/courses/${course.id}`) return responseJson(course);
  if (url.pathname === "/api/education/public/courses") return responseJson([course]);
  if (url.pathname === `/api/education/bundles/${bundle.id}`) return responseJson(bundle);
  if (url.pathname === `/api/education/public/centers/${center.id}`) return responseJson(center);
  if (url.pathname === `/api/education/instructors/${instructor.id}/public`) {
    return responseJson(instructor);
  }
  return responseJson({ message: "Not found" }, 404);
};

type ComparableSeoHead = {
  title: string;
  description: string;
  canonical: string | null;
  robots: string;
  openGraph: {
    title: string | null;
    description: string | null;
    url: string | null;
    image: string | null;
  };
  twitter: {
    title: string | null;
    description: string | null;
    url: string | null;
    image: string | null;
  };
};

function htmlAttribute(html: string, pattern: RegExp, label: string): string {
  const value = html.match(pattern)?.[1];
  assert.ok(value, `SSR document must contain ${label}`);
  return value;
}

function optionalHtmlAttribute(html: string, pattern: RegExp): string | null {
  return html.match(pattern)?.[1] ?? null;
}

function ssrHead(html: string): ComparableSeoHead {
  return {
    title: htmlAttribute(html, /<title>([^<]*)<\/title>/u, "a title"),
    description: htmlAttribute(
      html,
      /<meta name="description" content="([^"]*)">/u,
      "a description",
    ),
    canonical: html.match(/<link rel="canonical" href="([^"]*)">/u)?.[1] ?? null,
    robots: htmlAttribute(
      html,
      /<meta name="robots" content="([^"]*)">/u,
      "a robots directive",
    ),
    openGraph: {
      title: optionalHtmlAttribute(html, /<meta property="og:title" content="([^"]*)">/u),
      description: optionalHtmlAttribute(html, /<meta property="og:description" content="([^"]*)">/u),
      url: optionalHtmlAttribute(html, /<meta property="og:url" content="([^"]*)">/u),
      image: optionalHtmlAttribute(html, /<meta property="og:image" content="([^"]*)">/u),
    },
    twitter: {
      title: optionalHtmlAttribute(html, /<meta name="twitter:title" content="([^"]*)">/u),
      description: optionalHtmlAttribute(html, /<meta name="twitter:description" content="([^"]*)">/u),
      url: optionalHtmlAttribute(html, /<meta name="twitter:url" content="([^"]*)">/u),
      image: optionalHtmlAttribute(html, /<meta name="twitter:image" content="([^"]*)">/u),
    },
  };
}

const seoOrigin = "https://lumera.example";
const htmlTemplate = `<!doctype html><html><head>
  <title>Default</title>
  <meta name="description" content="Default">
  <meta name="robots" content="noindex, follow">
  <link rel="canonical" href="${seoOrigin}/">
</head><body><div id="root"></div></body></html>`;

async function serverMetadata(pathname: string): Promise<{
  status: number;
  head: ComparableSeoHead;
}> {
  const response = await createSeoResponse({
    url: pathname,
    headers: {
      host: "lumera.example",
      "x-forwarded-host": "lumera.example",
      "x-forwarded-proto": "https",
    },
  }, htmlTemplate);
  return { status: response.status, head: ssrHead(response.body) };
}

async function clientMetadataAfterMount(
  pathname: string,
  searchString = "",
): Promise<ComparableSeoHead> {
  const queryClient: SeoQueryClient = {
    getQueryData: () => undefined,
    getQueryState: () => undefined,
    fetchQuery: async <T>({ queryFn }: { queryFn: () => Promise<T> }) => queryFn(),
  };
  const payload = await resolvePostMountSeo(pathname, searchString, queryClient);
  const head = seoHeadMetadata(pathname, payload, seoOrigin);
  return {
    title: head.title,
    description: head.description,
    canonical: head.canonical,
    robots: head.robots,
    openGraph: head.openGraph,
    twitter: head.twitter,
  };
}

try {
  for (const pathname of staticRouteContracts) {
    const serverResult = await serverMetadata(pathname);
    assert.equal(serverResult.status, 200, `${pathname} static fixture must server-render`);
    assert.deepEqual(
      await clientMetadataAfterMount(pathname),
      serverResult.head,
      `${pathname} must preserve SSR title, description, canonical, and robots after mount`,
    );

    const queryPath = `${pathname}?seo-contract=1`;
    const queryResult = await serverMetadata(queryPath);
    assert.equal(queryResult.status, 200, `${pathname} query variant must render safely`);
    const clientQueryHead = await clientMetadataAfterMount(pathname, "seo-contract=1");
    assert.deepEqual(
      clientQueryHead,
      queryResult.head,
      `${pathname} query variant must preserve SSR metadata after mount`,
    );
    assert.equal(queryResult.head.robots, "noindex, follow");
    assert.equal(
      queryResult.head.canonical,
      `${seoOrigin}${pathname}`,
      `${pathname} query canonical must omit the query string`,
    );
  }

  for (const contract of dynamicRouteContracts) {
    const serverResult = await serverMetadata(contract.pathname);
    assert.equal(
      serverResult.status,
      200,
      `${contract.pattern} valid fixture must server-render`,
    );
    assert.deepEqual(
      await clientMetadataAfterMount(contract.pathname),
      serverResult.head,
      `${contract.pattern} must preserve SSR title, description, canonical, robots, Open Graph, and Twitter metadata after mount`,
    );
    assert.equal(serverResult.head.openGraph.url, serverResult.head.canonical);
    assert.equal(serverResult.head.twitter.url, serverResult.head.canonical);
    assert.deepEqual(serverResult.head.twitter, serverResult.head.openGraph);

    const queryResult = await serverMetadata(`${contract.pathname}?seo-contract=1`);
    assert.equal(queryResult.status, 200, `${contract.pattern} query variant must render safely`);
    assert.equal(
      queryResult.head.robots,
      "noindex, follow",
      `${contract.pattern} query variant must remain noindex`,
    );
    assert.equal(
      queryResult.head.canonical,
      `${seoOrigin}${contract.pathname}`,
      `${contract.pattern} query canonical must omit the query string`,
    );
    const clientQueryHead = await clientMetadataAfterMount(contract.pathname, "seo-contract=1");
    assert.equal(
      clientQueryHead.robots,
      "noindex, follow",
      `${contract.pattern} query variant must remain noindex after mount`,
    );
    assert.equal(
      clientQueryHead.canonical,
      `${seoOrigin}${contract.pathname}`,
      `${contract.pattern} client query canonical must omit the query string`,
    );

    const missingServerResult = await serverMetadata(contract.missingPathname);
    assert.equal(
      missingServerResult.status,
      404,
      `${contract.pattern} missing fixture must use the not-found response`,
    );
    assert.equal(
      missingServerResult.head.robots,
      "noindex, follow",
      `${contract.pattern} missing fixture must remain noindex in SSR`,
    );
    assert.equal(
      (await clientMetadataAfterMount(contract.missingPathname)).robots,
      "noindex, follow",
      `${contract.pattern} missing fixture must remain noindex after mount`,
    );
  }

  assert.equal(
    (await serverMetadata("/saloni/glow-studio")).head.openGraph.image,
    `${seoOrigin}/glow-studio.jpg`,
    "relative social images must resolve against the public origin",
  );
  assert.equal(
    (await serverMetadata("/shop/glow-supply")).head.openGraph.image,
    supplier.logoUrl,
    "absolute social images must remain unchanged",
  );
} finally {
  globalThis.fetch = originalFetch;
}

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