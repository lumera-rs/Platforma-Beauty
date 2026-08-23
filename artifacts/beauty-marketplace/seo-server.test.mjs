import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeoResponse } from './seo-server.mjs';

const template = '<!doctype html><html><head><title>Placeholder</title><meta name="description" content="placeholder"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>';

function request(pathname) {
  return { url: pathname, headers: { host: 'lumera.example', 'x-forwarded-proto': 'https' } };
}

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