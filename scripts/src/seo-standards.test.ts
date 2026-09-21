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

type StaticSeoPage = {
  path: string;
  title: string;
  description: string;
  indexable: boolean;
};

export function validateStaticSeoPages(value: unknown): asserts value is StaticSeoPage[] {
  assert.ok(Array.isArray(value), "the shared static SEO catalog must be an array");

  const seenPaths = new Set<string>();
  for (const [index, entry] of value.entries()) {
    assert.ok(
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
      `static SEO catalog entry #${index + 1} must be an object`,
    );

    const candidate = entry as Record<string, unknown>;
    const routePath = typeof candidate.path === "string" && candidate.path.trim()
      ? candidate.path
      : `<entry #${index + 1}>`;

    assert.ok(
      typeof candidate.path === "string" && candidate.path.trim().length > 0,
      `${routePath} must have a non-empty path`,
    );
    assert.ok(!seenPaths.has(candidate.path), `${candidate.path} is duplicated in the static SEO catalog`);
    seenPaths.add(candidate.path);

    assert.ok(
      typeof candidate.title === "string" && candidate.title.trim().length > 0,
      `${candidate.path} must have a non-empty title`,
    );
    assert.ok(
      typeof candidate.description === "string" && candidate.description.trim().length > 0,
      `${candidate.path} must have a non-empty description`,
    );
    assert.equal(
      typeof candidate.indexable,
      "boolean",
      `${candidate.path} must have a boolean indexable value`,
    );
  }
}

process.env.NODE_ENV = "test";
process.env.PUBLIC_SITE_URL = "https://lumera.example";
delete process.env.SITE_INDEXABLE;
const parsedStaticSeoPages: unknown = JSON.parse(
  read("artifacts/beauty-marketplace/src/lib/static-seo-pages.json"),
);
validateStaticSeoPages(parsedStaticSeoPages);
const staticSeoPages = parsedStaticSeoPages;

