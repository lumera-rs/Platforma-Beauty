import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { GetPublicSupplierResponse } from '@workspace/api-zod';
import { dynamicMetadata, seoHeadMetadata, withQueryIndexability } from './client-seo-metadata';
import { galleryImageAlt } from './salon-gallery';
import { canonicalProductImageUrls, productImageDescriptionItems } from '../lib/product-media';

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

test('primary-only product media keeps its loaded description on unrelated saves', () => {
  const primaryUrl = '/api/media/00000000-0000-4000-8000-000000000001?v=primary';
  assert.deepEqual(canonicalProductImageUrls(primaryUrl, []), [primaryUrl]);
  assert.deepEqual(
    productImageDescriptionItems(primaryUrl, [], {
      [primaryUrl]: 'Bočica seruma na beloj podlozi',
    }),
    [{ url: primaryUrl, altText: 'Bočica seruma na beloj podlozi' }],
  );
});

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

test('client social image alt prefers the owner description and safely falls back after removal', () => {
  const ownerDescription = seoHeadMetadata('/saloni/studio-lumera', {
    title: 'Studio LUMERA u Beogradu | LUMERA',
    description: 'Javni opis salona.',
    image: '/salon.jpg',
    imageAlt: 'Svetao enterijer salona sa dve radne stolice',
    indexable: true,
  }, 'https://lumera.example');
  assert.equal(ownerDescription.imageAlt, 'Svetao enterijer salona sa dve radne stolice');
  assert.equal(ownerDescription.openGraph.imageAlt, ownerDescription.imageAlt);
  assert.equal(ownerDescription.twitter.imageAlt, ownerDescription.imageAlt);

  for (const imageAlt of [undefined, '', '   ']) {
    const fallback = seoHeadMetadata('/saloni/studio-lumera', {
      title: 'Studio LUMERA u Beogradu | LUMERA',
      description: 'Javni opis salona.',
      image: '/salon.jpg',
      imageAlt,
      indexable: true,
    }, 'https://lumera.example');
    assert.equal(fallback.imageAlt, 'Studio LUMERA u Beogradu | LUMERA');
  }
});

test('client metadata keeps API-produced cover social images paired with owner descriptions', async () => {
  const originalFetch = globalThis.fetch;
  const fixtures = new Map([
    ['/api/salons/studio-lumera', {
      name: 'Studio LUMERA',
      city: 'Beograd',
      description: 'Javni opis salona.',
      imageUrl: '/salon-cover.jpg',
      gallery: ['/salon-gallery.jpg'],
      coverImageDescription: 'Enterijer salona sa dve radne stolice',
      socialImage: {
        url: '/api/media/images/salon-cover?size=large&format=fallback',
        width: 1920,
        height: 1280,
        type: 'image/jpeg',
      },
    }],
    ['/api/suppliers/aurora', {
      id: 'supplier-1',
      slug: 'aurora',
      name: 'Aurora Beauty',
      scope: 'B2C',
      active: true,
    }],
    ['/api/suppliers/aurora/public-products/product-1', {
      id: 'product-1',
      name: 'Javni serum',
      description: 'Opis proizvoda.',
      imageUrl: '/serum-cover.jpg',
      images: ['/serum-gallery.jpg'],
      coverImageDescription: 'Bočica seruma pored cveta kamilice',
      socialImage: {
        url: '/api/media/images/product-cover?size=large&format=fallback',
        width: 1600,
        height: 1200,
        type: 'image/jpeg',
      },
    }],
  ]);
  globalThis.fetch = async (input) => {
    const pathname = typeof input === 'string' ? input : input.url;
    const payload = fixtures.get(pathname);
    return new Response(payload ? JSON.stringify(payload) : null, {
      status: payload ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    });
  };
  const queryClient = new QueryClient();
  try {
    const salon = await dynamicMetadata('/saloni/studio-lumera', queryClient);
    const product = await dynamicMetadata('/shop/aurora/proizvod/product-1', queryClient);
    assert.deepEqual(
      salon,
      {
        title: 'Studio LUMERA u Beograd | LUMERA',
        description: 'Javni opis salona.',
        image: '/api/media/images/salon-cover?size=large&format=fallback',
        imageAlt: 'Enterijer salona sa dve radne stolice',
        imageWidth: 1920,
        imageHeight: 1280,
        imageType: 'image/jpeg',
        indexable: true,
      },
    );
    assert.deepEqual(
      product,
      {
        title: 'Javni serum | Aurora Beauty',
        description: 'Opis proizvoda.',
        image: '/api/media/images/product-cover?size=large&format=fallback',
        imageAlt: 'Bočica seruma pored cveta kamilice',
        imageWidth: 1600,
        imageHeight: 1200,
        imageType: 'image/jpeg',
        indexable: true,
        canonicalPath: '/shop/aurora/proizvod/product-1',
      },
    );
    assert.equal(
      seoHeadMetadata('/saloni/studio-lumera', salon!, 'https://lumera.example').openGraph.imageAlt,
      'Enterijer salona sa dve radne stolice',
    );
    assert.equal(
      seoHeadMetadata('/shop/aurora/proizvod/product-1', product!, 'https://lumera.example').openGraph.image,
      'https://lumera.example/api/media/images/product-cover?size=large&format=fallback',
    );
  } finally {
    globalThis.fetch = originalFetch;
    queryClient.clear();
  }
});

