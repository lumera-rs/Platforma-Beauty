import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSitemapDiscovery, formatRobots, readDiscoveryPages, renderSitemapDocuments, sitemapTypes, discoveryLastmod } from './seo-discovery.mjs';
import { listingCanonical } from './seo-policy.mjs';
import { fetchSitemapJson } from './seo-server.mjs';

const origin = 'https://staging.example.test';
const apiOrigin = 'https://api.example.test';

test('real server fetch helper preserves missing detail status and discovery serves the remaining inventory', async () => {
  const previousFetch = global.fetch;
  try {
    for (const status of [404, 410]) {
      const mock = fixture({
        '/api/education/public/courses': [
          { id: 'course1', centerId: 'missing-center', instructorProfileId: 'missing-instructor' },
          { id: 'course2', centerId: 'available-center', instructorProfileId: 'available-instructor' },
        ],
        '/api/education/public/centers/available-center': { id: 'available-center', name: 'Center', courses: [] },
        '/api/education/instructors/available-instructor/public': { id: 'available-instructor', name: 'Instructor', courses: [] },
      });
      global.fetch = async (url, options) => {
        assert.equal(options.headers.accept, 'application/json');
        assert.equal(options.headers.authorization, undefined);
        assert.ok(options.signal instanceof AbortSignal);
        const parsed = new URL(url);
        assert.equal(parsed.origin, apiOrigin);
        if (parsed.pathname.includes('missing-')) return new Response(null, { status });
        return Response.json(await mock.fetchJson(parsed.pathname + parsed.search, parsed.origin));
      };
      await assert.rejects(fetchSitemapJson('/api/education/public/centers/missing-center', apiOrigin),
        error => error.status === status);
      const discovery = createSitemapDiscovery({ fetchJson: fetchSitemapJson });
      const education = await discovery.get({ origin, apiOrigin, pathname: '/sitemaps/education.xml' });
      assert.match(education.xml, /edukacije\/course1/);
      assert.match(education.xml, /edukacije\/course2/);
      assert.match(education.xml, /centri\/available-center/);
      assert.match(education.xml, /instruktori\/available-instructor/);
      assert.doesNotMatch(education.xml, /missing-center|missing-instructor/);
      assert.equal(education.diagnostics.omitted.length, 2);
      assert.ok(education.diagnostics.omitted.every(item => item.reason.includes(String(status))));
      assert.match((await discovery.get({ origin, apiOrigin, pathname: '/sitemaps/salons.xml' })).xml, /salon-a/);
      assert.match((await discovery.get({ origin, apiOrigin, pathname: '/sitemap.xml' })).xml, /sitemaps\/education.xml/);
    }
    for (const status of [401, 403, 429, 500, 503]) {
      const mock = fixture({
        '/api/education/public/courses': [{ id: 'course1', centerId: 'unavailable' }],
      });
      global.fetch = async url => {
        const parsed = new URL(url);
        if (parsed.pathname === '/api/education/public/centers/unavailable') return new Response(null, { status });
        return Response.json(await mock.fetchJson(parsed.pathname + parsed.search, parsed.origin));
      };
      await assert.rejects(createSitemapDiscovery({ fetchJson: fetchSitemapJson }).get({ origin, apiOrigin, pathname: '/sitemap.xml' }),
        error => error.status === status);
    }
  } finally {
    global.fetch = previousFetch;
  }
});

test('documented full robots responses exactly match pure formatter output', async () => {
  const doc = await readFile(new URL('../../docs/seo-discovery-policy.md', import.meta.url), 'utf8');
  const samples = [...doc.matchAll(/```text\n([\s\S]*?)```/g)].map(match => match[1]);
  assert.deepEqual(samples, [
    formatRobots({ indexable: false }),
    formatRobots({ indexable: true, origin: 'https://public.example' }),
  ]);
});

function fixture(overrides = {}) {
  const data = {
    '/api/salons': [{ id: 's1', slug: 'salon-a', city: ' Novi Sad ' }, { id: 's2', slug: 'salon-b', city: 'Novi Sad' }, { id: 's3', slug: 'salon-c', city: 'A&B' }, { id: 's4', slug: 'hidden', city: 'Hidden', active: false }],
    '/api/education/public/courses': [{ id: 'course1' }],
    '/api/beauty-jobs': { items: [{ id: 'job1', title: 'Beauty posao', updatedAt: '2025-01-02T03:00:00Z' }], total: 1 },
    '/api/suppliers': [{ id: 'supplier1', slug: 'beauty', active: true, scope: 'B2C' }, { id: 'supplier2', slug: 'b2b', active: true, scope: 'B2B' }],
    '/api/education/bundles': [{ id: 'bundle1' }],
    '/api/education/public/taxonomy': [{ slug: 'beauty', categories: [{ slug: 'nails', subcategories: [{ slug: 'gel' }] }] }],
    '/api/suppliers/beauty/categories': [{ path: 'lice/nega', active: true }],
    '/api/suppliers/beauty/public-products': { items: [{ id: 'product1', createdAt: '2024-01-01' }], total: 1 },
    ...overrides,
  };
  const calls = [];
  return { calls, fetchJson: async (path, api) => {
    calls.push([path, api]);
    const key = new URL(path, api).pathname;
    assert.ok(Object.hasOwn(data, key), `unexpected endpoint ${key}`);
    return structuredClone(data[key]);
  } };
}