const validCatalogEntry: StaticSeoPage = {
  path: "/seo-validation-fixture",
  title: "SEO validation fixture",
  description: "Complete metadata used to verify the shared catalog validator.",
  indexable: true,
};
assert.doesNotThrow(() => validateStaticSeoPages([validCatalogEntry]));
assert.throws(
  () => validateStaticSeoPages([validCatalogEntry, { ...validCatalogEntry }]),
  /\/seo-validation-fixture.*duplicated/u,
);
assert.throws(
  () => validateStaticSeoPages([{ ...validCatalogEntry, title: " " }]),
  /\/seo-validation-fixture.*non-empty title/u,
);
assert.throws(
  () => validateStaticSeoPages([{ ...validCatalogEntry, description: "" }]),
  /\/seo-validation-fixture.*non-empty description/u,
);
assert.throws(
  () => validateStaticSeoPages([{ ...validCatalogEntry, indexable: "yes" }]),
  /\/seo-validation-fixture.*boolean indexable/u,
);
type SeoPayload = {
  title: string;
  description: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageType?: string;
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
  imageAlt: string;
  openGraph: {
    title: string;
    description: string;
    url: string;
    image: string;
    imageAlt: string;
    imageWidth?: number;
    imageHeight?: number;
    imageType?: string;
  };
  twitter: {
    title: string;
    description: string;
    url: string;
    image: string;
    imageAlt: string;
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
const { applySeo, resolvePostMountSeo, seoHeadMetadata } = await import(
  moduleUrl("artifacts/beauty-marketplace/src/components/client-seo-metadata.tsx")
) as {
  applySeo: (pathname: string, payload: SeoPayload) => void;
  resolvePostMountSeo: (
    pathname: string,
    searchString: string,
    queryClient: SeoQueryClient,
  ) => Promise<SeoPayload>;
  seoHeadMetadata: (
    pathname: string,
    payload: SeoPayload,
    origin: string,
    siteAllowed: boolean,
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
const staticPaths = new Set(staticSeoPages.map(({ path: routePath }) => routePath));
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
assert.deepEqual(
  staticSeoPages.filter(({ indexable }) => indexable).map(({ path: routePath }) => routePath).sort(),
  publicStaticPatterns,
  "the shared static SEO catalog must match every indexable static React route",
);
assert.match(server, /staticPageDefinitions/u, "the SEO server must consume the shared static SEO catalog");
assert.match(clientMetadata, /staticSeoPages/u, "the client must consume the shared static SEO catalog");
assert.match(
  server,
  /path\.resolve\(process\.argv\[1\]\)\s*===\s*fileURLToPath\(import\.meta\.url\)/u,
  "the SEO server must only open its HTTP listener when run as the process entry point",
);
assert.doesNotMatch(
  server,
  /process\.env\.NODE_ENV\s*!==\s*['"]test['"]/u,
  "import safety must not depend on callers setting NODE_ENV=test",
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
  imageUrl: "/glow-serum-cover.jpg",
  images: ["/glow-serum-gallery.jpg"],
  reviewSummary: { averageRating: 4.876, reviewCount: 3 },
};
const salon = {
  id: "glow-salon",
  slug: "glow-studio",
  name: "Glow Studio",
  city: "Beograd",
  address: "Tošin bunar 181",
  postalCode: "11000",
  description: "Salon za negu lica i kose.",
  imageUrl: "/glow-studio-cover.jpg",
  coverImageDescription: "Enterijer Glow Studija",
  gallery: ["/glow-studio-gallery.jpg"],
  rating: 4.876,
  reviewCount: 2,
  services: [{ name: "Nega lica", price: 3000, promoPrice: 2500 }],
  hours: [{ day: "Ponedeljak", open: "09:00", close: "17:00", closed: false }],
  reviews: [{ authorName: "Ana", rating: 5, text: "Odlična usluga." }],
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
    imageAlt: string | null;
    imageWidth?: number;
    imageHeight?: number;
    imageType?: string;
  };
  twitter: {
    title: string | null;
    description: string | null;
    url: string | null;
    image: string | null;
    imageAlt: string | null;
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

function optionalHtmlNumber(html: string, pattern: RegExp): number | undefined {
  const value = html.match(pattern)?.[1];
  return value === undefined ? undefined : Number(value);
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
      imageAlt: optionalHtmlAttribute(html, /<meta property="og:image:alt" content="([^"]*)">/u),
      imageWidth: optionalHtmlNumber(html, /<meta property="og:image:width" content="([^"]*)">/u),
      imageHeight: optionalHtmlNumber(html, /<meta property="og:image:height" content="([^"]*)">/u),
      imageType: optionalHtmlAttribute(html, /<meta property="og:image:type" content="([^"]*)">/u) ?? undefined,
    },
    twitter: {
      title: optionalHtmlAttribute(html, /<meta name="twitter:title" content="([^"]*)">/u),
      description: optionalHtmlAttribute(html, /<meta name="twitter:description" content="([^"]*)">/u),
      url: optionalHtmlAttribute(html, /<meta name="twitter:url" content="([^"]*)">/u),
      image: optionalHtmlAttribute(html, /<meta name="twitter:image" content="([^"]*)">/u),
      imageAlt: optionalHtmlAttribute(html, /<meta name="twitter:image:alt" content="([^"]*)">/u),
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
  siteAllowed: boolean;
}> {
  const response = await createSeoResponse({
    url: pathname,
    headers: {
      host: "lumera.example",
      "x-forwarded-host": "lumera.example",
      "x-forwarded-proto": "https",
    },
  }, htmlTemplate);
  const siteAllowed = optionalHtmlAttribute(response.body, /<meta name="lumera:site-indexable" content="([^"]*)">/u) === "true";
  assert.equal(siteAllowed, false, "the parity fixture must exercise staging noindex policy");
  return { status: response.status, head: ssrHead(response.body), siteAllowed };
}

