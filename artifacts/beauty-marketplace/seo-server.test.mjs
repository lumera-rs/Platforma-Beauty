import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createSeoResponse } from './seo-server.mjs';
import categoryDefinitions from './src/lib/public-category-pages.json' with { type: 'json' };
import './seo-policy.test.mjs';
import { cityLocative, cityPhrase, publicImageAlt } from './seo-text.mjs';
import { buildPageStructuredData, validPrice, publicReviews, publicJobDate } from './structured-data.mjs';
import { listingCanonical, listingIndexable } from './seo-policy.mjs';

// Content regressions run under the staging noindex policy.
process.env.PUBLIC_SITE_URL = 'https://lumera.example';
delete process.env.SITE_INDEXABLE;
const template = '<!doctype html><html><head><title>Placeholder</title><meta name="description" content="placeholder"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';
const indexSource = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('./src/index.css', import.meta.url), 'utf8');
const homeSource = readFileSync(new URL('./src/pages/home.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('./src/App.tsx', import.meta.url), 'utf8');

function request(pathname) {
  return { url: pathname, headers: { host: 'lumera.example', 'x-forwarded-proto': 'https' } };
}

test('part 2 shared schema gates reject invalid Google inputs without inventing data', () => {
  assert.equal(cityLocative('Beograd'), 'Beogradu');
  assert.equal(cityPhrase('Novi Sad'), 'u Novom Sadu');
  assert.equal(cityPhrase('Nepoznat grad'), 'Nepoznat grad');
  assert.equal(cityLocative('Nepoznat grad'), null);
  assert.equal(publicImageAlt({ name: 'Salon', category: 'Nega lica', city: 'Niš', description: 'Pristupačan ulaz' }), 'Salon — Nega lica — u Nišu — Pristupačan ulaz');
  const options = { origin: 'https://lumera.example', canonical: '/poslovi/frizer/1' };
  const job = { type: 'job', intent: 'offering', title: 'Frizer', description: 'Rad u salonu.', authorDisplayName: 'Salon', city: 'Niš', createdAt: '2026-09-20T10:00:00Z' };
  assert.equal(buildPageStructuredData('job', job, options).datePosted, job.createdAt);
  for (const key of ['title', 'description', 'authorDisplayName', 'city', 'createdAt']) assert.equal(buildPageStructuredData('job', { ...job, [key]: '' }, options), null);
  for (const createdAt of ['not-a-date', '2026-02-30', '2026-13-01']) assert.equal(buildPageStructuredData('job', { ...job, createdAt }, options), null);
  for (const price of [null, undefined, '', '20', -1, NaN, Infinity]) {
    assert.equal(validPrice(price), false);
    assert.equal(buildPageStructuredData('product', { name: 'Serum', imageUrl: '/serum.jpg', price }, options), null);
  }
  assert.equal(buildPageStructuredData('product', { name: 'Serum', imageUrl: '/serum.jpg', price: 0 }, options).offers.price, 0);
  assert.equal(buildPageStructuredData('bundle', { name: 'Obuka', price: 100 }, options), null);
  const reviews = Array.from({ length: 7 }, (_, i) => ({ authorName: 'Javni autor', rating: 5, text: `Iskustvo ${i}`, date: `2026-09-${String(i + 1).padStart(2, '0')}` }));
  assert.deepEqual(publicReviews({ reviews }).map(item => item.date), ['2026-09-07', '2026-09-06', '2026-09-05', '2026-09-04', '2026-09-03']);
  assert.equal(listingCanonical('/saloni', '?city=Novi+Sad&page=2'), '/saloni?city=Novi+Sad&page=2');
  assert.equal(listingCanonical('/saloni', '?city=Novi+Sad'), '/saloni?city=Novi+Sad');
  assert.equal(listingCanonical('/saloni', '?city=Novi+Sad&page=1'), '/saloni?city=Novi+Sad');
  assert.equal(listingCanonical('/saloni', '?page=1'), '/saloni');
  assert.equal(listingCanonical('/saloni', '?page=2'), '/saloni?page=2');
  assert.equal(listingCanonical('/saloni', '?city=Novi+Sad&category=Lice&page=2'), '/saloni?city=Novi+Sad');
  assert.equal(listingCanonical('/saloni', '?category=Lice&page=2'), '/saloni');
  for (const search of ['', '?page=1', '?page=2', '?city=Novi+Sad', '?city=Novi+Sad&page=1', '?city=Novi+Sad&page=2']) {
    assert.equal(listingIndexable('/saloni', search), true, `${search || '(plain)'} is an eligible canonical family member`);
  }
  for (const search of ['?category=Lice', '?city=Novi+Sad&category=Lice', '?city=Novi+Sad&page=2&sort=rating']) {
    assert.equal(listingIndexable('/saloni', search), false, `${search} must use a nearest indexable parent`);
  }
  assert.equal(listingIndexable('/edukacije', '?page=2'), false);
});

test('city listing canonical, title, heading and empty-result policy cover every owner case', async () => {
  const originalFetch = global.fetch;
  const activeSalon = { id: 'city-salon', slug: 'city-salon', name: 'Gradski salon', city: 'Beograd' };
  let emptyCity = false;
  global.fetch = async input => {
    const url = new URL(input);
    if (url.pathname !== '/api/salons') return new Response('{}', { status: 404 });
    const city = url.searchParams.get('city');
    return new Response(JSON.stringify(city === 'Niš' || emptyCity ? [] : [activeSalon]), { status: 200 });
  };
  const cases = [
    { route: '/saloni', canonical: '/saloni', title: 'Saloni i beauty tretmani | LUMERA', heading: 'Pronađite salon i tretman koji vam odgovaraju.' },
    { route: '/saloni?page=1', canonical: '/saloni', title: 'Saloni i beauty tretmani | LUMERA', heading: 'Pronađite salon i tretman koji vam odgovaraju.' },
    { route: '/saloni?page=2', canonical: '/saloni?page=2', title: 'Saloni i beauty tretmani | LUMERA', heading: 'Pronađite salon i tretman koji vam odgovaraju.' },
    { route: '/saloni?city=Beograd', canonical: '/saloni?city=Beograd', title: 'Saloni u Beogradu | LUMERA', heading: 'Saloni u Beogradu' },
    { route: '/saloni?city=Beograd&page=1', canonical: '/saloni?city=Beograd', title: 'Saloni u Beogradu | LUMERA', heading: 'Saloni u Beogradu' },
    { route: '/saloni?city=Beograd&page=2', canonical: '/saloni?city=Beograd&page=2', title: 'Saloni u Beogradu | LUMERA', heading: 'Saloni u Beogradu' },
    { route: '/saloni?city=Beograd&category=Lice', canonical: '/saloni?city=Beograd', title: 'Saloni u Beogradu | LUMERA', heading: 'Saloni u Beogradu' },
    { route: '/saloni?category=Lice&page=2', canonical: '/saloni', title: 'Saloni i beauty tretmani | LUMERA', heading: 'Pronađite salon i tretman koji vam odgovaraju.' },
    { route: '/saloni?city=Nepoznat+grad', canonical: '/saloni?city=Nepoznat+grad', title: 'Saloni Nepoznat grad | LUMERA', heading: 'Saloni Nepoznat grad' },
    { route: '/saloni?city=Ni%C5%A1', canonical: '/saloni?city=Ni%C5%A1', title: 'Saloni u Nišu | LUMERA', heading: 'Saloni u Nišu' },
  ];
  try {
    for (const scenario of cases) {
      const response = await createSeoResponse(request(scenario.route), template);
      assert.equal(response.status, 200, scenario.route);
      assert.ok(response.body.includes(`<link rel="canonical" href="https://lumera.example${scenario.canonical.replaceAll('&', '&amp;')}">`), scenario.route);
      assert.ok(response.body.includes(`<title>${scenario.title}</title>`), scenario.route);
      assert.ok(response.body.includes(`<h1>${scenario.heading}</h1>`), scenario.route);
      assert.match(response.body, /name="robots" content="noindex, nofollow"/u, `${scenario.route} must remain staging noindex`);
    }
    emptyCity = true;
    const emptyKnownCity = await createSeoResponse(request('/saloni?city=Beograd'), template);
    assert.match(emptyKnownCity.body, /name="robots" content="noindex, nofollow"/u);
    assert.match(emptyKnownCity.body, /rel="canonical" href="https:\/\/lumera\.example\/saloni\?city=Beograd"/u);
  } finally {
    global.fetch = originalFetch;
  }
});

test('part 2 initial HTML contains real pagination, same-city related anchors, and public duration', async () => {
  const originalFetch = global.fetch;
  const salon = { id: 'primary', slug: 'primary', name: 'Salon za test sadržaja', city: 'Niš', address: 'Ulica 1', services: [{ category: 'Frizerski saloni', name: 'Šišanje', durationMinutes: 45, price: 0 }], acceptsCards: true };
  const related = Array.from({ length: 8 }, (_, i) => ({ ...salon, id: `related-${i}`, slug: `related-${i}`, name: `Salon ${i}` }));
  const calls = [];
  global.fetch = async input => {
    const url = new URL(input);
    calls.push(url);
    return new Response(JSON.stringify(url.pathname === '/api/salons/primary' ? salon : url.searchParams.get('pageSize') === '9' ? [salon, ...related] : related.slice(0, 6)), { status: 200 });
  };
  try {
    const detail = await createSeoResponse(request('/saloni/primary'), template);
    assert.match(detail.body, /45 min/u);
    assert.match(detail.body, /Plaćanje karticom/u);
    assert.match(detail.body, /href="\/saloni\/kategorija\/frizerski-saloni"/u);
    for (const item of related) assert.ok(detail.body.includes(`href="/saloni/${item.slug}"`));
    assert.match(detail.body, /data-lumera-structured-data="current-page"/u);
    const listing = await createSeoResponse(request('/saloni?city=Ni%C5%A1&page=2'), template);
    assert.match(listing.body, /href="\/saloni\?city=Ni%C5%A1&amp;page=1"/u);
    assert.match(listing.body, /href="\/saloni\?city=Ni%C5%A1&amp;page=3"/u);
    assert.match(listing.body, /rel="canonical" href="https:\/\/lumera.example\/saloni\?city=Ni%C5%A1&amp;page=2"/u);
    assert.match(listing.body, /name="robots" content="noindex, nofollow"/u);
    assert.ok(calls.some(url => url.searchParams.get('page') === '2' && url.searchParams.get('pageSize') === '6'));
  } finally { global.fetch = originalFetch; }
});

test('part 2 managed gallery descriptions use anonymous read-only lookup and retain authored detail', async () => {
  const originalFetch = global.fetch;
  const image = '/api/media/images/11111111-1111-4111-8111-111111111111';
  let lookup = false;
  global.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.pathname === '/api/media/descriptions') {
      lookup = true;
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.cookie, undefined);
      assert.deepEqual(JSON.parse(options.body), { urls: [image] });
      return new Response(JSON.stringify({ items: [{ url: image, altText: 'Pristupačan ulaz sa rampom' }] }), { status: 200 });
    }
    return new Response(JSON.stringify(url.pathname === '/api/salons/galerija'
      ? { slug: 'galerija', name: 'Salon', city: 'Niš', imageUrl: '/cover.jpg', gallery: [image] } : []), { status: 200 });
  };
  try {
    const response = await createSeoResponse(request('/saloni/galerija'), template);
    assert.equal(response.status, 200);
    assert.equal(lookup, true);
    assert.match(response.body, /alt="Salon — u Nišu — Pristupačan ulaz sa rampom"/u);
  } finally { global.fetch = originalFetch; }
});

