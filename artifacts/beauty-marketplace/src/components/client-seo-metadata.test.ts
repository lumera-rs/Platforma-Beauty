import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { GetPublicSupplierResponse } from '@workspace/api-zod';
import { dynamicMetadata, seoHeadMetadata, withQueryIndexability } from './client-seo-metadata';

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

test('client metadata publishes verified social image values and never guesses missing values', () => {
  const verified = seoHeadMetadata('/saloni/test', {
    title: 'Test salon',
    description: 'Opis',
    image: '/api/media/images/asset?size=large&format=fallback',
    imageWidth: 1920,
    imageHeight: 1280,
    imageType: 'image/png',
    indexable: true,
  }, 'https://lumera.example');
  assert.deepEqual({
    image: verified.openGraph.image,
    width: verified.openGraph.imageWidth,
    height: verified.openGraph.imageHeight,
    type: verified.openGraph.imageType,
  }, {
    image: 'https://lumera.example/api/media/images/asset?size=large&format=fallback',
    width: 1920,
    height: 1280,
    type: 'image/png',
  });

  const legacy = seoHeadMetadata('/saloni/legacy', {
    title: 'Legacy salon',
    description: 'Opis',
    image: 'https://legacy.example/photo.jpg',
    indexable: true,
  }, 'https://lumera.example');
  assert.equal(legacy.openGraph.imageWidth, undefined);
  assert.equal(legacy.openGraph.imageHeight, undefined);
  assert.equal(legacy.openGraph.imageType, undefined);
});

test('generated public contract accepts both verified and URL-only social image metadata', () => {
  const supplier = {
    id: 'supplier-1',
    name: 'Dobavljač',
    slug: 'dobavljac',
    scope: 'B2C' as const,
    logoUrl: 'https://legacy.example/logo.jpg',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const verified = GetPublicSupplierResponse.parse({
    ...supplier,
    socialImage: {
      url: '/api/media/00000000-0000-4000-8000-000000000001?v=hash&size=large&format=fallback',
      width: 1920,
      height: 1280,
      type: 'image/jpeg',
    },
  });
  assert.equal(verified.socialImage?.width, 1920);
  assert.equal(verified.socialImage?.type, 'image/jpeg');

  const unknown = GetPublicSupplierResponse.parse({
    ...supplier,
    socialImage: { url: supplier.logoUrl },
  });
  assert.deepEqual(unknown.socialImage, { url: supplier.logoUrl });
});