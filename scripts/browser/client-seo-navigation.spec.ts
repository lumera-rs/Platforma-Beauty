import { expect, test, type Page, type Request } from "@playwright/test";

const courseId = "00000000-0000-4000-8000-000000000003";
const managed = 'script[data-lumera-structured-data="current-page"]';
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
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.set(path, (requests.get(path) ?? 0) + 1);
    let body: unknown = [];
    let status = 200;
    if (path === "/api/salons/seo-a") body = salon("SEO Salon A", "seo-a");
    else if (path === "/api/salons/seo-b") body = salon("SEO Salon B", "seo-b");
    else if (path === "/api/salons") {
      listingRequests.push(route.request().url());
      const params = new URL(route.request().url()).searchParams;
      body = Number(params.get("page")) > 2 ? [] : params.get("page") === "2"
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
  await page.goto("/saloni/seo-a");
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
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("link", { name: "Sledeća", exact: true })).toHaveCount(0);
  await navigate(page, "/saloni?city=Beograd&page=1");
  await expect(page.locator(managed)).toHaveCount(1);
  await expectSchemaText(page, '"ItemList"');
  await expectSchemaText(page, "SEO List 1");
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
  // The generated visible hook consumes AbortSignal. Leaving its route can
  // legitimately abort HTTP rather than produce a response event.
  const slowSettled = new Promise<void>((resolve) => {
    const settled = (request: Request) => {
      if (new URL(request.url()).pathname !== "/api/salons/seo-slow") return;
      page.off("requestfinished", settled);
      page.off("requestfailed", settled);
      resolve();
    };
    page.on("requestfinished", settled);
    page.on("requestfailed", settled);
  });
  const slowRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/salons/seo-slow");
  await navigate(page, "/saloni/seo-slow");
  await slowRequest;
  await expect(page.locator(managed)).toHaveCount(0);
  await navigate(page, "/unsupported-seo-route");
  await expect(page).toHaveURL(/unsupported-seo-route$/);
  await expect(page.locator(managed)).toHaveCount(0);
  releaseSlowResponse();
  await Promise.all([slowSettled, slowFixtureComplete]);
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