test('part 2 full last pages never invent a next link and lookahead preserves every filter', async () => {
  const originalFetch = global.fetch;
  const cases = [
    { route: '/saloni?city=Ni%C5%A1&category=Lice&page=2', api: '/api/salons', size: 6, filters: { city: 'Niš', category: 'Lice' } },
    { route: '/saloni/kategorija/frizerski-saloni?city=Beograd&page=2', api: '/api/salons', size: 6, filters: { city: 'Beograd', category: 'Frizerski saloni' } },
    { route: '/edukacije?city=Beograd&format=online&page=2', api: '/api/education/public/courses', size: 24, filters: { city: 'Beograd', format: 'online' } },
    { route: '/poslovi?city=Beograd&type=job&sort=newest&page=2', api: '/api/beauty-jobs', size: 10, filters: { city: 'Beograd', type: 'job', sort: 'newest' } },
  ];
  try {
    for (const scenario of cases) {
      for (const nextExists of [false, true]) {
        const calls = [];
        global.fetch = async input => {
          const url = new URL(input);
          calls.push(url);
          assert.equal(url.pathname, scenario.api);
          for (const [key, value] of Object.entries(scenario.filters)) assert.equal(url.searchParams.get(key), value);
          assert.equal(url.searchParams.get('pageSize'), String(scenario.size));
          const rows = Array.from({ length: scenario.size }, (_, i) => ({ id: `entry-${i}`, slug: `entry-${i}`, name: `Javni salon ${i}`, title: `Javna edukacija ${i}`, city: scenario.filters.city }));
          const items = url.searchParams.get('page') === '2' ? rows : nextExists ? rows.slice(0, 1) : [];
          return new Response(JSON.stringify(scenario.api === '/api/beauty-jobs'
            ? { items, total: scenario.size * 2 + (nextExists ? 1 : 0), page: 2, pageSize: scenario.size }
            : items), { status: 200 });
        };
        const result = await createSeoResponse(request(scenario.route), template);
        assert.equal(result.status, 200);
        assert.equal(result.body.includes('>Sledeća</a>'), nextExists, scenario.route);
        assert.match(result.body, />Prethodna<\/a>/u);
        assert.match(result.body, /name="robots" content="noindex, nofollow"/u);
        const expectedCanonical = listingCanonical(new URL(scenario.route, 'https://lumera.example').pathname, new URL(scenario.route, 'https://lumera.example').search);
        assert.ok(result.body.includes(`rel="canonical" href="https://lumera.example${expectedCanonical.replaceAll('&', '&amp;')}"`));
        assert.equal(calls.length, scenario.api === '/api/beauty-jobs' ? 1 : 2, 'count-bearing DTOs need no probe; array DTOs need one bounded probe');
      }
    }
  } finally { global.fetch = originalFetch; }
});