test('robots off is exact, on is a pure formatter with narrow private inventory', () => {
  assert.equal(formatRobots({ indexable: false }), 'User-agent: *\nDisallow: /\n');
  const text = formatRobots({ indexable: true, origin });
  assert.match(text, /Allow: \/\n/);
  assert.match(text, /Disallow: \/poslovi\/nalog\$/);
  assert.match(text, /Sitemap: https:\/\/staging.example.test\/sitemap.xml/);
  assert.doesNotMatch(text, /Disallow: \/(?:api|assets|saloni|shop|beauty-poslovi)\/\n/);
});

test('index has six children; canonical cities, public inventory and genuine timestamps', async () => {
  const mock = fixture();
  const discovery = createSitemapDiscovery(mock);
  const get = pathname => discovery.get({ origin, apiOrigin, pathname });
  const index = await get('/sitemap.xml');
  assert.equal((index.xml.match(/<sitemap>/g) ?? []).length, 6);
  const cities = await get('/sitemaps/cities.xml');
  assert.match(cities.xml, new RegExp(listingCanonical('/saloni', 'city=Novi+Sad').replace(/[?+]/g, '\\$&')));
  assert.equal((cities.xml.match(/<url>/g) ?? []).length, 2);
  assert.match(cities.xml, /city=A%26b/);
  assert.doesNotMatch(cities.xml, /Hidden|lastmod|page=/);
  const salons = await get('/sitemaps/salons.xml');
  assert.doesNotMatch(salons.xml, /hidden|lastmod/);
  assert.match((await get('/sitemaps/jobs.xml')).xml, /<lastmod>2025-01-02T03:00:00.000Z<\/lastmod>/);
  const products = await get('/sitemaps/products.xml');
  assert.match(products.xml, /shop\/beauty\/proizvod\/product1/);
  assert.doesNotMatch(products.xml, /b2b|lastmod/);
  assert.ok(index.diagnostics.missingLastmod.some(entry => entry.pathname === '/edukacije/course1'));
  assert.equal(await get('/sitemaps/products-2.xml'), null);
  assert.ok(mock.calls.every(([path]) => path.startsWith('/api/')));
});

test('pagination reads beyond old 100-page bound and rejects DTO/repetition/truncation', async () => {
  const rows = await readDiscoveryPages(async path => {
    const page = Number(new URL(path, apiOrigin).searchParams.get('page'));
    return page <= 102 ? [{ id: `s${page}` }] : [];
  }, '/api/salons', apiOrigin, 1);
  assert.equal(rows.length, 102);
  await assert.rejects(readDiscoveryPages(async () => null, '/api/salons', apiOrigin), /Invalid discovery array/);
  await assert.rejects(readDiscoveryPages(async () => [{ id: 'repeated' }], '/api/salons', apiOrigin, 1), /repeated/);
  await assert.rejects(readDiscoveryPages(async () => ({ items: [], total: 9 }), '/api/salons', apiOrigin), /Truncated/);
});

test('split at 50000 and XML escaping; never fake updated times', () => {
  const groups = Object.fromEntries(sitemapTypes.map(type => [type, new Map()]));
  for (let i = 0; i < 50001; i++) groups.salons.set(i, { pathname: `/saloni/s${i}` });
  groups.cities.set('city', { pathname: '/saloni?city=A%26B&x=1' });
  const docs = renderSitemapDocuments(origin, groups);
  assert.equal((docs.get('/sitemaps/salons.xml').match(/<url>/g) ?? []).length, 50000);
  assert.equal((docs.get('/sitemaps/salons-2.xml').match(/<url>/g) ?? []).length, 1);
  assert.match(docs.get('/sitemaps/cities.xml'), /&amp;x=1/);
  assert.match(docs.get('/sitemap.xml'), /salons-2.xml/);
  assert.throws(() => renderSitemapDocuments(origin, groups, 50001), /limit/);
  assert.equal(discoveryLastmod({ createdAt: '2025-01-01', publishedAt: '2025-02-01' }), undefined);
});

test('cache coalesces, isolates both origins, refreshes and never hides upstream errors', async () => {
  const mock = fixture();
  let clock = 0;
  let failing = false;
  const discovery = createSitemapDiscovery({ fetchJson: (...args) => {
    if (failing) throw new Error('upstream unavailable');
    return mock.fetchJson(...args);
  }, now: () => clock, cacheTtlMs: 10 });
  const args = { origin, apiOrigin, pathname: '/sitemap.xml' };
  await Promise.all([discovery.get(args), discovery.get(args)]);
  const count = mock.calls.length;
  await discovery.get(args);
  assert.equal(mock.calls.length, count);
  const other = await discovery.get({ ...args, origin: 'https://other.example.test' });
  assert.match(other.xml, /https:\/\/other.example.test/);
  assert.equal(mock.calls.length, count * 2);
  await discovery.get({ ...args, apiOrigin: 'https://second-api.example.test' });
  assert.equal(mock.calls.length, count * 3);
  clock = 11;
  failing = true;
  await assert.rejects(discovery.get(args), /upstream unavailable/);
  failing = false;
  await discovery.get(args);
  assert.equal(mock.calls.length, count * 4);
});

