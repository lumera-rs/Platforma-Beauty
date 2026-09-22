import { expect, test, type Page } from "@playwright/test";

const courseId = "00000000-0000-4000-8000-000000000003";
const managed = 'script[data-lumera-structured-data="current-page"]';
type SeoSchedulingWindow = Window & {
  __seoHeld: number;
  __seoFinished: number;
  __seoHoldResolution: (pathname: string) => Promise<void>;
  __seoReleaseResolution: () => void;
  __seoResolutionFinished: (pathname: string) => void;
};

async function holdRealMetadataResolution(page: Page) {
  // Test-only scheduling of the REAL resolver promise and its existing guarded
  // callback. No replacement resolver, production flag, or alternate guard.
  // HTTP alone cannot test late resolution: the visible hook aborts on unmount.
  await page.addInitScript(() => {
    const state = window as unknown as SeoSchedulingWindow;
    state.__seoHeld = 0;
    state.__seoFinished = 0;
    const hold = new Promise<void>((resolve) => { state.__seoReleaseResolution = resolve; });
    state.__seoHoldResolution = async (pathname) => {
      if (pathname !== "/saloni/seo-slow") return;
      state.__seoHeld++;
      await hold;
    };
    state.__seoResolutionFinished = (pathname) => {
      if (pathname === "/saloni/seo-slow") state.__seoFinished++;
    };
  });
  await page.route("**/src/components/client-seo-metadata.tsx*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const resolver = "resolvePostMountSeo(pathname, searchString, queryClient, publicSiteOrigin()).then";
    const settlement = "}).catch(() => {";
    expect(source.split(resolver)).toHaveLength(2);
    expect(source.split(settlement)).toHaveLength(2);
    await route.fulfill({ response, body: source
      .replace(resolver, "resolvePostMountSeo(pathname, searchString, queryClient, publicSiteOrigin()).then(async (payload) => { await window.__seoHoldResolution(pathname); return payload; }).then")
      .replace(settlement, "}).finally(() => window.__seoResolutionFinished(pathname)).catch(() => {") });
  });
}
async function expectSchemaText(page: Page, text: string, absent = false) {
  // JSON-LD is non-rendered content: read textContent, not Playwright innerText.
  // Negative assertions also require exactly one valid current-page document.
  await expect.poll(() => page.locator(managed).evaluateAll((scripts, expected) => {
    if (scripts.length !== 1) return false;
    const json = JSON.stringify(JSON.parse(scripts[0].textContent || ""));
    return json.includes(expected.text) !== expected.absent;
  }, { text, absent }), { message: `Current JSON-LD must ${absent ? "exclude" : "include"} ${text}` }).toBe(true);
}
const salon = (name: string, slug: string) => ({
  id: slug, slug, name, city: "Beograd", address: "Javna ulica 1",
  category: "Frizerski salon", description: `Javni opis ${name}.`,
  imageUrl: null, gallery: [], services: [], staff: [], reviews: [], hours: [],
  popularServices: [], topServices: [], amenities: [], paymentMethods: [], rating: 0, reviewCount: 0,
});

async function navigate(page: Page, path: string) {
  // Wouter subscribes to the real browser history API; this does not reload the
  // document or mount a stand-in metadata component.
  await page.evaluate((next) => history.pushState(null, "", next), path);
}

async function expectPublicImageAlts(page: Page) {
  expect(await page.locator("img").evaluateAll((images) => images
    .filter((image) => !image.getAttribute("alt")?.trim())
    .map((image) => image.getAttribute("src")))).toEqual([]);
}