test('part 2 supplier cards omit missing prices without placeholder currency and keep free zero', async () => {
  const originalFetch = global.fetch;
  global.fetch = supplierCatalogFetch({
    '/api/suppliers/aurora': { id: 's1', slug: 'aurora', name: 'Aurora', scope: 'B2C', active: true },
    '/api/suppliers/aurora/categories': [],
    '/api/suppliers/aurora/public-products': { items: [
      { id: 'p1', name: 'Serum bez navedene cene', imageUrl: '/serum.jpg' },
      { id: 'p2', name: 'Besplatan uzorak', price: 0, imageUrl: '/sample.jpg' },
    ], total: 2, page: 1, pageSize: 24 },
  });
  try {
    const response = await createSeoResponse(request('/shop/aurora'), template);
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.body, /(?:undefined|null|NaN) RSD|Cena na upit/u);
    assert.match(response.body, /<p>0 RSD<\/p>/u);
    assert.doesNotMatch(response.body, /"@type":"Offer"/u);
  } finally { global.fetch = originalFetch; }
});

test('part 2 taxonomy and supplier pagination preserve query filters and prove the last page', async () => {
  const originalFetch = global.fetch;
  try {
    for (const route of ['/edukacije/sekcije/nega?city=Beograd&page=2', '/shop/aurora?search=serum&page=2']) {
      const listingCalls = [];
      global.fetch = async input => {
        const url = new URL(input);
        if (url.pathname === '/api/education/public/taxonomy') return new Response(JSON.stringify([{ id: 's1', slug: 'nega', name: 'Nega', categories: [] }]));
        if (url.pathname === '/api/suppliers/aurora') return new Response(JSON.stringify({ id: 's1', slug: 'aurora', name: 'Aurora', active: true, scope: 'B2C' }));
        if (url.pathname.endsWith('/categories')) return new Response('[]');
        listingCalls.push(url);
        assert.equal(url.searchParams.get('pageSize'), '24');
        const items = Array.from({ length: 24 }, (_, i) => ({ id: `public-${i}`, name: `Serum ${i}`, title: `Edukacija ${i}` }));
        if (route.startsWith('/shop')) {
          assert.equal(url.searchParams.get('search'), 'serum');
          return new Response(JSON.stringify({ items, totalPages: 2, page: 2, pageSize: 24 }));
        }
        assert.equal(url.searchParams.get('city'), 'Beograd');
        assert.equal(url.searchParams.get('sectionId'), 's1');
        return new Response(JSON.stringify(url.searchParams.get('page') === '2' ? items : []));
      };
      const response = await createSeoResponse(request(route), template);
      assert.equal(response.status, 200);
      assert.doesNotMatch(response.body, />Sledeća<\/a>/u);
      assert.match(response.body, />Prethodna<\/a>/u);
      const url = new URL(route, 'https://lumera.example');
      assert.ok(response.body.includes(`rel="canonical" href="https://lumera.example${listingCanonical(url.pathname, url.search).replaceAll('&', '&amp;')}"`));
      assert.equal(listingCalls.length, route.startsWith('/shop') ? 1 : 2);
    }
  } finally { global.fetch = originalFetch; }
});