test('related center/instructor absence is explicit; upstream detail failures remain errors', async () => {
  const mock = fixture({ '/api/education/public/courses': [{ id: 'c', centerId: 'gone' }] });
  const discovery = createSitemapDiscovery({ fetchJson: (path, api) => {
    if (path.endsWith('/centers/gone')) throw Object.assign(new Error('missing'), { status: 404 });
    return mock.fetchJson(path, api);
  } });
  const result = await discovery.get({ origin, apiOrigin, pathname: '/sitemaps/education.xml' });
  assert.doesNotMatch(result.xml, /centri\/gone/);
  assert.equal(result.diagnostics.omitted[0].reason, 'Public detail returned 404');
});

test('shared city policy deduplicates Unicode NFC, case and whitespace variants', async () => {
  const mock = fixture({ '/api/salons': [
    { id: 's1', slug: 'one', city: '  NOVI \t SAD ' },
    { id: 's2', slug: 'two', city: 'novi sad' },
    { id: 's3', slug: 'three', city: 'Čačak' },
    { id: 's4', slug: 'four', city: 'C\u030CAc\u030CAK' },
  ] });
  const result = await createSitemapDiscovery(mock).get({ origin, apiOrigin, pathname: '/sitemaps/cities.xml' });
  assert.equal((result.xml.match(/<url>/g) ?? []).length, 2);
  assert.ok(result.xml.includes(listingCanonical('/saloni', 'city=novi%20sad')));
  assert.ok(result.xml.includes(listingCanonical('/saloni', 'city=Čačak')));
});

test('meaningful related detail identity/content required, not arbitrary successful JSON', async () => {
  for (const payload of [{}, { id: 'center', name: 'Center' }, { id: 'wrong', name: 'Center', courses: [] }]) {
    const mock = fixture({ '/api/education/public/courses': [{ id: 'c', centerId: 'center' }],
      '/api/education/public/centers/center': payload });
    await assert.rejects(createSitemapDiscovery(mock).get({ origin, apiOrigin, pathname: '/sitemap.xml' }), /Invalid discovery detail DTO/);
  }
  const mock = fixture({ '/api/education/public/courses': [{ id: 'c', centerId: 'center', instructorProfileId: 'teacher' }],
    '/api/education/public/centers/center': { id: 'center', name: 'Center', courses: [], updatedAt: '2025-03-01' },
    '/api/education/instructors/teacher/public': { id: 'teacher', name: 'Teacher', courses: [], updatedAt: '2025-03-02' } });
  const result = await createSitemapDiscovery(mock).get({ origin, apiOrigin, pathname: '/sitemaps/education.xml' });
  assert.match(result.xml, /centri\/center<\/loc><lastmod>2025-03-01/);
  assert.match(result.xml, /instruktori\/teacher<\/loc><lastmod>2025-03-02/);
});

test('robots effective rules preserve public GET and assets while denying private APIs', () => {
  const rules = formatRobots({ indexable: true, origin }).split('\n').flatMap(line => {
    const match = line.match(/^(Allow|Disallow): (.+)$/);
    if (!match) return [];
    const pattern = match[2];
    const regex = new RegExp(`^${pattern.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}`);
    return [{ allow: match[1] === 'Allow', regex, length: pattern.replace(/\*/g, '').length }];
  });
  const allowed = path => rules.filter(rule => rule.regex.test(path))
    .sort((a, b) => b.length - a.length || Number(b.allow) - Number(a.allow))[0]?.allow ?? true;
  for (const path of ['/assets/main.js', '/api/salons', '/api/salons/example', '/api/suppliers/example/public-products',
    '/api/beauty-jobs', '/api/beauty-jobs/id', '/api/education/bundles/id',
    '/api/education/instructors/id/public', '/api/education/public/courses/id', '/api/media/id',
    '/api/education/courses/id/availability', '/api/growth/packages/public',
    '/assets/main.js?search=x', '/assets/image.webp?q=large', '/hero-bg.jpg?search=x&q=y',
    '/api/media/image?search=x', '/api/salons?search=x', '/api/education/public/courses?q=x',
    '/api/suppliers/shop/public-products?search=x']) assert.equal(allowed(path), true, path);
  for (const path of ['/api/admin', '/api/auth/me', '/api/internal/task', '/api/customer/dashboard',
    '/api/employee/locations', '/api/salon/profile', '/api/education/enrollments/id/lms',
    '/api/education/instructors', '/api/beauty-jobs/mine', '/api/beauty-jobs/id/applicants',
    '/api/education/bundles/id/purchases', '/api/education/payment-slips/course/id',
    '/api/retail/cart', '/api/growth/packages/id', '/edukacije?q=hair',
    '/shop/beauty?search=cream', '/poslovi?query=hair', '/saloni?city=Novi+Sad&search=x']) assert.equal(allowed(path), false, path);
});