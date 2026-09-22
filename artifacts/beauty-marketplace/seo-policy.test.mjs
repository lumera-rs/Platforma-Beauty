import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeoResponse } from './seo-server.mjs';
import { publicSiteOrigin, siteIndexable, canonicalRedirect, normalizedPublicPath, normalizedQuery, listingCanonical, listingIndexable, applySitePolicy } from './seo-policy.mjs';

const template = '<html><head><meta name="robots" content="index, follow"></head><body><div id="root"></div></body></html>';
const env = { PUBLIC_SITE_URL: 'https://lumera.example', SITE_INDEXABLE: 'true' };
const req = (url, host = 'lumera.example', proto = 'https') => ({ url, method: 'GET', headers: { host, 'x-forwarded-proto': proto } });

test('canonical query normalization sorts and removes empty values without folding route identity', () => {
  assert.equal(String(normalizedQuery('?page=2&city=Beograd&empty=')), 'city=Beograd&page=2');
  assert.equal(String(normalizedQuery('city=&city=Niš&brand=')), 'city=Ni%C5%A1');
  assert.equal(listingCanonical('/saloni', 'page=2&city=Beograd&empty='), '/saloni?city=Beograd&page=2');
  assert.equal(String(normalizedQuery('brand=Test&city=Beograd')), 'brand=Test&city=Beograd');
  assert.equal(listingCanonical('/saloni', 'brand=Test&city=Beograd'), '/saloni?city=Beograd');
});

test('query normalization preserves non-empty repeated values with legacy delete semantics', () => {
  const OriginalURLSearchParams = globalThis.URLSearchParams;
  globalThis.URLSearchParams = class extends OriginalURLSearchParams {
    delete(name) { super.delete(name); }
  };
  try {
    assert.deepEqual(normalizedQuery('city=&city=Nis').getAll('city'), ['Nis']);
    assert.deepEqual(normalizedQuery('city=Nis&city=&city=Beograd').getAll('city'), ['Nis', 'Beograd']);
  } finally {
    globalThis.URLSearchParams = OriginalURLSearchParams;
  }
});

test('education and jobs canonical normalization removes empty query parameters', () => {
  for (const pathname of ['/edukacije', '/poslovi']) {
    assert.equal(listingCanonical(pathname, 'a=1&page=2&x='), `${pathname}?a=1&page=2`);
    assert.equal(listingCanonical(pathname, 'x=&page=2&a=1'), `${pathname}?a=1&page=2`);
  }
});

test('other listing eligibility uses normalized empty query parameters while staging stays noindex', () => {
  for (const pathname of ['/edukacije', '/poslovi']) {
    assert.equal(listingCanonical(pathname, 'prazno='), pathname);
    assert.equal(listingIndexable(pathname, 'prazno='), true);
    assert.equal(listingIndexable(pathname, '?prazno=&drugo='), true);
    assert.equal(listingIndexable(pathname, 'prazno=&a=1'), false);
    assert.equal(listingIndexable(pathname, 'page=2&x='), false);
    assert.match(applySitePolicy(template, req(`${pathname}?prazno=`, 'staging.example'),
      { ...env, SITE_INDEXABLE: 'false' }), /name="robots" content="noindex, nofollow"/);
  }
});

test('indexing requires exact host and explicit true; invalid origins fail closed', () => {
  assert.equal(siteIndexable(req('/'), env), true);
  for (const value of [undefined, '', 'false', 'TRUE', '1']) assert.equal(siteIndexable(req('/'), { ...env, SITE_INDEXABLE: value }), false);
  for (const host of ['preview.replit.dev', 'attacker.example', 'www.lumera.example', 'lumera.example:444']) assert.equal(siteIndexable(req('/', host), env), false);
  for (const origin of ['http://lumera.example', 'https://u:p@lumera.example', 'https://lumera.example/path', 'https://lumera.example?q=x']) assert.throws(() => publicSiteOrigin({ PUBLIC_SITE_URL: origin }));
  assert.equal(publicSiteOrigin({ PUBLIC_SITE_URL: 'https://www.lumera.example', LUMERA_PUBLIC_URL: 'https://old.example' }), env.PUBLIC_SITE_URL);
});

test('scheme, www, case and trailing slash normalize together, preserving query bytes', () => {
  const incoming = req('/SALONI/Moj-Salon/?ref=AbC%2FDef', 'www.lumera.example', 'http');
  const target = normalizedPublicPath('/SALONI/Moj-Salon/');
  assert.equal(canonicalRedirect(incoming, target, '?ref=AbC%2FDef', env.PUBLIC_SITE_URL), 'https://lumera.example/saloni/moj-salon?ref=AbC%2FDef');
  assert.equal(canonicalRedirect(req(target + '?ref=AbC%2FDef'), target, '?ref=AbC%2FDef', env.PUBLIC_SITE_URL), null);
  assert.equal(canonicalRedirect(req('/', 'staging.example', 'http'), '/', '', env.PUBLIC_SITE_URL), null);
  for (const pathname of ['/api/CaseSensitive/', '/assets/ChunkAbC.js', '/prijava?token=AbC', '/admin/Users', '/poslovi/nalog/Edukacije/', '/beauty-poslovi/moji-oglasi/']) {
    assert.equal(canonicalRedirect(req(pathname, 'www.lumera.example', 'http'), pathname, '', env.PUBLIC_SITE_URL), null);
  }
  assert.equal(normalizedPublicPath('/EDUKACIJE/CaseSensitiveId/'), '/edukacije/CaseSensitiveId');
  assert.equal(normalizedPublicPath('/SHOP/Moj-Shop/PROIZVOD/AbCd/'), '/shop/moj-shop/proizvod/AbCd');
});