test('part 2 shared public page builders preserve home, list and static schema contracts', () => {
  const options = { origin: 'https://lumera.example', canonical: '/' };
  const home = buildPageStructuredData('home', { description: 'Javni katalog salona.' }, options);
  assert.deepEqual(home['@graph'].map(item => item['@type']), ['Organization', 'WebSite']);
  assert.equal(home['@graph'][1].description, 'Javni katalog salona.');
  const list = buildPageStructuredData('list', { name: 'Saloni', items: [{ name: 'Salon', pathname: '/saloni/salon' }] }, {
    ...options, canonical: '/saloni?page=2', breadcrumbs: [{ name: 'Saloni', pathname: '/saloni?page=2' }],
  });
  assert.equal(list['@graph'][0]['@type'], 'ItemList');
  assert.equal(list['@graph'][0].itemListElement[0].url, 'https://lumera.example/saloni/salon');
  assert.equal(list['@graph'][1].itemListElement.at(-1).item, 'https://lumera.example/saloni?page=2');
  const legal = buildPageStructuredData('static', { name: 'Privatnost' }, { ...options, canonical: '/politika-privatnosti' });
  assert.equal(legal['@graph'][0]['@type'], 'BreadcrumbList');
  assert.equal(legal['@graph'][0].itemListElement.at(-1).name, 'Privatnost');
});

