import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeoResponse } from './seo-server.mjs';
import categoryDefinitions from './src/lib/public-category-pages.json' with { type: 'json' };

const template = '<!doctype html><html><head><title>Placeholder</title><meta name="description" content="placeholder"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';

function request(pathname) {
  return { url: pathname, headers: { host: 'lumera.example', 'x-forwarded-proto': 'https' } };
}

test('shared category definitions use unique route, slug, and API mappings', () => {
  const requiredFields = ['slug', 'path', 'apiCategory', 'label', 'h1', 'title', 'description', 'intro'];
  const mappedValues = ['slug', 'path', 'apiCategory'];

  for (const category of categoryDefinitions) {
    for (const field of requiredFields) {
      assert.equal(typeof category[field], 'string', `${field} must be a string`);
      assert.notEqual(category[field].trim(), '', `${field} must not be empty`);
    }
  }

  for (const field of mappedValues) {
    const values = categoryDefinitions.map((category) => category[field]);
    assert.equal(new Set(values).size, values.length, `category ${field} values must be unique`);
  }
});

test('static public page has unique server metadata and meaningful content', async () => {
  const response = await createSeoResponse(request('/uslovi-koriscenja'), template);
  assert.equal(response.status, 200);
  assert.match(response.body, /<title>Uslovi korišćenja \| LUMERA<\/title>/);
  assert.match(response.body, /rel="canonical" href="https:\/\/lumera\.example\/uslovi-koriscenja"/);
  assert.match(response.body, /<h1>Uslovi korišćenja<\/h1>/);
  assert.doesNotMatch(response.body, /Placeholder/);
});

