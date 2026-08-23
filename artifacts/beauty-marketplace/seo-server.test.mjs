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
  const privateResponse = await createSeoResponse(request('/vlasnik/kontrolna-tabla'), template);
  assert.match(queryResponse.body, /name="robots" content="noindex, follow"/);
  assert.match(privateResponse.body, /name="robots" content="noindex, follow"/);
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