import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createSeoResponse, lookupPublicEntity } from './seo-server.mjs';
import { parseDependencyPackageJson } from '../../lib/api-spec/dependency-package-parser.mjs';

// Content regressions run under the staging noindex policy.
process.env.PUBLIC_SITE_URL = 'https://lumera.example';
process.env.SITE_INDEXABLE = 'false';

test('frontend SSR has no database resolver or pg dependency', () => {
  assert.equal(existsSync(new URL('./inactive-salon-city.mjs', import.meta.url)), false);
  const source = readFileSync(new URL('./seo-server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /DATABASE_URL|resolveInactiveSalonCity|from ['"]pg['"]|import\(['"]pg['"]\)/);
  const manifest = parseDependencyPackageJson({
    contents: readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
    label: 'Frontend package manifest',
  });
  assert.equal(manifest.dependencies?.pg, undefined);
  assert.equal(manifest.devDependencies?.pg, undefined);
  const importer = readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8')
    .split('\n  artifacts/beauty-marketplace:\n')[1]?.split(/\n  [^\s]/)[0];
  assert.ok(importer, 'Frontend lockfile importer must exist');
  assert.doesNotMatch(importer, /^\s+pg:/m);
  const profile = readFileSync(new URL('./src/pages/salon-profile.tsx', import.meta.url), 'utf8')
    .split('if (inactiveSalon) {')[1].split('if (!salonData)')[0];
  assert.match(profile, /: <a[^>]*href="\/saloni">Pogledajte dostupne salone/);
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
    global.fetch = async () => Response.json({ name: 'Inactive', active: false, city: 'Niš' });
    assert.deepEqual(await lookupPublicEntity({}, '/api/salons/fixture'), { state: 'found', value: { name: 'Inactive', active: false, city: 'Niš' } });
  } finally { global.fetch = previousFetch; }
});

test('inactive SSR uses public DTO city and never exposes private fields', async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => Response.json({ name: 'Fixture', active: false, city: 'Niš', address: 'PRIVATE_STREET', entranceDirections: 'PRIVATE_ENTRANCE', intercom: 'PRIVATE_INTERCOM', floor: 'PRIVATE_FLOOR', apartment: 'PRIVATE_APARTMENT', phone: 'PRIVATE_PHONE', latitude: 'PRIVATE_LATITUDE', longitude: 'PRIVATE_LONGITUDE' });
  const req = { url: '/saloni/fixture?ref=test', headers: { host: 'fixture.invalid', 'x-forwarded-proto': 'https' } };
  const template = '<html><head></head><body><div id="root"></div></body></html>';
  try {
    const response = await createSeoResponse(req, template);
    assert.equal(response.status, 200);
    assert.match(response.body, /saloni\?city=Ni%C5%A1/);
    assert.match(response.body, /noindex/);
    assert.doesNotMatch(response.body, /PRIVATE_/);
    for (const invalid of ['', '  ', null, undefined, 123]) {
      global.fetch = async () => Response.json({ name: 'Fixture', active: false, city: invalid });
      assert.equal((await createSeoResponse(req, template)).status, 503);
    }
  } finally { global.fetch = previousFetch; }
});