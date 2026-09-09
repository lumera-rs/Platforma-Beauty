import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { dynamicMetadata, withQueryIndexability } from './client-seo-metadata';

const taxonomy = [{
  id: 'section-1',
  slug: 'frizerske-obuke',
  name: 'Frizerske obuke',
  categories: [{
    id: 'category-1',
    slug: 'zenske-frizure',
    name: 'Ženske frizure',
    subcategories: [{
      id: 'subcategory-1',
      slug: 'balayage',
      name: 'Balayage',
    }],
  }],
}];

test('client metadata keeps every valid education taxonomy depth indexable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(taxonomy), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const queryClient = new QueryClient();
  try {
    const cases = [
      ['/edukacije/sekcije/frizerske-obuke', 'Frizerske obuke | Edukacije | LUMERA', 'Pronađite kurseve i obuke iz kategorije Frizerske obuke.'],
      ['/edukacije/sekcije/frizerske-obuke/zenske-frizure', 'Ženske frizure | Edukacije | LUMERA', 'Istražite edukacije za Ženske frizure.'],
      ['/edukacije/sekcije/frizerske-obuke/zenske-frizure/balayage', 'Balayage | Edukacije | LUMERA', 'Kursevi i obuke za tehniku Balayage.'],
    ] as const;
    for (const [pathname, title, description] of cases) {
      const metadata = await dynamicMetadata(pathname, queryClient);
      assert.deepEqual(metadata, { title, description, indexable: true });
      assert.equal(withQueryIndexability(metadata!, '').indexable, true);
      assert.equal(withQueryIndexability(metadata!, '?utm_source=test').indexable, false);
    }
  } finally {
    globalThis.fetch = originalFetch;
    queryClient.clear();
  }
});

test('client metadata rejects unknown education taxonomy paths', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(taxonomy), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const queryClient = new QueryClient();
  try {
    assert.equal(await dynamicMetadata('/edukacije/sekcije/nepoznata', queryClient), null);
    assert.equal(await dynamicMetadata('/edukacije/sekcije/frizerske-obuke/nepoznata', queryClient), null);
    assert.equal(await dynamicMetadata('/edukacije/sekcije/frizerske-obuke/zenske-frizure/nepoznata', queryClient), null);
  } finally {
    globalThis.fetch = originalFetch;
    queryClient.clear();
  }
});