async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test('direct entry point serves HTTP on the explicit PORT and shuts down cleanly', { timeout: 10_000 }, async (t) => {
  const port = await reservePort();
  const child = spawn(process.execPath, [fileURLToPath(new URL('./seo-server.mjs', import.meta.url))], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });

  const deadline = Date.now() + 5_000;
  let response;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      assert.fail(`SEO server exited before accepting HTTP requests: ${stderr}`);
    }
    try {
      response = await fetch(`http://127.0.0.1:${port}/uslovi-koriscenja`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  assert.ok(response, `SEO server did not accept HTTP requests on PORT=${port}: ${stderr}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Uslovi korišćenja \| LUMERA<\/title>/);

  child.kill('SIGTERM');
  const [exitCode, signal] = await once(child, 'exit');
  assert.equal(exitCode, null);
  assert.equal(signal, 'SIGTERM');
});

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

test('staging robots disallows all crawling', async () => {
  const response = await createSeoResponse(request('/robots.txt'), template);
  assert.equal(response.status, 200);
  assert.equal(response.body, 'User-agent: *\nDisallow: /\n');
});

test('a pinned public origin cannot be replaced by forwarded host headers', async () => {
  const previousOrigin = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = 'https://beauty-partner-hub.replit.app';
  try {
    const response = await createSeoResponse({
      url: '/uslovi-koriscenja',
      headers: { host: 'attacker.example', 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'http' },
    }, template);
    assert.match(response.body, /href="https:\/\/beauty-partner-hub\.replit\.app\/uslovi-koriscenja"/);
    assert.doesNotMatch(response.body, /attacker\.example/);
  } finally {
    if (previousOrigin === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = previousOrigin;
  }
});

test('document and app sources preserve zoom, local Inter, LCP priority, and lazy admin isolation', () => {
  assert.doesNotMatch(indexSource, /(?:maximum-scale|minimum-scale|user-scalable)\s*=/i);
  assert.doesNotMatch(`${indexSource}\n${stylesSource}`, /fonts\.(?:googleapis|gstatic)\.com/i);
  assert.match(stylesSource, /font-family:\s*['"]Inter['"]/);
  assert.match(stylesSource, /font-display:\s*swap/);
  assert.match(stylesSource, /url\(['"]?\/fonts\/inter-latin\.woff2['"]?\)/);
  assert.ok(existsSync(new URL('./public/fonts/inter-latin.woff2', import.meta.url)));
  assert.ok(existsSync(new URL('./public/fonts/inter-latin-ext.woff2', import.meta.url)));
  assert.match(homeSource, /<img[\s\S]*src="\/hero-bg\.jpg"[\s\S]*fetchPriority="high"/);
  assert.doesNotMatch(appSource, /^import\s+.+from\s+['"]\.\/pages\/admin\//m);
  assert.match(appSource, /const Admin[A-Za-z0-9]+\s*=\s*lazy\(\(\)\s*=>\s*import\(['"]\.\/pages\/admin\//);
});

test('filtered query variants and protected routes are never indexable', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('deterministic upstream outage'); };
  try {
    const queryResponse = await createSeoResponse(request('/saloni?city=Beograd'), template);
    const shopQueryResponse = await createSeoResponse(request('/shop/aurora?brand=Lumera&sort=PRICE_ASC&page=2'), template);
    const productQueryResponse = await createSeoResponse(request('/shop/aurora/proizvod/p1?ref=campaign'), template);
    const privateResponse = await createSeoResponse(request('/vlasnik/kontrolna-tabla'), template);
    assert.match(queryResponse.body, /name="robots" content="noindex, nofollow"/);
    assert.match(queryResponse.body, /rel="canonical" href="https:\/\/lumera\.example\/saloni\?city=Beograd"/);
    assert.match(shopQueryResponse.body, /name="robots" content="noindex, nofollow"/);
    assert.match(shopQueryResponse.body, /rel="canonical" href="https:\/\/lumera\.example\/shop\/aurora\?brand=Lumera&amp;page=2&amp;sort=PRICE_ASC"/);
    assert.match(productQueryResponse.body, /name="robots" content="noindex, nofollow"/);
    assert.match(productQueryResponse.body, /rel="canonical" href="https:\/\/lumera\.example\/shop\/aurora\/proizvod\/p1"/);
    assert.match(privateResponse.body, /name="robots" content="noindex, nofollow"/);
    assert.doesNotMatch(privateResponse.body, /rel="canonical"/);
    assert.doesNotMatch(privateResponse.body, /<meta property="og:title"/);
    for (const body of [queryResponse.body, shopQueryResponse.body, productQueryResponse.body]) {
      assert.equal((body.match(/rel="canonical"/g) ?? []).length, 1);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('salon query fallback retains shared canonicals during upstream rejection', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('deterministic upstream outage'); };
  const cases = [
    ['/saloni?page=1', '/saloni'],
    ['/saloni?page=2', '/saloni?page=2'],
    ['/saloni?city=Beograd', '/saloni?city=Beograd'],
    ['/saloni?city=Beograd&page=1', '/saloni?city=Beograd'],
    ['/saloni?city=Beograd&page=2', '/saloni?city=Beograd&page=2'],
    ['/saloni?city=Beograd&category=Lice&page=2', '/saloni?city=Beograd'],
    ['/saloni?category=Lice&page=2', '/saloni'],
  ];
  try {
    for (const [route, canonical] of cases) {
      const response = await createSeoResponse(request(route), template);
      assert.equal(response.status, 200, route);
      assert.match(response.body, /name="robots" content="noindex, nofollow"/u, route);
      assert.ok(response.body.includes(`<link rel="canonical" href="https://lumera.example${canonical.replaceAll('&', '&amp;')}">`), route);
      assert.equal((response.body.match(/rel="canonical"/gu) ?? []).length, 1, route);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('homepage emits Organization, WebSite SearchAction and the real hero preload', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const response = await createSeoResponse(request('/'), template);
    assert.equal(response.status, 200);
    assert.match(response.body, /"@type":"Organization"/);
    assert.match(response.body, /"@type":"WebSite"/);
    assert.match(response.body, /"@type":"SearchAction"/);
    assert.match(response.body, /"urlTemplate":"https:\/\/lumera\.example\/saloni\?category=\{search_term_string\}"/);
    assert.match(response.body, /<link rel="preload" as="image" href="\/hero-bg\.jpg" fetchpriority="high">/);
    assert.equal((response.body.match(/href="\/hero-bg\.jpg"/g) ?? []).length, 1);
    const otherPage = await createSeoResponse(request('/recnik'), template);
    assert.doesNotMatch(otherPage.body, /rel="preload"[^>]+hero-bg\.jpg/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('public education, inspiration, and glossary collections emit list schema', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const pathname = new URL(input).pathname;
    const payload = pathname === '/api/education/public/courses'
      ? [{ id: 'course-1', title: 'Balayage kurs' }]
      : pathname === '/api/inspiracija'
        ? [{ title: 'Letnja kosa', salon: { slug: 'studio-kosa' } }]
        : pathname === '/api/recnik'
          ? [{ term: 'Balayage', definition: 'Tehnika bojenja.' }]
          : [];
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    for (const pathname of ['/edukacije', '/inspiracija', '/recnik']) {
      const response = await createSeoResponse(request(pathname), template);
      assert.equal(response.status, 200);
      assert.match(response.body, /"@type":"ItemList"/);
      assert.match(response.body, /"@type":"ListItem"/);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('public education bundle keeps content and omits Product without displayed image', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname !== '/api/education/bundles/bundle-1') {
      return new Response('{}', { status: 404 });
    }
    return new Response(JSON.stringify({
      id: 'bundle-1',
      name: 'Kompletna nail art obuka',
      description: 'Paket od dva praktična kursa.',
      price: 18900,
      updatedAt: '2026-09-08T12:30:00.000Z',
      courses: [
        { courseId: 'course-1', title: 'Osnove nail arta', duration: '2 dana', description: 'Prvi nivo.' },
        { courseId: 'course-2', title: 'Napredni nail art', duration: '3 dana', description: 'Drugi nivo.' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await createSeoResponse(request('/edukacije/paketi/bundle-1'), template);
    assert.equal(response.status, 200);
    assert.match(response.body, /<title>Kompletna nail art obuka \| LUMERA edukacije<\/title>/);
    assert.match(response.body, /rel="canonical" href="https:\/\/lumera\.example\/edukacije\/paketi\/bundle-1"/);
    assert.match(response.body, /name="robots" content="noindex, nofollow"/);
    assert.doesNotMatch(response.body, /"@type":"Product"/);
    assert.doesNotMatch(response.body, /"@type":"Offer"/);
    assert.match(response.body, /href="\/edukacije\/course-1"/);
    const queryResponse = await createSeoResponse(request('/edukacije/paketi/bundle-1?ref=kampanja'), template);
    assert.match(queryResponse.body, /rel="canonical" href="https:\/\/lumera\.example\/edukacije\/paketi\/bundle-1"/);
    assert.match(queryResponse.body, /name="robots" content="noindex, nofollow"/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('education center and instructor detail pages expose entity schema and absolute images', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = new URL(input);
    const payload = url.pathname === '/api/education/public/centers/center-1'
      ? { name: 'Akademija LUMERA', description: 'Centar za stručne edukacije.', imageUrl: '/center.jpg', courses: [] }
      : url.pathname === '/api/education/instructors/instructor-1/public'
        ? { name: 'Ana Edukator', biography: 'Licencirani edukator.', photoUrl: '/ana.jpg', courses: [] }
        : null;
    return new Response(JSON.stringify(payload), {
      status: payload ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const center = await createSeoResponse(request('/edukacije/centri/center-1'), template);
    const instructor = await createSeoResponse(request('/edukacije/instruktori/instructor-1'), template);
    assert.match(center.body, /"@type":"EducationalOrganization"/);
    assert.match(center.body, /"image":"https:\/\/lumera\.example\/center\.jpg"/);
    assert.match(center.body, /property="og:image" content="https:\/\/lumera\.example\/center\.jpg"/);
    assert.match(instructor.body, /"@type":"Person"/);
    assert.match(instructor.body, /"image":"https:\/\/lumera\.example\/ana\.jpg"/);
    assert.match(instructor.body, /property="og:image" content="https:\/\/lumera\.example\/ana\.jpg"/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('server metadata publishes verified social image values without guessing legacy dimensions or MIME', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = new URL(input);
    const payload = url.pathname === '/api/salons/managed'
      ? {
          name: 'Managed salon',
          city: 'Beograd',
          description: 'Salon sa upravljanom slikom.',
          imageUrl: '/legacy.jpg',
          gallery: ['/legacy.jpg'],
          socialImage: {
            url: '/api/media/images/00000000-0000-4000-8000-000000000001?size=large&format=fallback',
            width: 1920,
            height: 1280,
            type: 'image/png',
          },
          services: [],
        }
      : url.pathname === '/api/salons/legacy'
        ? {
            name: 'Legacy salon',
            city: 'Beograd',
            description: 'Salon sa legacy slikom.',
            imageUrl: 'https://legacy.example/photo.jpg',
            gallery: [],
            services: [],
          }
        : null;
    return new Response(JSON.stringify(payload), {
      status: payload ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const managed = await createSeoResponse(request('/saloni/managed'), template);
    assert.match(managed.body, /property="og:image" content="https:\/\/lumera\.example\/api\/media\/images\/00000000-0000-4000-8000-000000000001\?size=large&amp;format=fallback"/);
    assert.match(managed.body, /property="og:image:width" content="1920"/);
    assert.match(managed.body, /property="og:image:height" content="1280"/);
    assert.match(managed.body, /property="og:image:type" content="image\/png"/);

    const legacy = await createSeoResponse(request('/saloni/legacy'), template);
    assert.match(legacy.body, /property="og:image" content="https:\/\/legacy\.example\/photo\.jpg"/);
    assert.doesNotMatch(legacy.body, /property="og:image:(?:width|height|type)"/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('server 404 offers useful public navigation and SPA-compatible salon search', async () => {
  const response = await createSeoResponse(request('/nepostojeca-stranica'), template);
  assert.equal(response.status, 404);
  assert.match(response.body, /<h1>Stranica nije pronađena<\/h1>/);
  assert.match(response.body, /<form action="\/saloni" method="get" role="search">/);
  assert.match(response.body, /name="category"/);
  assert.match(response.body, /href="\/edukacije"/);
  assert.match(response.body, /name="robots" content="noindex, nofollow"/);
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
    assert.equal(new URL(requestedUrl).pathname, '/api/salons');
    assert.equal(new URL(requestedUrl).searchParams.get('category'), 'Frizerski saloni');
    assert.equal(new URL(requestedUrl).searchParams.get('page'), '1');
    assert.equal(new URL(requestedUrl).searchParams.get('pageSize'), '6');
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
      assert.ok(requestedUrls.some((value) => {
        const url = new URL(value);
        return url.pathname === '/api/salons' && url.searchParams.get('category') === category.apiCategory && url.searchParams.get('page') === '1' && url.searchParams.get('pageSize') === '6';
      }));
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

test('sitemap uses the authored legal-page date rather than an invented current date', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const response = await createSeoResponse(request('/sitemap.xml'), template);
    assert.match(response.body, /<loc>https:\/\/lumera\.example\/uslovi-koriscenja<\/loc><lastmod>2026-08-24<\/lastmod>/);
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
  assert.match(registration.body, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(registration.body, /rel="canonical" href="https:\/\/lumera\.example\/pridruzi-se-edukativni-centar"/);
  assert.doesNotMatch(sitemap.body, /pridruzi-se-edukativni-centar/);
  assert.equal(robots.body, 'User-agent: *\nDisallow: /\n');
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
    assert.match(detail.body, /"price":1999/);
    assert.match(detail.body, /property="og:image" content="https:\/\/lumera\.example\/serum\.jpg"/);
    assert.match(detail.body, /name="twitter:image" content="https:\/\/lumera\.example\/serum\.jpg"/);
    assert.doesNotMatch(detail.body, /B2B-SKU-PRIVATE|Interni privatni opis|wholesalePrice|"stock"/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('owner cover descriptions drive social and visible image alt with a title fallback after removal', async () => {
  const originalFetch = global.fetch;
  const fixtures = {
    '/api/suppliers/aurora': { id: 's1', slug: 'aurora', name: 'Aurora Beauty', scope: 'B2C', active: true },
    '/api/suppliers/aurora/public-products/p1': {
      id: 'p1', supplierId: 's1', name: 'Javni serum', category: 'Nega',
      description: 'Opis proizvoda.', imageUrl: '/serum-cover.jpg', images: ['/serum-gallery.jpg'],
      socialImage: {
        url: '/api/media/images/product-cover?size=large&format=fallback',
        width: 1600,
        height: 1200,
        type: 'image/jpeg',
      },
      coverImageDescription: 'Bočica seruma pored cveta kamilice', price: 2499,
    },
    '/api/beauty-jobs/job-1': {
      id: 'job-1', type: 'job', intent: 'offering', title: 'Potreban frizer',
      description: 'Opis oglasa.', city: 'Beograd', region: 'Vračar',
      photos: ['/job.jpg'], coverImageDescription: 'Moderan frizerski radni prostor',
      authorDisplayName: 'Studio LUMERA',
    },
    '/api/salons/studio-lumera': {
      name: 'Studio LUMERA', city: 'Beograd', description: 'Opis salona.',
      imageUrl: '/salon-cover.jpg', gallery: ['/salon-gallery.jpg'],
      socialImage: {
        url: '/api/media/images/salon-cover?size=large&format=fallback',
        width: 1920,
        height: 1280,
        type: 'image/jpeg',
      },
      coverImageDescription: 'Enterijer salona sa dve radne stolice',
    },
    '/api/education/public/courses/course-1': {
      title: 'Balayage kurs', description: 'Opis kursa.', imageUrl: '/course.jpg',
      coverImageDescription: 'Instruktorka demonstrira balayage tehniku',
      publisher: 'LUMERA Akademija', format: 'in-person', duration: '2 dana', price: 12000,
    },
  };
  global.fetch = supplierCatalogFetch(fixtures);
  try {
    const cases = [
      ['/shop/aurora/proizvod/p1', 'Javni serum — Nega — Bočica seruma pored cveta kamilice'],
      ['/poslovi/potreban-frizer/job-1', 'Potreban frizer — u Beogradu — Moderan frizerski radni prostor'],
      ['/saloni/studio-lumera', 'Studio LUMERA — u Beogradu — Enterijer salona sa dve radne stolice'],
      ['/edukacije/course-1', 'Balayage kurs — Instruktorka demonstrira balayage tehniku'],
    ];
    for (const [pathname, imageAlt] of cases) {
      const response = await createSeoResponse(request(pathname), template);
      assert.equal(response.status, 200);
      assert.match(response.body, new RegExp(`property="og:image:alt" content="${imageAlt}"`));
      assert.match(response.body, new RegExp(`name="twitter:image:alt" content="${imageAlt}"`));
      assert.match(response.body, new RegExp(`<img[^>]+alt="${imageAlt}"`));
    }
    const productResponse = await createSeoResponse(request('/shop/aurora/proizvod/p1'), template);
    assert.match(productResponse.body, /property="og:image" content="https:\/\/lumera\.example\/api\/media\/images\/product-cover\?size=large&amp;format=fallback"/);
    assert.match(productResponse.body, /property="og:image:alt" content="Javni serum — Nega — Bočica seruma pored cveta kamilice"/);
    assert.doesNotMatch(productResponse.body, /property="og:image" content="[^"]*serum-gallery/);
    const salonResponse = await createSeoResponse(request('/saloni/studio-lumera'), template);
    assert.match(salonResponse.body, /property="og:image" content="https:\/\/lumera\.example\/api\/media\/images\/salon-cover\?size=large&amp;format=fallback"/);
    assert.match(salonResponse.body, /property="og:image:alt" content="Studio LUMERA — u Beogradu — Enterijer salona sa dve radne stolice"/);
    assert.match(salonResponse.body, /<img src="\/salon-cover\.jpg"[^>]+alt="Studio LUMERA — u Beogradu — Enterijer salona sa dve radne stolice"/);
    assert.doesNotMatch(salonResponse.body, /<img src="\/salon-gallery\.jpg"[^>]+alt="Enterijer salona sa dve radne stolice"/);

    fixtures['/api/suppliers/aurora/public-products/p1'].coverImageDescription = '   ';
    const fallback = await createSeoResponse(request('/shop/aurora/proizvod/p1'), template);
    assert.match(fallback.body, /property="og:image:alt" content="Javni serum — Nega"/);
    assert.match(fallback.body, /<img[^>]+alt="Javni serum — Nega"/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('sitemap contains only active retail supplier, category, and supplier-qualified product URLs', async () => {
  const originalFetch = global.fetch;
  const active = { id: 's1', slug: 'aurora', name: 'Aurora', scope: 'B2C', active: true, updatedAt: '2026-08-20T12:00:00Z' };
  const fixtures = {
    '/api/suppliers': [active, { id: 's2', slug: 'pro', name: 'Pro', scope: 'B2B', active: true }, { id: 's3', slug: 'off', name: 'Off', scope: 'BOTH', active: false }],
    '/api/salons': [],
    '/api/education/public/courses': [],
    '/api/beauty-jobs': [],
    '/api/suppliers/aurora/categories': [{ id: 'c3', name: 'Duboka', path: 'nega/lice/duboka', active: true, updatedAt: '2026-08-21T12:00:00Z' }, { id: 'off-c', name: 'Skrivena', path: 'skrivena', active: false }],
    '/api/suppliers/aurora/public-products': { items: [{ id: 'p1', updatedAt: '2026-08-22T12:00:00Z' }], total: 1, page: 1, pageSize: 100, totalPages: 1 },
  };
  global.fetch = supplierCatalogFetch(fixtures);
  try {
    const sitemap = await createSeoResponse(request('/sitemap.xml'), template);
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.body, /https:\/\/lumera\.example\/shop\/aurora<\/loc>/);
    assert.match(sitemap.body, /https:\/\/lumera\.example\/shop\/aurora\/nega\/lice\/duboka/);
    assert.match(sitemap.body, /https:\/\/lumera\.example\/shop\/aurora\/proizvod\/p1/);
    assert.match(sitemap.body, /<loc>https:\/\/lumera\.example\/shop\/aurora<\/loc><lastmod>2026-08-20<\/lastmod>/);
    assert.match(sitemap.body, /<loc>https:\/\/lumera\.example\/shop\/aurora\/nega\/lice\/duboka<\/loc><lastmod>2026-08-21<\/lastmod>/);
    assert.match(sitemap.body, /<loc>https:\/\/lumera\.example\/shop\/aurora\/proizvod\/p1<\/loc><lastmod>2026-08-22<\/lastmod>/);
    assert.doesNotMatch(sitemap.body, /\/shop\/(?:pro|off|aurora\/skrivena)|\/proizvodi\/p1/);
    assert.match(sitemap.body, /<loc>https:\/\/lumera\.example\/<\/loc><changefreq>/, 'Home omits lastmod when its salon source has no dated item');
    assert.match(sitemap.body, /<loc>https:\/\/lumera\.example\/proizvodi<\/loc><lastmod>2026-08-20<\/lastmod>/);
    assert.match(sitemap.body, /<loc>https:\/\/lumera\.example\/brendovi<\/loc><changefreq>/, 'URLs without a real source date omit lastmod');
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
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.location, 'https://lumera.example/shop/aurora/proizvod/p1');
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
    firstPublishedAt: '2026-08-27T11:00:00.000Z',
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
    assert.match(detail.body, /name="robots" content="noindex, nofollow"/);
    assert.equal(publicJobDate(job), job.firstPublishedAt);
    assert.ok(detail.body.includes(`"datePosted":"${job.firstPublishedAt}"`));
    assert.ok(detail.body.includes(`<time datetime="${job.firstPublishedAt}">${job.firstPublishedAt.slice(0, 10)}</time>`), 'visible SSR date and structured datePosted use the same first-publication value');
    for (const firstPublishedAt of [null, undefined]) {
      const legacyJob = { ...job, firstPublishedAt };
      assert.equal(publicJobDate(legacyJob), job.createdAt, 'legacy empty publication time falls back to creation');
      assert.equal(buildPageStructuredData('job', legacyJob, { origin: 'https://lumera.example', canonical: `/poslovi/${job.slug}/${job.id}` }).datePosted, job.createdAt);
    }
    for (const firstPublishedAt of ['', 'not-a-date', '2026-02-30']) {
      assert.equal(publicJobDate({ ...job, firstPublishedAt }), undefined, 'invalid non-null publication time must not silently fall back to creation');
    }
    assert.equal(publicJobDate({ ...job, createdAt: 'not-a-date' }), job.firstPublishedAt, 'a valid publication time does not depend on a valid fallback');
    const visibleSource = readFileSync(new URL('./src/pages/beauty-jobs-detail.tsx', import.meta.url), 'utf8');
    assert.match(visibleSource, /dateTime=\{publicJobDate\(job\)\}/);
    assert.match(visibleSource, /formatBeautyJobDate\(publicJobDate\(job\), "dd\.MM\.yyyy\."\)/, 'client visible label and time attribute share datePosted policy');
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
    assert.equal(catalog.status, 301);
    assert.equal(catalog.headers.location, 'https://lumera.example/poslovi?category=barberi');
    assert.equal(detail.status, 301);
    assert.equal(detail.headers.location, `https://lumera.example/poslovi/potreban-barber/${job.id}`);
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