test("real SPA navigation replaces current JSON-LD and clears unsupported routes", async ({ page }) => {
  const requests = new Map<string, number>();
  const listingRequests: string[] = [];
  const errors: string[] = [];
  let releaseSlowResponse!: () => void;
  let finishSlowFixture!: () => void;
  const slowRelease = new Promise<void>((resolve) => { releaseSlowResponse = resolve; });
  const slowFixtureComplete = new Promise<void>((resolve) => { finishSlowFixture = resolve; });
  let releaseFirstSalon!: () => void;
  const firstSalonRelease = new Promise<void>((resolve) => { releaseFirstSalon = resolve; });
  await holdRealMetadataResolution(page);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.set(path, (requests.get(path) ?? 0) + 1);
    let body: unknown = [];
    let status = 200;
    if (path === "/api/salons/seo-a") {
      await firstSalonRelease;
      body = salon("SEO Salon A", "seo-a");
    }
    else if (path === "/api/salons/seo-b") body = salon("SEO Salon B", "seo-b");
    else if (path === "/api/salons") {
      listingRequests.push(route.request().url());
      const params = new URL(route.request().url()).searchParams;
      body = params.get("city") === "Prazan Grad" || Number(params.get("page")) > 2 ? [] : params.get("page") === "2"
        ? Array.from({ length: 6 }, (_, index) => salon(index === 0 ? "SEO Page Two" : `SEO Final ${index}`, `seo-final-${index}`))
        : Array.from({ length: 6 }, (_, index) => salon(`SEO List ${index + 1}`, `seo-list-${index + 1}`));
    }
    else if (path === "/api/salons/seo-slow") {
      await slowRelease;
      body = salon("SEO Slow Salon", "seo-slow");
    }
    else if (path === `/api/education/public/courses/${courseId}`) body = {
      id: courseId, title: "SEO Kurs", description: "Javna edukacija za negu.",
      publisher: "SEO Akademija", category: "Nega", city: "Beograd",
      format: "in_person", price: 1200, duration: "2 sata",
      gallery: [], sessions: [], instructors: [], imageUrl: null,
      dayProgram: [], learningOutcomes: [], includedItems: [], reviews: [],
      rating: 0, reviewCount: 0,
    };
    else if (/current-user|auth\/me/.test(path)) body = { user: null };
    else if (/first-available/.test(path)) body = {};
    else if (/media.*description/.test(path)) body = {};
    else if (/\/salons\/[^/]+$/.test(path)) { body = { error: "Not found" }; status = 404; }
    try {
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    } catch (error) {
      if (path !== "/api/salons/seo-slow" || !/abort|cancel/i.test(route.request().failure()?.errorText ?? "")) throw error;
    } finally {
      if (path === "/api/salons/seo-slow") finishSlowFixture();
    }
  });
  await page.goto("/");
  await expectSchemaText(page, '"Organization"');
  await expectSchemaText(page, '"WebSite"');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  const firstRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/salons/seo-a");
  await navigate(page, "/saloni/seo-a");
  await firstRequest;
  await expect(page.locator(managed), "previous home JSON-LD must be gone while new salon data is held").toHaveCount(0);
  releaseFirstSalon();
  await expect(page.getByRole("heading", { level: 1, name: "SEO Salon A" })).toBeVisible();
  await expect(page.locator(managed)).toHaveCount(1);
  await expectSchemaText(page, "SEO Salon A");
  expect(requests.get("/api/salons/seo-a"), "initial lazy salon mount must own exactly one detail request").toBe(1);
  await expectPublicImageAlts(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await page.evaluate(() => {
    Object.assign(window, { seoDocumentMarker: "same-document" });
    const stale = document.createElement("script");
    stale.type = "application/ld+json";
    stale.dataset.lumeraStructuredData = "current-page";
    stale.textContent = '{"@type":"BreadcrumbList","name":"old SSR breadcrumb"}';
    document.body.append(stale);
  });
  await navigate(page, "/saloni/seo-b");
  await expect(page.getByRole("heading", { level: 1, name: "SEO Salon B" })).toBeVisible();
  await expect(page.locator(managed)).toHaveCount(1);
  await expectSchemaText(page, "SEO Salon B");
  expect(requests.get("/api/salons/seo-b"), "salon-to-salon navigation must reuse the visible detail request").toBe(1);
  await expectSchemaText(page, "SEO Salon A", true);
  await expectSchemaText(page, "old SSR breadcrumb", true);
  await expectPublicImageAlts(page);
  await navigate(page, `/edukacije/${courseId}`);
  await expect(page.getByRole("heading", { level: 1, name: "SEO Kurs" })).toBeVisible();
  await expect(page.locator(managed)).toHaveCount(1);
  await expectSchemaText(page, "SEO Kurs");
  expect(requests.get(`/api/education/public/courses/${courseId}`), "salon-to-course navigation must reuse the visible detail request").toBe(1);
  await expectSchemaText(page, "SEO Salon", true);
  await expectPublicImageAlts(page);
  await navigate(page, "/saloni?city=Beograd&page=2");
  await expectSchemaText(page, "SEO Page Two");
  await expect(page).toHaveTitle("Saloni u Beogradu | LUMERA");
  await expect(page.getByRole("heading", { level: 1, name: "Saloni u Beogradu", exact: true })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://lumera.example/saloni?city=Beograd&page=2");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("link", { name: "Sledeća", exact: true })).toHaveCount(0);
  await navigate(page, "/saloni?city=Beograd&page=1");
  await expect(page.locator(managed)).toHaveCount(1);
  await expectSchemaText(page, '"ItemList"');
  await expectSchemaText(page, "SEO List 1");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://lumera.example/saloni?city=Beograd");
  await expectSchemaText(page, "SEO Kurs", true);
  await expectPublicImageAlts(page);
  const next = page.getByRole("link", { name: "Sledeća", exact: true });
  await expect(next).toHaveAttribute("href", /city=Beograd.*page=2|page=2.*city=Beograd/);
  await next.click();
  await expect(page).toHaveURL(/page=2/);
  await expectSchemaText(page, "SEO Page Two");
  expect(listingRequests.some((request) => {
    const url = new URL(request);
    return url.searchParams.get("page") === "2" && url.searchParams.get("city") === "Beograd"
      && url.searchParams.get("pageSize") === "6";
  })).toBe(true);
  await expectSchemaText(page, "SEO List 1", true);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /city=Beograd.*page=2/);
  await page.goBack();
  await expectSchemaText(page, "SEO List 1");
  await page.goForward();
  await expectSchemaText(page, "SEO Page Two");
  await navigate(page, "/");
  await expect(page.locator(managed)).toHaveCount(1);
  await expectSchemaText(page, '"Organization"');
  await expectSchemaText(page, '"WebSite"');
  await expectSchemaText(page, "SEO Page Two", true);
  await expectPublicImageAlts(page);
  const slowRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/salons/seo-slow");
  await navigate(page, "/saloni/seo-slow");
  await slowRequest;
  await expect(page.locator(managed), "previous home JSON-LD must be gone while slow salon data is held").toHaveCount(0);
  releaseSlowResponse();
  await slowFixtureComplete;
  await expect.poll(() => page.evaluate(() => (window as unknown as SeoSchedulingWindow).__seoHeld)).toBeGreaterThan(0);
  // Data is real and loaded; only completion of its real metadata promise is
  // held. Navigate to a page with its own schema before releasing that promise.
  await navigate(page, "/");
  await expectSchemaText(page, '"Organization"');
  await expectSchemaText(page, '"WebSite"');
  const currentHomeSchema = await page.locator(managed).evaluate((script) => script.textContent);
  await page.evaluate(() => (window as unknown as SeoSchedulingWindow).__seoReleaseResolution());
  await expect.poll(() => page.evaluate(() => {
    const state = window as unknown as SeoSchedulingWindow;
    return state.__seoHeld > 0 && state.__seoFinished === state.__seoHeld;
  })).toBe(true);
  await expect.poll(() => page.locator(managed).evaluateAll((scripts) => scripts.map((script) => script.textContent)),
    { message: "late salon resolution must leave the active home JSON-LD byte-identical" }).toEqual([currentHomeSchema]);
  await expectSchemaText(page, "SEO Slow Salon", true);
  for (const scenario of [
    { path: "/saloni", canonical: "/saloni", title: "Saloni i beauty tretmani | LUMERA" },
    { path: "/saloni?page=1", canonical: "/saloni", title: "Saloni i beauty tretmani | LUMERA" },
    { path: "/saloni?page=2", canonical: "/saloni?page=2", title: "Saloni i beauty tretmani | LUMERA" },
    { path: "/saloni?city=Beograd", canonical: "/saloni?city=Beograd", title: "Saloni u Beogradu | LUMERA", heading: "Saloni u Beogradu" },
    { path: "/saloni?city=Beograd&brand=Test&page=2", canonical: "/saloni?city=Beograd", title: "Saloni u Beogradu | LUMERA", heading: "Saloni u Beogradu" },
    { path: "/saloni?brand=Test&page=2", canonical: "/saloni", title: "Saloni i beauty tretmani | LUMERA" },
    { path: "/saloni?city=Prazan+Grad", canonical: "/saloni?city=Prazan+Grad", title: "Saloni Prazan Grad | LUMERA", heading: "Saloni Prazan Grad", empty: true },
    { path: "/saloni?city=Atlantida", canonical: "/saloni?city=Atlantida", title: "Saloni Atlantida | LUMERA", heading: "Saloni Atlantida" },
  ]) {
    await navigate(page, scenario.path);
    await expect(page).toHaveTitle(scenario.title);
    await expectSchemaText(page, scenario.empty ? '"BreadcrumbList"' : '"ItemList"');
    if (scenario.empty) await expectSchemaText(page, '"ItemList"', true);
    if (scenario.heading) await expect(page.getByRole("heading", { level: 1, name: scenario.heading, exact: true })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://lumera.example${scenario.canonical}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  }
  await navigate(page, "/unsupported-seo-route");
  await expect(page.locator(managed)).toHaveCount(0);
  await navigate(page, "/saloni/seo-missing");
  await expect(page.getByText("Salon nije pronađen.", { exact: true })).toBeVisible();
  await expect(page.locator(managed)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { seoDocumentMarker: string }).seoDocumentMarker)).toBe("same-document");
  expect(requests.get("/api/salons/seo-a")).toBe(1);
  expect(requests.get("/api/salons/seo-b")).toBe(1);
  expect(requests.get(`/api/education/public/courses/${courseId}`)).toBe(1);
  expect(requests.get("/api/salons/seo-missing")).toBe(1);
  expect(errors).toEqual([]);
});