async function clientMetadataAfterMount(
  pathname: string,
  siteAllowed: boolean,
  searchString = "",
): Promise<ComparableSeoHead> {
  const queryClient: SeoQueryClient = {
    getQueryData: () => undefined,
    getQueryState: () => undefined,
    fetchQuery: async <T>({ queryFn }: { queryFn: () => Promise<T> }) => queryFn(),
  };
  const payload = await resolvePostMountSeo(pathname, searchString, queryClient);
  const head = seoHeadMetadata(pathname, payload, seoOrigin, siteAllowed);
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
  // Fixture-only, initial HTML checks: no API process or database is involved.
  const structuredRoutes: Array<[string, string[]]> = [
    ["/", ["Organization", "WebSite"]],
    ["/saloni/glow-studio", ["HealthAndBeautyBusiness", "OfferCatalog", "AggregateRating", "Review", "BreadcrumbList"]],
    [`/edukacije/${course.id}`, ["Course", "BreadcrumbList"]],
    [`/edukacije/instruktori/${instructor.id}`, ["Person", "BreadcrumbList"]],
    [`/edukacije/centri/${center.id}`, ["EducationalOrganization", "BreadcrumbList"]],
    [`/edukacije/paketi/${bundle.id}`, ["Product", "Offer", "BreadcrumbList"]],
    [`/poslovi/${beautyJob.slug}/${beautyJob.id}`, ["JobPosting", "BreadcrumbList"]],
    [`/shop/${supplier.slug}/proizvod/${product.id}`, ["Product", "Offer", "BreadcrumbList"]],
    [`/shop/${supplier.slug}`, ["ItemList", "BreadcrumbList"]],
    [`/shop/${supplier.slug}/${category.path}`, ["ItemList", "BreadcrumbList"]],
    ["/edukacije/sekcije/nega/lice/hidratacija", ["ItemList", "BreadcrumbList"]],
    [categoryPaths[0], ["ItemList", "BreadcrumbList"]],
    ...staticRouteContracts.filter((pathname) => pathname !== "/").map((pathname): [string, string[]] => [pathname, ["BreadcrumbList"]]),
  ];
  function inspectSchema(value: unknown, types: Set<string>): void {
    assert.notEqual(value, null, "JSON-LD must not contain null");
    if (typeof value === "string") {
      assert.ok(value.trim(), "JSON-LD must not contain empty strings");
      assert.doesNotMatch(value, /^(?:undefined|null|placeholder|todo|tbd|n\/a)$/iu);
    } else if (Array.isArray(value)) {
      assert.ok(value.length, "JSON-LD must not contain empty arrays");
      value.forEach((item) => inspectSchema(item, types));
    } else if (typeof value === "object" && value) {
      assert.ok(Object.keys(value).length, "JSON-LD must not contain empty objects");
      for (const [key, item] of Object.entries(value)) {
        assert.notEqual(key, "sameAs");
        if (key === "@type" && typeof item === "string") types.add(item);
        inspectSchema(item, types);
      }
    }
  }
  for (const [pathname, expectedTypes] of structuredRoutes) {
    const result = await createSeoResponse({ url: pathname, headers: { host: "lumera.example", "x-forwarded-proto": "https" } }, htmlTemplate);
    assert.equal(result.status, 200, pathname);
    const scripts = [...result.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)];
    assert.ok(scripts.length, `${pathname} needs initial HTML JSON-LD`);
    const types = new Set<string>();
    scripts.forEach((script) => inspectSchema(JSON.parse(script[1]), types));
    expectedTypes.forEach((type) => assert.ok(types.has(type), `${pathname} needs ${type}`));
    assert.match(result.body, /name="robots" content="noindex, nofollow"/u, "staging remains noindex");
    if (pathname === "/") assert.doesNotMatch(scripts[0][1], /"logo":/u);
    if (pathname === "/saloni/glow-studio") {
      assert.match(scripts[0][1], /"ratingValue":4.9/u);
      assert.match(result.body, /<p>Ocena: 4.9 \(2 recenzija\)<\/p>/u);
      assert.doesNotMatch(result.body, /4\.876/u);
      assert.match(scripts[0][1], /"reviewCount":2/u);
      assert.match(scripts[0][1], /"price":2500/u);
      assert.doesNotMatch(scripts[0][1], /"(?:telephone|geo)":/u);
      assert.match(scripts[0][1], /"streetAddress":"Tošin bunar 181"/u);
      assert.match(scripts[0][1], /"postalCode":"11000"/u);
      assert.match(result.body, /Tošin bunar 181, 11000 Beograd<\/a>/u);
    }
    if (pathname === `/shop/${supplier.slug}/proizvod/${product.id}`) {
      assert.doesNotMatch(scripts[0][1], /"@type":"AggregateRating"/u, "coarse star icons do not expose an exact numeric average");
      assert.doesNotMatch(result.body, /<p>Ocena: /u, "do not invent an SSR-only numeric product rating");
      assert.doesNotMatch(result.body, /4\.876/u);
    }
    if (process.env.SEO_FIXTURE_EVIDENCE_DIR && ["/", "/saloni/glow-studio", `/edukacije/${course.id}`].includes(pathname)) {
      fs.mkdirSync(process.env.SEO_FIXTURE_EVIDENCE_DIR, { recursive: true });
      const filename = pathname === "/" ? "home" : pathname.startsWith("/saloni/") ? "salon" : "course";
      fs.writeFileSync(path.join(process.env.SEO_FIXTURE_EVIDENCE_DIR, `${filename}.fixture.html`),
        `<!-- MOCKED PUBLIC DTO TEST FIXTURE; NOT LIVE DATA; no database access -->\n${result.body}`);
    }
  }
  for (const pathname of ["/admin", "/moj-nalog", "/saloni/nepostojeci-salon"]) {
    const result = await createSeoResponse({ url: pathname, headers: { host: "lumera.example", "x-forwarded-proto": "https" } }, htmlTemplate);
    assert.doesNotMatch(result.body, /type="application\/ld\+json"/u, "private and missing pages have no entity data");
  }
  // Anonymous initial HTML evidence from the real SEO response path, with mocked
  // public DTOs only. No browser/JavaScript execution and no database mutations.
  const addressDetails = {
    entranceDirections: "ulaz sa bočne strane odmah pored dečijeg tobogana",
    intercom: "22 enter", floor: "IV sprat", apartment: "22",
  };
  for (const kind of ["main-road", "apartment"] as const) {
    if (kind === "apartment") Object.assign(salon, addressDetails);
    const result = await createSeoResponse({ url: "/saloni/glow-studio", headers: { host: "lumera.example", "x-forwarded-proto": "https" } }, htmlTemplate);
    const expected = kind === "apartment"
      ? "Tošin bunar 181, (ulaz sa bočne strane odmah pored dečijeg tobogana), interfon 22 enter, IV sprat, stan 22, 11000 Beograd"
      : "Tošin bunar 181, 11000 Beograd";
    assert.ok(result.body.includes(`${expected}</a>`));
    assert.match(result.body, /name="robots" content="noindex, nofollow"/u);
    const structured = [...result.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)].map((match) => match[1]).join("");
    assert.match(structured, /"streetAddress":"Tošin bunar 181"/u);
    assert.doesNotMatch(structured, /ulaz sa bočne|22 enter|IV sprat|"apartment"|"geo"/u);
    const maps = result.body.match(/href="(https:\/\/www.google.com\/maps\/search\/[^"]+)"/u);
    assert.ok(maps);
    assert.equal(new URL(maps[1].replaceAll("&amp;", "&")).searchParams.get("query"), "Tošin bunar 181, 11000 Beograd, Serbia");
    if (process.env.SEO_FIXTURE_EVIDENCE_DIR) {
      fs.mkdirSync(process.env.SEO_FIXTURE_EVIDENCE_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.SEO_FIXTURE_EVIDENCE_DIR, `${kind}.fixture.html`),
        `<!-- MOCKED PUBLIC DTO; anonymous initial server HTML; NOT live data; no JavaScript executed -->\n${result.body}`);
    }
  }
  Object.assign(salon, { entranceDirections: "<img src=x onerror=alert(1)>" });
  const escapedEntrance = await createSeoResponse({ url: "/saloni/glow-studio", headers: { host: "lumera.example", "x-forwarded-proto": "https" } }, htmlTemplate);
  assert.match(escapedEntrance.body, /\(&lt;img src=x onerror=alert\(1\)&gt;\)/u);
  assert.doesNotMatch(escapedEntrance.body, /<img src=x/u);
  for (const key of Object.keys(addressDetails)) Reflect.deleteProperty(salon, key);
  const originalJobType = beautyJob.type;
  for (const type of ["space_rental", "equipment_rental", "freelance"]) {
    beautyJob.type = type;
    const result = await createSeoResponse({ url: `/poslovi/${beautyJob.slug}/${beautyJob.id}`, headers: { host: "lumera.example", "x-forwarded-proto": "https" } }, htmlTemplate);
    assert.doesNotMatch(result.body, /"@type":"JobPosting"/u);
  }
  beautyJob.type = originalJobType;
  beautyJob.intent = "seeking";
  const seekingResult = await createSeoResponse({ url: `/poslovi/${beautyJob.slug}/${beautyJob.id}`, headers: { host: "lumera.example", "x-forwarded-proto": "https" } }, htmlTemplate);
  assert.doesNotMatch(seekingResult.body, /"@type":"JobPosting"/u);
  beautyJob.intent = "offering";
  // Exact address is public; an over-broad DTO must still not leak phone/geo.
  Object.assign(salon, { address: "PRIVATE_STREET", phone: "PRIVATE_PHONE", latitude: 44.1, longitude: 20.1 });
  const privateFieldResult = await createSeoResponse({ url: "/saloni/glow-studio", headers: { host: "lumera.example", "x-forwarded-proto": "https" } }, htmlTemplate);
  assert.match(privateFieldResult.body, /PRIVATE_STREET/u);
  assert.doesNotMatch(privateFieldResult.body, /PRIVATE_PHONE|"geo":|"telephone":/u);
  assert.match(privateFieldResult.body, /"streetAddress":"PRIVATE_STREET"/u);
  assert.match(privateFieldResult.body, /"addressCountry":"RS"/u);
  assert.match(privateFieldResult.body, /target="_blank" rel="noopener noreferrer"/u);
  assert.doesNotMatch(privateFieldResult.body, /44\.1|20\.1/u);
  Object.assign(salon, { address: '<img src=x onerror=alert(1)> & "street"', postalCode: "11000" });
  const escapedAddressResult = await createSeoResponse({ url: "/saloni/glow-studio", headers: { host: "lumera.example", "x-forwarded-proto": "https" } }, htmlTemplate);
  assert.match(escapedAddressResult.body, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;street&quot;/u);
  assert.doesNotMatch(escapedAddressResult.body, /<img src=x/u);
  for (const [flag, value] of [["active", false], ["published", false], ["hideAddress", true]] as const) {
    Object.assign(salon, { address: "HIDDEN_STREET", entranceDirections: "HIDDEN_ENTRANCE", intercom: "HIDDEN_INTERCOM", floor: "HIDDEN_FLOOR", apartment: "HIDDEN_APARTMENT", [flag]: value });
    const hiddenAddressResult = await createSeoResponse({ url: "/saloni/glow-studio", headers: { host: "lumera.example", "x-forwarded-proto": "https" } }, htmlTemplate);
    assert.doesNotMatch(hiddenAddressResult.body, /HIDDEN_STREET|HIDDEN_ENTRANCE|HIDDEN_INTERCOM|HIDDEN_FLOOR|HIDDEN_APARTMENT|PRIVATE_PHONE|"geo":|"telephone":/u);
    assert.match(hiddenAddressResult.body, /name="robots" content="noindex, nofollow"/u);
    Reflect.deleteProperty(salon, flag);
  }
  for (const key of Object.keys(addressDetails)) Reflect.deleteProperty(salon, key);
  Reflect.deleteProperty(salon, "postalCode");
  for (const key of ["address", "phone", "latitude", "longitude"]) Reflect.deleteProperty(salon, key);
  const savedRating = salon.rating;
  const savedCount = salon.reviewCount;
  salon.rating = 0;
  salon.reviewCount = 0;
  const unratedResult = await createSeoResponse({ url: "/saloni/glow-studio", headers: { host: "lumera.example", "x-forwarded-proto": "https" } }, htmlTemplate);
  assert.doesNotMatch(unratedResult.body, /"@type":"AggregateRating"/u);
  salon.rating = savedRating;
  salon.reviewCount = savedCount;
  for (const pathname of staticRouteContracts) {
    const serverResult = await serverMetadata(pathname);
    assert.equal(serverResult.status, 200, `${pathname} static fixture must server-render`);
    assert.deepEqual(
      await clientMetadataAfterMount(pathname, serverResult.siteAllowed),
      serverResult.head,
      `${pathname} must preserve SSR title, description, canonical, and robots after mount`,
    );

    const queryPath = `${pathname}?seo-contract=1`;
    const queryResult = await serverMetadata(queryPath);
    assert.equal(queryResult.status, 200, `${pathname} query variant must render safely`);
    const clientQueryHead = await clientMetadataAfterMount(pathname, queryResult.siteAllowed, "seo-contract=1");
    assert.deepEqual(
      clientQueryHead,
      queryResult.head,
      `${pathname} query variant must preserve SSR metadata after mount`,
    );
    assert.equal(queryResult.head.robots, "noindex, nofollow");
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
      await clientMetadataAfterMount(contract.pathname, serverResult.siteAllowed),
      serverResult.head,
      `${contract.pattern} must preserve SSR title, description, canonical, robots, Open Graph, and Twitter metadata after mount`,
    );
    assert.equal(serverResult.head.openGraph.url, serverResult.head.canonical);
    assert.equal(serverResult.head.twitter.url, serverResult.head.canonical);
    assert.deepEqual(serverResult.head.twitter, {
      title: serverResult.head.openGraph.title,
      description: serverResult.head.openGraph.description,
      url: serverResult.head.openGraph.url,
      image: serverResult.head.openGraph.image,
      imageAlt: serverResult.head.openGraph.imageAlt,
    });

    const queryResult = await serverMetadata(`${contract.pathname}?seo-contract=1`);
    assert.equal(queryResult.status, 200, `${contract.pattern} query variant must render safely`);
    assert.equal(
      queryResult.head.robots,
      "noindex, nofollow",
      `${contract.pattern} query variant must remain noindex`,
    );
    assert.equal(
      queryResult.head.canonical,
      `${seoOrigin}${contract.pathname}`,
      `${contract.pattern} query canonical must omit the query string`,
    );
    const clientQueryHead = await clientMetadataAfterMount(contract.pathname, queryResult.siteAllowed, "seo-contract=1");
    assert.deepEqual(
      clientQueryHead,
      queryResult.head,
      `${contract.pattern} query variant must preserve SSR title, description, canonical, robots, Open Graph, and Twitter metadata after mount`,
    );
    assert.equal(queryResult.head.openGraph.url, queryResult.head.canonical);
    assert.equal(queryResult.head.twitter.url, queryResult.head.canonical);
    assert.deepEqual(queryResult.head.twitter, {
      title: queryResult.head.openGraph.title,
      description: queryResult.head.openGraph.description,
      url: queryResult.head.openGraph.url,
      image: queryResult.head.openGraph.image,
      imageAlt: queryResult.head.openGraph.imageAlt,
    });

    const missingServerResult = await serverMetadata(contract.missingPathname);
    assert.equal(
      missingServerResult.status,
      404,
      `${contract.pattern} missing fixture must use the not-found response`,
    );
    assert.equal(
      missingServerResult.head.robots,
      "noindex, nofollow",
      `${contract.pattern} missing fixture must remain noindex in SSR`,
    );
    assert.equal(
      (await clientMetadataAfterMount(contract.missingPathname, missingServerResult.siteAllowed)).robots,
      "noindex, nofollow",
      `${contract.pattern} missing fixture must remain noindex after mount`,
    );
  }

  assert.equal(
    (await serverMetadata("/saloni/glow-studio")).head.openGraph.image,
    `${seoOrigin}/glow-studio-cover.jpg`,
    "the salon cover image, not a gallery image, must resolve against the public origin",
  );
  assert.equal(
    (await serverMetadata("/shop/glow-supply/proizvod/glow-product")).head.openGraph.image,
    `${seoOrigin}/glow-serum-cover.jpg`,
    "the product cover image, not a gallery image, must resolve against the public origin",
  );
  assert.equal(
    (await serverMetadata("/shop/glow-supply")).head.openGraph.image,
    supplier.logoUrl,
    "absolute social images must remain unchanged",
  );
  assert.equal(
    (await serverMetadata("/saloni/glow-studio")).head.openGraph.imageAlt,
    salon.coverImageDescription,
    "dynamic social images must prefer the owner's cover description",
  );
  assert.equal(
    (await serverMetadata("/")).head.openGraph.imageAlt,
    "LUMERA platforma za beauty i wellness usluge, proizvode i edukacije",
    "the default LUMERA social image must have a suitable description",
  );
  assert.deepEqual(
    (await serverMetadata("/")).head.openGraph,
    {
      title: "LUMERA | Saloni, tretmani i edukacije",
      description: "Pronađite proverene salone, beauty i wellness tretmane i stručne edukacije na jednom mestu uz LUMERA.",
      url: `${seoOrigin}/`,
      image: `${seoOrigin}/og-lumera.png`,
      imageAlt: "LUMERA platforma za beauty i wellness usluge, proizvode i edukacije",
      imageWidth: 1200,
      imageHeight: 630,
      imageType: "image/png",
    },
    "the default LUMERA social image must publish its verified dimensions and MIME type",
  );

  const extensionOnlyImage = seoHeadMetadata("/test", {
    title: "Test",
    description: "Test",
    image: "/social-card.webp?version=2",
    indexable: true,
  }, seoOrigin, false).openGraph;
  assert.equal(extensionOnlyImage.imageType, undefined);
  assert.equal(extensionOnlyImage.imageWidth, undefined);
  assert.equal(extensionOnlyImage.imageHeight, undefined);

  const unknownImage = seoHeadMetadata("/test", {
    title: "Test",
    description: "Test",
    image: "/api/media/images/11111111-1111-4111-8111-111111111111",
    indexable: true,
  }, seoOrigin, false).openGraph;
  assert.equal(unknownImage.imageType, undefined);
  assert.equal(unknownImage.imageWidth, undefined);
  assert.equal(unknownImage.imageHeight, undefined);

  const explicitImage = seoHeadMetadata("/test", {
    title: "Test",
    description: "Test",
    image: "/managed-image",
    imageWidth: 960,
    imageHeight: 640,
    imageType: "image/webp",
    indexable: true,
  }, seoOrigin, false).openGraph;
  assert.equal(explicitImage.imageWidth, 960);
  assert.equal(explicitImage.imageHeight, 640);
  assert.equal(explicitImage.imageType, "image/webp");

  type FakeHeadNode = {
    content: string;
    href: string;
    rel: string;
    attributes: Record<string, string>;
    setAttribute: (key: string, value: string) => void;
    remove: () => void;
  };
  const nodes = new Map<string, FakeHeadNode>();
  const fakeHead = {
    querySelector: (selector: string) => nodes.get(selector) ?? null,
    append: (node: FakeHeadNode) => {
      const selector = node.attributes.property
        ? `meta[property="${node.attributes.property}"]`
        : node.attributes.name
          ? `meta[name="${node.attributes.name}"]`
          : `link[rel="${node.rel}"]`;
      nodes.set(selector, node);
    },
  };
  const fakeDocument = {
    title: "",
    querySelector: fakeHead.querySelector,
    head: fakeHead,
    createElement: () => {
      const node: FakeHeadNode = {
        content: "",
        href: "",
        rel: "",
        attributes: {},
        setAttribute(key, value) { this.attributes[key] = value; },
        remove() {
          for (const [selector, candidate] of nodes) {
            if (candidate === this) nodes.delete(selector);
          }
        },
      };
      return node;
    },
  };
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  for (const [name, content] of [
    ["lumera:public-site-url", seoOrigin],
    ["lumera:site-indexable", String((await serverMetadata("/")).siteAllowed)],
  ]) {
    const node = fakeDocument.createElement();
    node.setAttribute("name", name);
    node.content = content;
    fakeHead.append(node);
  }
  Object.assign(globalThis, {
    document: fakeDocument,
    window: { location: { origin: seoOrigin, host: new URL(seoOrigin).host } },
  });
  try {
    applySeo("/", {
      title: "LUMERA",
      description: "LUMERA",
      indexable: true,
    });
    assert.equal(nodes.get('meta[name="robots"]')?.content, "noindex, nofollow");
    assert.equal(nodes.get('meta[property="og:image:width"]')?.content, "1200");
    assert.equal(nodes.get('meta[property="og:image:height"]')?.content, "630");
    assert.equal(nodes.get('meta[property="og:image:type"]')?.content, "image/png");

    applySeo("/test", {
      title: "Test",
      description: "Test",
      image: "/image-without-known-metadata",
      indexable: true,
    });
    assert.equal(nodes.has('meta[property="og:image:width"]'), false);
    assert.equal(nodes.has('meta[property="og:image:height"]'), false);
    assert.equal(nodes.has('meta[property="og:image:type"]'), false);
    nodes.get('meta[name="lumera:site-indexable"]')!.content = "true";
    applySeo("/", {
      title: "LUMERA",
      description: "LUMERA",
      indexable: true,
    });
    assert.equal(nodes.get('meta[name="robots"]')?.content, "index, follow");

    Object.assign(globalThis.window.location, { host: "different-host.example" });
    applySeo("/", {
      title: "LUMERA",
      description: "LUMERA",
      indexable: true,
    });
    assert.equal(nodes.get('meta[name="robots"]')?.content, "noindex, nofollow");
  } finally {
    if (originalDocument === undefined) {
      Reflect.deleteProperty(globalThis, "document");
    } else {
      globalThis.document = originalDocument;
    }
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      globalThis.window = originalWindow;
    }
  }

  const privateQueryResult = await serverMetadata("/admin?seo-contract=1");
  assert.equal(privateQueryResult.status, 200, "private query routes must render the app shell");
  assert.equal(privateQueryResult.head.robots, "noindex, nofollow");
  assert.equal(privateQueryResult.head.canonical, `${seoOrigin}/admin`);
  assert.deepEqual(
    privateQueryResult.head.openGraph,
    {
      title: null,
      description: null,
      url: null,
      image: null,
      imageAlt: null,
      imageWidth: undefined,
      imageHeight: undefined,
      imageType: undefined,
    },
    "private query routes must not receive public Open Graph metadata",
  );
  assert.deepEqual(
    privateQueryResult.head.twitter,
    { title: null, description: null, url: null, image: null, imageAlt: null },
    "private query routes must not receive public Twitter metadata",
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
