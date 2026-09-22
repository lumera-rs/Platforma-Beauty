import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { readInactiveSalonCity, resolveInactiveSalonCity } from './inactive-salon-city.mjs';
import { createSeoResponse, lookupPublicEntity } from './seo-server.mjs';

test('inactive city lookup uses a parameterized read-only projection', async () => {
  const slug = "name' OR true --";
  const city = await readInactiveSalonCity({ query: async query => {
    assert.equal(query.text, 'SELECT city FROM salons WHERE slug = $1 AND active = false LIMIT 1');
    assert.deepEqual(query.values, [slug]);
    return { rows: [{ city: 'Niš' }] };
  } }, slug);
  assert.equal(city, 'Niš');
  const source = readFileSync(new URL('./inactive-salon-city.mjs', import.meta.url), 'utf8');
  assert.match(source, /default_transaction_read_only=on/);
  for (const rows of [[], [{ city: null }], [{ city: '' }], [{ city: '  ' }]]) {
    await assert.rejects(readInactiveSalonCity({ query: async () => ({ rows }) }, 'fixture'), /unavailable/);
  }
});

test('label-only and mismatched public detail DTOs are unavailable, never redirects or misses', async () => {
  const previousFetch = global.fetch;
  const template = '<html><head></head><body><div id="root"></div></body></html>';
  const routes = ['/saloni/fixture', '/edukacije/fixture', '/edukacije/paketi/fixture',
    '/edukacije/centri/fixture', '/edukacije/instruktori/fixture',
    '/poslovi/title/fixture', '/beauty-poslovi/fixture', '/shop/fixture/proizvod/fixture'];
  try {
    for (const payload of [{ name: 'Label', title: 'Label' }, { id: ' ', name: 'Label', title: 'Label' }]) {
      global.fetch = async () => Response.json(payload);
      for (const url of routes) {
        const response = await createSeoResponse({ url, headers: { host: 'fixture.invalid' } }, template);
        assert.equal(response.status, 503, url);
        assert.match(response.body, /noindex/);
        assert.equal(response.headers.location, undefined);
      }
    }
    global.fetch = async () => Response.json({ id: 'wrong', title: 'Label' });
    assert.deepEqual(await lookupPublicEntity({}, '/api/beauty-jobs/fixture'), { state: 'unavailable' });
    global.fetch = async () => Response.json({ id: 'fixture', slug: 'wrong', name: 'Label' });
    assert.deepEqual(await lookupPublicEntity({}, '/api/salons/fixture'), { state: 'unavailable' });
    global.fetch = async () => Response.json({ name: 'Inactive', active: false });
    assert.deepEqual(await lookupPublicEntity({}, '/api/salons/fixture'), { state: 'found', value: { name: 'Inactive', active: false } });
  } finally { global.fetch = previousFetch; }
});

test('test-mode resolver refuses ambient DB access', async () => {
  assert.equal(process.env.NODE_ENV, 'test', 'Run this test with NODE_ENV=test');
  await assert.rejects(resolveInactiveSalonCity('fixture'), /ambient DB access is forbidden/);
});

test('inactive SSR uses injected city and never exposes other DTO fields', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => Response.json({ name: 'Fixture', active: false, address: 'PRIVATE_STREET', phone: 'PRIVATE_PHONE', city: 'PRIVATE_CITY' });
  const req = { url: '/saloni/fixture?ref=test', headers: { host: 'fixture.invalid', 'x-forwarded-proto': 'https' } };
  const template = '<html><head></head><body><div id="root"></div></body></html>';
  try {
    const response = await createSeoResponse(req, template, { resolveInactiveSalonCity: async slug => {
      assert.equal(slug, 'fixture');
      return 'Niš';
    } });
    assert.equal(response.status, 200);
    assert.match(response.body, /saloni\?city=Ni%C5%A1/);
    assert.match(response.body, /noindex/);
    assert.doesNotMatch(response.body, /PRIVATE_/);
    for (const invalid of ['', null, undefined, 123]) {
      assert.equal((await createSeoResponse(req, template, { resolveInactiveSalonCity: async () => invalid })).status, 503);
    }
  } finally { global.fetch = previousFetch; }
});