test('robots links the canonical sitemap and blocks private areas', async () => {
  const response = await createSeoResponse(request('/robots.txt'), template);
  assert.equal(response.status, 200);
  assert.match(response.body, /Sitemap: https:\/\/lumera\.example\/sitemap\.xml/);
  assert.match(response.body, /Disallow: \/admin\//);
  assert.match(response.body, /Disallow: \/widget\//);
});

test('a pinned public origin cannot be replaced by forwarded host headers', async () => {
  const previousOrigin = process.env.LUMERA_PUBLIC_URL;
  process.env.LUMERA_PUBLIC_URL = 'https://beauty-partner-hub.replit.app';
  try {
    const response = await createSeoResponse({
      url: '/uslovi-koriscenja',
      headers: { host: 'attacker.example', 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'http' },
    }, template);
    assert.match(response.body, /href="https:\/\/beauty-partner-hub\.replit\.app\/uslovi-koriscenja"/);
    assert.doesNotMatch(response.body, /attacker\.example/);
  } finally {
    if (previousOrigin === undefined) delete process.env.LUMERA_PUBLIC_URL;
    else process.env.LUMERA_PUBLIC_URL = previousOrigin;
  }
});

test('query variants and protected routes are never indexable', async () => {
  const queryResponse = await createSeoResponse(request('/saloni?city=Beograd'), template);
  const shopQueryResponse = await createSeoResponse(request('/shop/aurora?brand=Lumera&sort=PRICE_ASC&page=2'), template);
  const productQueryResponse = await createSeoResponse(request('/shop/aurora/proizvod/p1?ref=campaign'), template);
  const privateResponse = await createSeoResponse(request('/vlasnik/kontrolna-tabla'), template);
  assert.match(queryResponse.body, /name="robots" content="noindex, follow"/);
  assert.match(queryResponse.body, /rel="canonical" href="https:\/\/lumera\.example\/saloni"/);
  assert.match(shopQueryResponse.body, /name="robots" content="noindex, follow"/);
  assert.match(shopQueryResponse.body, /rel="canonical" href="https:\/\/lumera\.example\/shop\/aurora"/);
  assert.match(productQueryResponse.body, /name="robots" content="noindex, follow"/);
  assert.match(productQueryResponse.body, /rel="canonical" href="https:\/\/lumera\.example\/shop\/aurora\/proizvod\/p1"/);
  assert.match(privateResponse.body, /name="robots" content="noindex, follow"/);
  assert.doesNotMatch(privateResponse.body, /rel="canonical"/);
  assert.doesNotMatch(privateResponse.body, /<meta property="og:title"/);
});

test('public content is outside the React root for safe client takeover', async () => {
  const response = await createSeoResponse(request('/recnik'), template);
  assert.match(response.body, /id="seo-prerender"/);
  assert.match(response.body, /<div id="root"><\/div>/);
  assert.match(response.body, /html\[data-app-ready="true"\] #seo-prerender\{display:none\}/);
});

test('category pages use the real catalog filter and have unique SEO metadata', async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify([{
      slug: 'studio-kosa',
      name: 'Studio Kosa',
      shortDescription: 'Frizerski salon u Beogradu.',
      imageUrl: '',
      city: 'Beograd',
      rating: 4.9,
      reviewCount: 12,
    }]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await createSeoResponse(request('/saloni/kategorija/frizerski-saloni'), template);
    assert.equal(response.status, 200);
    assert.match(response.body, /<title>Frizerski saloni u Srbiji \| LUMERA<\/title>/);
    assert.match(response.body, /rel="canonical" href="https:\/\/lumera\.example\/saloni\/kategorija\/frizerski-saloni"/);
    assert.match(response.body, /<h1>Frizerski saloni u Srbiji<\/h1>/);
    assert.match(response.body, /Studio Kosa/);
    assert.match(decodeURIComponent(requestedUrl), /\/api\/salons\?category=Frizerski saloni&page=1&pageSize=24/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('every shared category definition renders its API filter and SEO fields', async () => {
  const previousFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    for (const category of categoryDefinitions) {
      const response = await createSeoResponse(request(`/saloni/kategorija/${category.slug}`), template);
      assert.equal(response.status, 200);
      assert.match(response.body, new RegExp(`<title>${category.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/title>`));
      assert.match(response.body, new RegExp(`<h1>${category.h1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/h1>`));
      assert.match(response.body, new RegExp(`rel="canonical" href="https:\\/\\/lumera\\.example${category.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
      assert.match(response.body, new RegExp(category.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.ok(requestedUrls.some((url) => decodeURIComponent(url).includes(`/api/salons?category=${category.apiCategory}&page=1&pageSize=24`)));
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('category pages are included in the canonical sitemap', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const response = await createSeoResponse(request('/sitemap.xml'), template);
    assert.equal(response.status, 200);
    for (const category of categoryDefinitions) {
      assert.match(response.body, new RegExp(`https:\\/\\/lumera\\.example${category.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Lumera Biznis audience pages render unique SSR metadata and enter the sitemap', async () => {
  const pages = [
    ['/za-biznise', 'LUMERA Biznis Hub', 'LUMERA Biznis Hub'],
    ['/za-biznise/saloni', 'LUMERA za salone', 'LUMERA za salone'],
    ['/za-biznise/edukativni-centri', 'LUMERA za edukativne centre', 'LUMERA za edukativne centre'],
    ['/za-biznise/poslovi', 'LUMERA Poslovi za biznise', 'LUMERA Poslovi za biznise'],
    ['/za-biznise/edukacije', 'LUMERA Edukacije za biznise', 'LUMERA Edukacije za biznise'],
  ];
  for (const [pathname, title, heading] of pages) {
    const response = await createSeoResponse(request(pathname), template);
    assert.equal(response.status, 200);
    assert.match(response.body, new RegExp(`<title>${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(response.body, new RegExp(`<h1>${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/h1>`));
    assert.match(response.body, new RegExp(`rel="canonical" href="https:\\/\\/lumera\\.example${pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }

  const sitemap = await createSeoResponse(request('/sitemap.xml'), template);
  for (const [pathname] of pages) {
    assert.match(sitemap.body, new RegExp(`https:\\/\\/lumera\\.example${pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
});

test('education-center registration is SSR-rendered but excluded from indexing and sitemap', async () => {
  const registration = await createSeoResponse(request('/pridruzi-se-edukativni-centar'), template);
  const sitemap = await createSeoResponse(request('/sitemap.xml'), template);
  const robots = await createSeoResponse(request('/robots.txt'), template);
  assert.equal(registration.status, 200);
  assert.match(registration.body, /<meta name="robots" content="noindex, follow"/);
  assert.match(registration.body, /rel="canonical" href="https:\/\/lumera\.example\/pridruzi-se-edukativni-centar"/);
  assert.doesNotMatch(sitemap.body, /pridruzi-se-edukativni-centar/);
  assert.match(robots.body, /Disallow: \/pridruzi-se-/);
});

test('education-center registration stays excluded from the sitemap during upstream outages', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('upstream unavailable'); };
  try {
    const sitemap = await createSeoResponse(request('/sitemap.xml'), template);
    assert.equal(sitemap.status, 503);
    assert.doesNotMatch(sitemap.body, /pridruzi-se-edukativni-centar/);
    assert.match(sitemap.body, /https:\/\/lumera\.example\/za-biznise\/edukativni-centri/);
  } finally {
    global.fetch = originalFetch;
  }
});

function supplierCatalogFetch(fixtures) {
  return async (input) => {
    const url = new URL(input);
    const key = `${url.pathname}${url.search}`;
    const value = fixtures[key] ?? fixtures[url.pathname];
    if (value === undefined) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('/proizvodi lists only active B2C suppliers instead of legacy mixed products', async () => {
  const originalFetch = global.fetch;
  global.fetch = supplierCatalogFetch({
    '/api/suppliers': [
      { id: 's1', slug: 'aurora', name: 'Aurora Beauty', scope: 'B2C', active: true, logoUrl: '/aurora.jpg' },
      { id: 's2', slug: 'pro-only', name: 'Pro Only', scope: 'B2B', active: true, logoUrl: null },
      { id: 's3', slug: 'inactive', name: 'Inactive Retail', scope: 'BOTH', active: false, logoUrl: null },
    ],
  });
  try {
    const listing = await createSeoResponse(request('/proizvodi'), template);
    assert.equal(listing.status, 200);
    assert.match(listing.body, /<h1>Beauty proizvodi za kupce<\/h1>/);
    assert.match(listing.body, /href="\/shop\/aurora"/);
    assert.match(listing.body, /Aurora Beauty/);
    assert.doesNotMatch(listing.body, /Pro Only|Inactive Retail|\/api\/shop\/public\/products/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('supplier shop and arbitrary-depth category render canonical metadata, breadcrumbs, and qualified links', async () => {
  const originalFetch = global.fetch;
  const supplier = { id: 's1', slug: 'aurora', name: 'Aurora Beauty', scope: 'BOTH', active: true, logoUrl: '/aurora.jpg' };
  const categories = [
    { id: 'c1', name: 'Nega', path: 'nega', parentId: null, active: true },
    { id: 'c2', name: 'Lice', path: 'nega/lice', parentId: 'c1', active: true },
    { id: 'c3', name: 'Profesionalna nega', path: 'nega/lice/profesionalna', parentId: 'c2', active: true },
  ];
  const product = { id: 'p1', supplierId: 's1', name: 'Serum Aurora', category: 'Nega', description: 'Javni opis seruma.', imageUrl: '/serum.jpg', images: [], price: 2400, discountPrice: null };
  const requested = [];
  global.fetch = async (input) => {
    requested.push(decodeURIComponent(String(input)));
    return supplierCatalogFetch({
      '/api/suppliers/aurora': supplier,
      '/api/suppliers/aurora/categories': categories,
      '/api/suppliers/aurora/public-products': { items: [product], total: 1, page: 1, pageSize: 24, totalPages: 1 },
    })(input);
  };
  try {
    const shop = await createSeoResponse(request('/shop/aurora'), template);
    const category = await createSeoResponse(request('/shop/aurora/nega/lice/profesionalna'), template);
    assert.equal(shop.status, 200);
    assert.match(shop.body, /<title>Aurora Beauty \| Beauty proizvodi<\/title>/);
    assert.match(shop.body, /rel="canonical" href="https:\/\/lumera\.example\/shop\/aurora"/);
    assert.match(shop.body, /<h1>Aurora Beauty<\/h1>/);
    assert.match(shop.body, /"@type":"ItemList"/);
    assert.match(shop.body, /"@type":"BreadcrumbList"/);
    assert.match(shop.body, /href="\/shop\/aurora\/proizvod\/p1"/);
    assert.equal(category.status, 200);
    assert.match(category.body, /<title>Profesionalna nega \| Aurora Beauty<\/title>/);
    assert.match(category.body, /rel="canonical" href="https:\/\/lumera\.example\/shop\/aurora\/nega\/lice\/profesionalna"/);
    assert.match(category.body, /<h1>Profesionalna nega — Aurora Beauty<\/h1>/);
    assert.match(category.body, /href="\/shop\/aurora\/nega\/lice"/);
    assert.ok(requested.some((url) => url.includes('/api/suppliers/aurora/public-products?page=1&pageSize=24&categoryId=c3')));
  } finally {
    global.fetch = originalFetch;
  }
});

test('unknown, inactive, non-retail suppliers and unknown category paths use normal not-found behavior', async () => {
  const originalFetch = global.fetch;
  const inactive = { id: 's2', slug: 'inactive', name: 'Inactive', scope: 'B2C', active: false };
  global.fetch = supplierCatalogFetch({
    '/api/suppliers/inactive': inactive,
    '/api/suppliers/inactive/categories': [],
    '/api/suppliers/aurora': { id: 's1', slug: 'aurora', name: 'Aurora', scope: 'B2C', active: true },
    '/api/suppliers/aurora/categories': [{ id: 'c1', name: 'Nega', path: 'nega', active: true }],
  });
  try {
    assert.equal((await createSeoResponse(request('/shop/nepoznat'), template)).status, 404);
    assert.equal((await createSeoResponse(request('/shop/inactive'), template)).status, 404);
    assert.equal((await createSeoResponse(request('/shop/aurora/nega/nepostojeca'), template)).status, 404);
  } finally {
    global.fetch = originalFetch;
  }
});

test('supplier-qualified product uses only public B2C DTO fields in Product and Offer schema', async () => {
  const originalFetch = global.fetch;
  const supplier = { id: 's1', slug: 'aurora', name: 'Aurora Beauty', scope: 'B2C', active: true };
  const product = {
    id: 'p1', supplierId: 's1', name: 'Javni serum', category: 'Nega', brand: 'Aurora',
    description: 'Opis namenjen kupcima.', imageUrl: '/serum.jpg', images: ['/serum.jpg'],
    price: 2499, discountPrice: 1999, unit: 'kom', isNew: true, isBestseller: false,
    sku: 'B2B-SKU-PRIVATE', stock: 999, wholesalePrice: 700,
    internalDescription: 'Interni privatni opis koji ne sme biti renderovan.',
  };
  global.fetch = supplierCatalogFetch({
    '/api/suppliers/aurora': supplier,
    '/api/suppliers/aurora/public-products/p1': product,
  });
  try {
    const detail = await createSeoResponse(request('/shop/aurora/proizvod/p1'), template);
    assert.equal(detail.status, 200);
    assert.match(detail.body, /<title>Javni serum \| Aurora Beauty<\/title>/);
    assert.match(detail.body, /rel="canonical" href="https:\/\/lumera\.example\/shop\/aurora\/proizvod\/p1"/);
    assert.match(detail.body, /"@type":"Product"/);
    assert.match(detail.body, /"@type":"Offer"/);
    assert.match(detail.body, /"price":"1999"/);
    assert.doesNotMatch(detail.body, /B2B-SKU-PRIVATE|Interni privatni opis|wholesalePrice|"stock"/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('sitemap contains only active retail supplier, category, and supplier-qualified product URLs', async () => {
  const originalFetch = global.fetch;
  const active = { id: 's1', slug: 'aurora', name: 'Aurora', scope: 'B2C', active: true };
  const fixtures = {
    '/api/suppliers': [active, { id: 's2', slug: 'pro', name: 'Pro', scope: 'B2B', active: true }, { id: 's3', slug: 'off', name: 'Off', scope: 'BOTH', active: false }],
    '/api/salons': [],
    '/api/education/public/courses': [],
    '/api/beauty-jobs': [],
    '/api/suppliers/aurora/categories': [{ id: 'c3', name: 'Duboka', path: 'nega/lice/duboka', active: true }, { id: 'off-c', name: 'Skrivena', path: 'skrivena', active: false }],
    '/api/suppliers/aurora/public-products': { items: [{ id: 'p1' }], total: 1, page: 1, pageSize: 100, totalPages: 1 },
  };
  global.fetch = supplierCatalogFetch(fixtures);
  try {
    const sitemap = await createSeoResponse(request('/sitemap.xml'), template);
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.body, /https:\/\/lumera\.example\/shop\/aurora<\/loc>/);
    assert.match(sitemap.body, /https:\/\/lumera\.example\/shop\/aurora\/nega\/lice\/duboka/);
    assert.match(sitemap.body, /https:\/\/lumera\.example\/shop\/aurora\/proizvod\/p1/);
    assert.doesNotMatch(sitemap.body, /\/shop\/(?:pro|off|aurora\/skrivena)|\/proizvodi\/p1/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('legacy product URL permanently redirects by supplier ID or returns not found', async () => {
  const originalFetch = global.fetch;
  global.fetch = supplierCatalogFetch({
    '/api/shop/public/products/p1': { id: 'p1', supplierId: 's1', name: 'Serum' },
    '/api/shop/public/products/orphan': { id: 'orphan', supplierId: 'missing', name: 'Orphan' },
    '/api/suppliers': [{ id: 's1', slug: 'aurora', name: 'Aurora', scope: 'BOTH', active: true }],
  });
  try {
    const redirect = await createSeoResponse(request('/proizvodi/p1'), template);
    const unavailable = await createSeoResponse(request('/proizvodi/orphan'), template);
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.location, '/shop/aurora/proizvod/p1');
    assert.equal(unavailable.status, 404);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Beauty Poslovi index, detail metadata and sitemap use only public data', async () => {
  const originalFetch = global.fetch;
  const job = {
    id: '8e75f170-bf62-4587-a80f-f9cd385f75d2',
    slug: 'potreban-frizer',
    type: 'job',
    intent: 'offering',
    title: 'Potreban frizer u Beogradu',
    description: 'Tražimo pouzdanu osobu za rad u modernom salonu.',
    city: 'Beograd',
    region: 'Vračar',
    authorDisplayName: 'Studio Kosa',
    photos: [],
    priceAmount: 80000,
    pricePeriod: 'month',
    negotiable: false,
    availabilityPattern: null,
    createdAt: '2026-08-24T10:00:00.000Z',
    updatedAt: '2026-08-24T11:00:00.000Z',
    expiresAt: '2026-09-23T10:00:00.000Z',
    privateApplicantEmail: 'private@example.test',
  };
  global.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    const body = pathname === '/api/beauty-jobs'
      ? { items: [job], total: 1, page: 1, pageSize: 24 }
      : pathname === `/api/beauty-jobs/${job.id}`
        ? job
        : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const listing = await createSeoResponse(request('/poslovi'), template);
    const detail = await createSeoResponse(request(`/poslovi/${job.slug}/${job.id}`), template);
    const wrongSlug = await createSeoResponse(request(`/poslovi/pogresan-slug/${job.id}`), template);
    const sitemap = await createSeoResponse(request('/sitemap.xml'), template);
    assert.equal(listing.status, 200);
    assert.match(listing.body, /<h1>Beauty poslovi, angažmani i iznajmljivanje<\/h1>/);
    assert.match(listing.body, /Potreban frizer u Beogradu/);
    assert.match(detail.body, /<title>Potreban frizer u Beogradu \| LUMERA Poslovi<\/title>/);
    assert.match(detail.body, /"@type":"JobPosting"/);
    assert.doesNotMatch(detail.body, /private@example\.test/);
    assert.match(wrongSlug.body, new RegExp(`rel="canonical" href="https://lumera\\.example/poslovi/${job.slug}/${job.id}"`));
    assert.match(sitemap.body, new RegExp(`https://lumera\\.example/poslovi/${job.slug}/${job.id}`));
  } finally {
    global.fetch = originalFetch;
  }
});

test('legacy Beauty Poslovi public URLs permanently redirect to canonical routes', async () => {
  const originalFetch = global.fetch;
  const job = {
    id: 'a8e75f170-bf62-4587-a80f-f9cd385f75d2',
    title: 'Potreban barber',
    type: 'job',
    intent: 'offering',
  };
  global.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    return new Response(JSON.stringify(pathname === `/api/beauty-jobs/${job.id}` ? job : []), {
      status: pathname === `/api/beauty-jobs/${job.id}` ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const catalog = await createSeoResponse(request('/beauty-poslovi?category=barberi'), template);
    const detail = await createSeoResponse(request(`/beauty-poslovi/${job.id}`), template);
    assert.equal(catalog.status, 308);
    assert.equal(catalog.headers.location, '/poslovi?category=barberi');
    assert.equal(detail.status, 308);
    assert.equal(detail.headers.location, `/poslovi/potreban-barber/${job.id}`);
  } finally {
    global.fetch = originalFetch;
  }
});
test('Education taxonomy pages render canonical metadata, breadcrumbs, and are in sitemap', async () => {
  const originalFetch = global.fetch;
  const taxonomy = [{
    id: "s1", name: "Frizerske obuke", slug: "frizerske-obuke",
    categories: [{
      id: "c1", name: "Ženske frizure", slug: "zenske-frizure",
      subcategories: [{ id: "sc1", name: "Balayage", slug: "balayage" }]
    }]
  }];
  const courses = [{ id: "course1", title: "Master Balayage", publisher: "Studio" }];
  const courseFilters = [];

  global.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/api/education/public/taxonomy') {
      return new Response(JSON.stringify(taxonomy), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/api/education/public/courses') {
      courseFilters.push({
        sectionId: url.searchParams.get('sectionId'),
        categoryId: url.searchParams.get('categoryId'),
        subcategoryId: url.searchParams.get('subcategoryId'),
      });
      return new Response(JSON.stringify(courses), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/api/salons' || url.pathname === '/api/suppliers' || url.pathname === '/api/beauty-jobs') {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const sitemap = await createSeoResponse(request('/sitemap.xml'), template);
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.body, /https:\/\/lumera\.example\/edukacije\/sekcije\/frizerske-obuke/);
    assert.match(sitemap.body, /https:\/\/lumera\.example\/edukacije\/sekcije\/frizerske-obuke\/zenske-frizure/);
    assert.match(sitemap.body, /https:\/\/lumera\.example\/edukacije\/sekcije\/frizerske-obuke\/zenske-frizure\/balayage/);

    courseFilters.length = 0;
    const sectionResp = await createSeoResponse(request('/edukacije/sekcije/frizerske-obuke'), template);
    assert.equal(sectionResp.status, 200);
    assert.match(sectionResp.body, /<title>Frizerske obuke \| Edukacije \| LUMERA<\/title>/);
    assert.match(sectionResp.body, /rel="canonical" href="https:\/\/lumera\.example\/edukacije\/sekcije\/frizerske-obuke"/);
    assert.match(sectionResp.body, /Master Balayage/);
    assert.match(sectionResp.body, /href="\/edukacije\/course1"/);
    assert.deepEqual(courseFilters, [{ sectionId: 's1', categoryId: null, subcategoryId: null }]);

    courseFilters.length = 0;
    const categoryResp = await createSeoResponse(request('/edukacije/sekcije/frizerske-obuke/zenske-frizure'), template);
    assert.equal(categoryResp.status, 200);
    assert.match(categoryResp.body, /<title>Ženske frizure \| Edukacije \| LUMERA<\/title>/);
    assert.match(categoryResp.body, /rel="canonical" href="https:\/\/lumera\.example\/edukacije\/sekcije\/frizerske-obuke\/zenske-frizure"/);
    assert.match(categoryResp.body, /Master Balayage/);
    assert.match(categoryResp.body, /href="\/edukacije\/course1"/);
    assert.deepEqual(courseFilters, [{ sectionId: null, categoryId: 'c1', subcategoryId: null }]);

    courseFilters.length = 0;
    const subcategoryResp = await createSeoResponse(request('/edukacije/sekcije/frizerske-obuke/zenske-frizure/balayage'), template);
    assert.equal(subcategoryResp.status, 200);
    assert.match(subcategoryResp.body, /<title>Balayage \| Edukacije \| LUMERA<\/title>/);
    assert.match(subcategoryResp.body, /rel="canonical" href="https:\/\/lumera\.example\/edukacije\/sekcije\/frizerske-obuke\/zenske-frizure\/balayage"/);
    assert.match(subcategoryResp.body, /Master Balayage/);
    assert.match(subcategoryResp.body, /href="\/edukacije\/course1"/);
    assert.deepEqual(courseFilters, [{ sectionId: null, categoryId: null, subcategoryId: 'sc1' }]);

    const invalidCategory = await createSeoResponse(request('/edukacije/sekcije/frizerske-obuke/nepostojeca-kategorija'), template);
    const invalidSubcategory = await createSeoResponse(request('/edukacije/sekcije/frizerske-obuke/zenske-frizure/nepostojeca-potkategorija'), template);
    assert.equal(invalidCategory.status, 404);
    assert.equal(invalidSubcategory.status, 404);
  } finally {
    global.fetch = originalFetch;
  }
});