test('public galleries use the owner description only for the matching cover image', () => {
  const shared = {
    salonName: 'Studio LUMERA',
    coverImageUrl: '/cover.jpg',
    coverImageDescription: '  Enterijer sa dve radne stolice  ',
  };
  assert.equal(
    galleryImageAlt({ ...shared, mediaUrl: '/cover.jpg', index: 0, variant: 'main' }),
    'Enterijer sa dve radne stolice',
  );
  assert.equal(
    galleryImageAlt({ ...shared, mediaUrl: '/cover.jpg', index: 1, variant: 'gallery' }),
    'Enterijer sa dve radne stolice',
  );
  assert.equal(
    galleryImageAlt({ ...shared, mediaUrl: '/gallery.jpg', index: 1, variant: 'gallery' }),
    'Studio LUMERA — fotografija 2',
  );
  assert.equal(
    galleryImageAlt({ ...shared, mediaUrl: '/gallery.jpg', index: 1, variant: 'gallery', altText: '  Balajaž na dugoj kosi  ' }),
    'Balajaž na dugoj kosi',
  );
  assert.equal(
    galleryImageAlt({ ...shared, mediaUrl: '/gallery.jpg', index: 1, variant: 'thumbnail' }),
    'Studio LUMERA — minijatura 2',
  );
  assert.equal(
    galleryImageAlt({ ...shared, mediaUrl: '/cover.jpg', index: 0, variant: 'main', coverImageDescription: '   ' }),
    'Studio LUMERA — glavna fotografija',
  );
});

test('public salon and education cover callsites pass owner descriptions to visible images', async () => {
  const [salonsSource, homeSalonCardSource, salonProfileSource, educationSource] = await Promise.all([
    readFile(new URL('../pages/salons.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./home-salon-card.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../pages/salon-profile.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../pages/education-marketplace.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(salonsSource, /alt=\{salon\.coverImageDescription\?\.trim\(\) \|\| `\$\{salon\.name\} — salon lepote`\}/);
  assert.match(homeSalonCardSource, /alt=\{salon\.coverImageDescription\?\.trim\(\) \|\| `\$\{salon\.name\} — salon lepote`\}/);
  assert.match(
    salonProfileSource,
    /coverImageUrl=\{salonData\.imageUrl\}[\s\S]{0,120}coverImageDescription=\{salonData\.coverImageDescription\}/,
  );
  assert.match(educationSource, /alt=\{course\.coverImageDescription\?\.trim\(\) \|\| course\.title\}/);
  assert.match(
    educationSource,
    /coverImageUrl=\{course\.imageUrl\}[\s\S]{0,120}coverImageDescription=\{course\.coverImageDescription\}/,
  );
});