test('SSR sends noindex,nofollow to staging and to disabled production for ordinary clients and bots', async () => {
  const previousOrigin = process.env.PUBLIC_SITE_URL;
  const previousIndexable = process.env.SITE_INDEXABLE;
  process.env.PUBLIC_SITE_URL = env.PUBLIC_SITE_URL;
  const previousFetch = global.fetch;
  global.fetch = async (url) => new Response(JSON.stringify(new URL(url).pathname === '/api/salons/test-salon'
    ? { id: 's1', slug: 'test-salon', name: 'Test salon', description: 'Test', city: 'Beograd', rating: 5, reviewCount: 2, services: [] }
    : []), { status: new URL(url).pathname === '/api/salons/missing' ? 404 : 200, headers: { 'content-type': 'application/json' } });
  try {
    for (const enabled of ['false']) {
      process.env.SITE_INDEXABLE = enabled;
      for (const host of ['staging.example', 'lumera.example']) {
        for (const pathname of ['/', '/saloni/test-salon', '/prijava?returnTo=abc']) {
          const request = req(pathname, host);
          const ordinary = await createSeoResponse(request, template);
          const crawler = await createSeoResponse({ ...request, headers: { ...request.headers, 'user-agent': 'Googlebot' } }, template);
          assert.equal(ordinary.body, crawler.body);
          if (host !== 'lumera.example' || enabled !== 'true') assert.match(ordinary.body, /name="robots" content="noindex, nofollow"/);
          assert.match(ordinary.body, /name="lumera:public-site-url" content="https:\/\/lumera.example"/);
        }
        const robots = await createSeoResponse(req('/robots.txt', host), template);
        if (host !== 'lumera.example' || enabled !== 'true') assert.equal(robots.body, 'User-agent: *\nDisallow: /\n');
        else assert.match(robots.body, /Allow: \//);
      }
    }
    process.env.SITE_INDEXABLE = 'false';
    const redirect = await createSeoResponse(req('/BEAUTY-POSLOVI/?ref=AbC', 'www.lumera.example', 'http'), template);
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.location, 'https://lumera.example/poslovi?ref=AbC');
    const missing = await createSeoResponse(req('/saloni/missing'), template);
    assert.equal(missing.status, 404, 'Existing missing-record status behavior is preserved');
  } finally {
    global.fetch = previousFetch;
    if (previousOrigin === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = previousOrigin;
    if (previousIndexable === undefined) delete process.env.SITE_INDEXABLE;
    else process.env.SITE_INDEXABLE = previousIndexable;
  }
});

test('policy replaces stale build metadata without duplicate robots tags', () => {
  const first = applySitePolicy(template, req('/'), env);
  const second = applySitePolicy(first, req('/', 'preview.example'), env);
  assert.equal((second.match(/name="robots"/g) ?? []).length, 1);
  assert.equal((second.match(/name="lumera:public-site-url"/g) ?? []).length, 1);
  assert.match(second, /noindex, nofollow/);
});

test('all filter listings drop empty values but retain sorted nonempty parameters', () => {
  for (const pathname of [
    '/shop/aurora', '/shop/aurora/nega/lica',
    '/saloni/kategorija/frizerski-saloni',
    '/edukacije/sekcije/nega', '/edukacije/sekcije/nega/lice',
    '/edukacije/sekcije/nega/lice/hidratacija',
  ]) {
    assert.equal(listingCanonical(pathname, '?empty=&z=last&a=first'), `${pathname}?a=first&z=last`);
    assert.equal(listingCanonical(pathname, '?z=last&empty=&page=2&a=first'), `${pathname}?a=first&page=2&z=last`);
    assert.equal(listingCanonical(pathname, '?empty=&another='), pathname);
    assert.equal(listingIndexable(pathname, '?empty=&another='), true);
    assert.equal(listingIndexable(pathname, '?empty=&a=first'), false);
  }
});

test('city canonicals collapse case, NFC and spacing without stripping accents', () => {
  for (const city of ['Novi Sad', 'novi sad', 'NOVI SAD', '  nOvI   sAd  ', '\tNovi\nSad']) {
    assert.equal(listingCanonical('/saloni', new URLSearchParams({ city }).toString()), '/saloni?city=Novi+Sad');
  }
  for (const city of ['Niš', 'NIŠ', '  nis\u030c  ']) {
    assert.equal(listingCanonical('/saloni', new URLSearchParams({ city }).toString()), '/saloni?city=Ni%C5%A1');
  }
  assert.equal(listingCanonical('/saloni', 'city=Nis'), '/saloni?city=Nis', 'accent variants are not assumed equal by the backend');
});