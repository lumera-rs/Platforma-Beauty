import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { getApiErrorDetails } from '@workspace/api-client-react';
import { GetPublicSupplierResponse } from '@workspace/api-zod';
import { applySeo, applyPendingDetailRobots, documentRobotsForRoute, dynamicMetadata as resolveDynamicMetadata, listingMetadataSchema, resolvePostMountSeo, seoHeadMetadata, visibleDetailReady, withQueryIndexability } from './client-seo-metadata';
const dynamicMetadata = async (pathname: string, queryClient: QueryClient) => {
  const result = await resolveDynamicMetadata(pathname, queryClient, 'https://lumera.example');
  if (!result) return result;
  const { structuredData: _schema, breadcrumbs, ...metadata } = result;
  if (breadcrumbs) assert.equal(breadcrumbs.at(-1)?.pathname, pathname, 'breadcrumbs must end at the current public route');
  return metadata;
};
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

test('home and public static routes keep current shared schemas after SPA navigation', async () => {
  const client = new QueryClient();
  try {
    const home = await resolvePostMountSeo('/', '', client, 'https://lumera.example');
    assert.match(JSON.stringify(home.structuredData), /"Organization"/);
    assert.match(JSON.stringify(home.structuredData), /"WebSite"/);
    const legal = await resolvePostMountSeo('/politika-privatnosti', '', client, 'https://lumera.example');
    assert.match(JSON.stringify(legal.structuredData), /"BreadcrumbList"/);
    assert.doesNotMatch(JSON.stringify(legal.structuredData), /"Organization"/);
    const unsupported = await resolvePostMountSeo('/unsupported-route', '', client, 'https://lumera.example');
    assert.equal(unsupported.structuredData, undefined);
  } finally { client.clear(); }
});

test('client city canonicals, titles and empty results share the SSR policy under staging noindex', async () => {
  const cases = [
    { search: '', canonical: '/saloni', eligible: true },
    { search: 'page=1', canonical: '/saloni', eligible: true },
    { search: 'page=2', canonical: '/saloni?page=2', eligible: true },
    { search: 'city=Beograd', canonical: '/saloni?city=Beograd', title: 'Saloni u Beogradu | LUMERA', eligible: true },
    { search: 'city=Beograd&page=1', canonical: '/saloni?city=Beograd', title: 'Saloni u Beogradu | LUMERA', eligible: true },
    { search: 'city=Beograd&page=2', canonical: '/saloni?city=Beograd&page=2', title: 'Saloni u Beogradu | LUMERA', eligible: true },
    { search: 'city=Beograd&brand=Test&page=2', canonical: '/saloni?city=Beograd', title: 'Saloni u Beogradu | LUMERA', eligible: false },
    { search: 'brand=Test&page=2', canonical: '/saloni', eligible: false },
    { search: 'city=Prazan+Grad', canonical: '/saloni?city=Prazan+Grad', title: 'Saloni Prazan Grad | LUMERA', eligible: false, empty: true },
    { search: 'city=Atlantida', canonical: '/saloni?city=Atlantida', title: 'Saloni Atlantida | LUMERA', eligible: true },
  ];
  for (const scenario of cases) {
    const client = new QueryClient();
    const params = new URLSearchParams(scenario.search);
    const observer = new QueryObserver(client, {
      queryKey: ['/api/salons', {
        page: Number(params.get('page') || 1), pageSize: 6, sort: 'recommended',
        city: params.get('city') ?? undefined, brand: params.get('brand') ?? undefined,
      }],
      initialData: scenario.empty ? [] : [{ name: 'Current public salon', slug: 'public-salon' }],
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      const payload = await resolvePostMountSeo('/saloni', scenario.search, client, 'https://lumera.example');
      assert.equal(payload.canonicalPath, scenario.canonical, scenario.search);
      assert.equal(payload.indexable, scenario.eligible, scenario.search);
      if (scenario.title) assert.equal(payload.title, scenario.title);
      const head = seoHeadMetadata('/saloni', payload, 'https://lumera.example', false);
      assert.equal(head.robots, 'noindex, nofollow', 'staging must never become indexable');
      assert.equal(head.canonical, `https://lumera.example${scenario.canonical}`);
      if (scenario.empty) assert.doesNotMatch(JSON.stringify(payload.structuredData), /"ItemList"/);
    } finally { unsubscribe(); client.clear(); }
  }
});

for (const scenario of ['populated', 'empty', 'error', 'loading', 'no-data', 'refetch-error', 'paused'] as const) {
  test(`robots policy without staging override: city ${scenario}`, async () => {
    const client = new QueryClient();
    const queryKey = ['/api/salons', { city: 'Beograd', page: 1 }];
    const observer = new QueryObserver(client, {
      queryKey, staleTime: Infinity, queryFn: () => new Promise<never>(() => {}),
      initialData: scenario === 'populated' || scenario === 'refetch-error'
        ? [{ name: 'Current salon', slug: 'current' }] : scenario === 'empty' ? [] : undefined,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const query = client.getQueryCache().find({ queryKey })!;
    if (scenario === 'error' || scenario === 'refetch-error') query.setState({ status: 'error', error: new Error('Public listing unavailable'), fetchStatus: 'idle' });
    if (scenario === 'no-data') query.setState({ status: 'success', data: undefined, fetchStatus: 'idle' });
    if (scenario === 'paused') query.setState({ fetchStatus: 'paused' });
    try {
      const payload = await resolvePostMountSeo('/saloni', 'city=Beograd', client, 'https://lumera.example');
      assert.equal(payload.indexable, scenario === 'populated', `city ${scenario}: policy must require a successful populated current response`);
      for (const serverRobots of ['noindex, follow', 'noindex, nofollow']) {
        const head = seoHeadMetadata('/saloni', payload, 'https://lumera.example', true, serverRobots, serverRobots);
        assert.equal(head.robots.startsWith('index,'), false, `city ${scenario}: must never loosen the current document's SSR noindex`);
        assert.equal(head.robots, serverRobots);
        if (!payload.successfulPageResponse && serverRobots.includes('nofollow')) assert.equal(head.robots, serverRobots);
      }
    } finally { unsubscribe(); client.clear(); }
  });
}

test('unverified metadata generally cannot loosen SSR robots, independent of staging', async () => {
  const client = new QueryClient();
  try {
    for (const path of ['/', '/o-nama', '/saloni', '/edukacije', '/poslovi', '/proizvodi', '/brendovi', '/recnik', '/inspiracija', '/unsupported-route']) {
      const payload = await resolvePostMountSeo(path, '', client, 'https://lumera.example');
      for (const serverRobots of ['noindex, follow', 'noindex, nofollow']) {
        assert.equal(seoHeadMetadata(path, payload, 'https://lumera.example', true, serverRobots).robots, serverRobots, path);
      }
    }
    const payload = { title: 'Static', description: 'Static', indexable: true };
    assert.equal(seoHeadMetadata('/', payload, 'https://lumera.example', true, 'index, follow').robots, 'noindex, follow');
  } finally { client.clear(); }
});

test('original SSR index is kept exactly through loading and error until definitive success', () => {
  const meta = { content: 'index, follow' };
  const owner = { querySelector: () => meta } as unknown as Document;
  const route = '/saloni?city=Beograd';
  const initial = documentRobotsForRoute(owner, route);
  const loading = { title: 'Saloni', description: 'Saloni', indexable: false, successfulPageResponse: false };
  meta.content = seoHeadMetadata('/saloni', loading, 'https://lumera.example', true, meta.content, initial).robots;
  assert.equal(meta.content, 'index, follow');
  assert.equal(seoHeadMetadata('/saloni', loading, 'https://lumera.example', true, 'noindex, follow', initial).robots, 'index, follow', 'error keeps original SSR index even if the mutable DOM differs');
  assert.equal(documentRobotsForRoute(owner, route), 'index, follow', 'client mutation must not replace the genuine SSR snapshot');
  const success = { ...loading, indexable: true, successfulPageResponse: true };
  assert.equal(seoHeadMetadata('/saloni', success, 'https://lumera.example', true, meta.content, documentRobotsForRoute(owner, route)).robots, 'index, follow');
});

function withRobotsDocument(route: string, robots: string, run: (meta: { content: string }, location: { host: string; pathname: string; search: string }) => Promise<void> | void) {
  const nodes = new Map<string, any>();
  const createElement = () => ({
    content: '', rel: '', href: '', attributes: {} as Record<string, string>,
    setAttribute(key: string, value: string) { this.attributes[key] = value; },
    remove() { for (const [key, value] of nodes) if (value === this) nodes.delete(key); },
  });
  const head = {
    querySelector: (selector: string) => nodes.get(selector) ?? null,
    append: (node: ReturnType<typeof createElement>) => {
      nodes.set(node.attributes.name ? `meta[name="${node.attributes.name}"]`
        : node.attributes.property ? `meta[property="${node.attributes.property}"]` : `link[rel="${node.rel}"]`, node);
    },
  };
  for (const [name, content] of [['robots', robots], ['lumera:site-indexable', 'true'], ['lumera:public-site-url', 'https://lumera.example']]) {
    const node = createElement(); node.setAttribute('name', name); node.content = content; head.append(node);
  }
  const url = new URL(route, 'https://lumera.example');
  const location = { host: url.host, pathname: url.pathname, search: url.search };
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, { document: { head, querySelector: head.querySelector, createElement, title: '' }, window: { location } });
  return Promise.resolve().then(() => run(nodes.get('meta[name="robots"]'), location)).finally(() => {
    if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document'); else globalThis.document = originalDocument;
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window'); else globalThis.window = originalWindow;
  });
}

test('applySeo matrix preserves initial SSR on loading/error and only definitive city data can tighten', async () => {
  for (const server of ['index, follow', 'noindex, follow', 'noindex, nofollow']) {
    for (const state of ['loading', 'error', 'populated', 'empty'] as const) {
      const client = new QueryClient();
      const key = ['/api/salons', { city: 'Beograd', page: 1 }];
      const observer = new QueryObserver(client, {
        queryKey: key, staleTime: Infinity, queryFn: () => new Promise<never>(() => {}),
        initialData: state === 'populated' ? [{ name: 'Salon', slug: 'salon' }] : state === 'empty' ? [] : undefined,
      });
      const unsubscribe = observer.subscribe(() => undefined);
      if (state === 'error') client.getQueryCache().find({ queryKey: key })!.setState({ status: 'error', error: new Error('API unavailable'), fetchStatus: 'idle' });
      try {
        const payload = await resolvePostMountSeo('/saloni', 'city=Beograd', client, 'https://lumera.example');
        await withRobotsDocument('/saloni?city=Beograd', server, (meta, location) => {
          applySeo('/saloni', payload);
          const expected = state === 'empty' && server === 'index, follow' ? 'noindex, follow' : server;
          assert.equal(meta.content, expected, `applySeo initial ${server} / ${state}`);
          location.search = '?city=Niš';
          const spaPayload = state === 'populated' || state === 'empty' ? payload : { ...payload, successfulPageResponse: false };
          applySeo('/saloni', spaPayload);
          assert.equal(meta.content, state === 'populated' ? 'index, follow' : server.includes('nofollow') && state !== 'empty' ? 'noindex, nofollow' : 'noindex, follow', `applySeo SPA ${server} / ${state}`);
        });
      } finally { unsubscribe(); client.clear(); }
    }
  }
});

test('applySeo uses immutable SSR rather than previous DOM and preserves normalized URL variants', async () => {
  await withRobotsDocument('/saloni?city=Beograd&page=2&unused=', 'index, follow', (meta, location) => {
    const pending = { title: 'Saloni', description: 'Saloni', indexable: false };
    applySeo('/saloni', pending);
    assert.equal(meta.content, 'index, follow', 'applySeo must receive the SSR snapshot during loading');
    meta.content = 'noindex, follow';
    location.search = '?page=2&city=Beograd';
    applySeo('/saloni', pending);
    assert.equal(meta.content, 'index, follow', 'applySeo must not confuse previous robots with normalized original SSR robots');
    applyPendingDetailRobots();
    assert.equal(meta.content, 'index, follow', 'visible detail wait must preserve SSR index');
    location.search = '?city=Beograd&page=3';
    applyPendingDetailRobots();
    assert.equal(meta.content, 'noindex, follow', 'different page must not share folded canonical-parent SSR');
  });
  await withRobotsDocument('/saloni?brand=Test&city=Beograd', 'index, follow', (meta, location) => {
    applySeo('/saloni', { title: 'Saloni', description: 'Saloni', indexable: false });
    location.search = '?city=Beograd&brand=Other';
    applySeo('/saloni', { title: 'Saloni', description: 'Saloni', indexable: false });
    assert.equal(meta.content, 'noindex, follow', 'different filters with the same canonical parent must not share SSR');
  });
});

test('education no-data and malformed bodies are not definitive empty responses', async () => {
  for (const data of [undefined, null, {}, { items: null }, { items: 'malformed' }]) {
    const client = new QueryClient();
    const key = ['/api/education/public/courses'];
    const observer = new QueryObserver(client, { queryKey: key, initialData: [], staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => undefined);
    client.getQueryCache().find({ queryKey: key })!.setState({ status: 'success', fetchStatus: 'idle', data });
    try {
      const payload = await resolvePostMountSeo('/edukacije', '', client, 'https://lumera.example');
      for (const server of ['index, follow', 'noindex, follow']) {
        await withRobotsDocument('/edukacije', server, (meta, location) => {
          applySeo('/edukacije', payload);
          assert.equal(meta.content, server, 'education no-data must preserve genuine SSR robots');
          location.pathname = '/edukacije/sekcije/drugo';
          applySeo(location.pathname, payload);
          assert.equal(meta.content, 'noindex, follow', 'SPA education no-data must not invent indexability');
        });
      }
      assert.equal(payload.successfulPageResponse, false, 'education non-array body must not be a definitive successful response');
    } finally { unsubscribe(); client.clear(); }
  }
});

test('SSR noindex ceiling is scoped to its URL, including city and page, across SPA navigation', () => {
  const meta = { content: 'noindex, nofollow' };
  const owner = { querySelector: () => meta } as unknown as Document;
  const original = '/saloni?city=Beograd';
  assert.equal(documentRobotsForRoute(owner, original), meta.content);
  const success = { title: 'Saloni', description: 'Saloni', indexable: true, successfulPageResponse: true };
  for (const route of ['/saloni?city=Niš', '/saloni?city=Beograd&page=2', '/edukacije']) {
    const ceiling = documentRobotsForRoute(owner, route);
    assert.equal(ceiling, undefined, 'unrelated SPA URL must not inherit the SSR ceiling');
    assert.equal(seoHeadMetadata('/saloni', { ...success, successfulPageResponse: false }, 'https://lumera.example', true, meta.content, ceiling).robots, 'noindex, nofollow', 'missing-response navigation still cannot relax current robots');
    assert.equal(seoHeadMetadata('/saloni', success, 'https://lumera.example', true, meta.content, ceiling).robots, 'index, follow');
  }
  meta.content = 'index, follow';
  assert.equal(seoHeadMetadata('/saloni', success, 'https://lumera.example', true, meta.content, documentRobotsForRoute(owner, original)).robots, 'noindex, nofollow', 'returning to the SSR URL restores its original ceiling');
});

test('stale active city/page responses never authorize the current route', async () => {
  const client = new QueryClient();
  const observer = new QueryObserver(client, {
    queryKey: ['/api/salons', { city: 'Beograd' }],
    initialData: [{ name: 'Previous salon', slug: 'previous' }], staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    for (const search of ['city=Niš', 'city=Beograd&page=2']) {
      const payload = await resolvePostMountSeo('/saloni', search, client, 'https://lumera.example');
      assert.equal(payload.indexable, false, search);
      assert.equal(seoHeadMetadata('/saloni', payload, 'https://lumera.example', true, 'noindex, follow').robots, 'noindex, follow');
      assert.equal(payload.structuredData, undefined);
    }
  } finally { unsubscribe(); client.clear(); }
});

test('listing schemas use only the active successful current filter/page DTO', async () => {
  const client = new QueryClient();
  const observer = new QueryObserver(client, {
    queryKey: ['/api/salons', { city: 'Beograd', page: 1, pageSize: 6, sort: 'recommended' }],
    initialData: [{ name: 'Current salon', slug: 'current' }],
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const payload = { title: 'Saloni', description: 'Saloni', indexable: true };
  try {
    const current = listingMetadataSchema('/saloni', 'city=Beograd&page=1', payload, client, 'https://lumera.example');
    assert.match(JSON.stringify(current.structuredData), /"ItemList"/);
    assert.match(JSON.stringify(current.structuredData), /Current salon/);
    const pending = listingMetadataSchema('/saloni', 'city=Beograd&page=2', payload, client, 'https://lumera.example');
    assert.equal(pending.structuredDataPending, true);
    assert.equal(pending.structuredData, undefined);
    const otherCity = listingMetadataSchema('/saloni', 'city=Niš&page=1', payload, client, 'https://lumera.example');
    assert.equal(otherCity.structuredDataPending, true);
    unsubscribe();
    assert.equal(listingMetadataSchema('/saloni', 'city=Beograd&page=1', payload, client, 'https://lumera.example').structuredDataPending, true);
  } finally { unsubscribe(); client.clear(); }
});

test('all public catalogue families build ItemLists from their visible query DTOs', () => {
  const client = new QueryClient();
  client.setQueryData(['/api/education/public/taxonomy'], taxonomy);
  client.setQueryData(['/api/suppliers/supply/categories'], [{ id: 'category-1', path: 'nega', name: 'Nega', active: true }]);
  const cases = [
    { path: '/edukacije', endpoint: '/api/education/public/courses', options: { page: 1, pageSize: 24 }, data: [{ id: 'course-1', title: 'Visible course' }], expected: '/edukacije/course-1' },
    { path: '/edukacije/sekcije/frizerske-obuke/zenske-frizure', endpoint: '/api/education/public/courses', options: { page: 1, sectionId: 'section-1', categoryId: 'category-1' }, data: [{ id: 'course-2', title: 'Visible scoped course' }], expected: '/edukacije/course-2' },
    { path: '/poslovi', endpoint: '/api/beauty-jobs', options: { page: 1, pageSize: 10, sort: 'newest' }, data: { items: [{ id: 'job-1', title: 'Visible job' }] }, expected: '/poslovi/visible-job/job-1' },
    { path: '/proizvodi', endpoint: '/api/suppliers', options: {}, data: [{ name: 'Visible supplier', slug: 'supply', active: true, scope: 'B2C' }], expected: '/shop/supply' },
    { path: '/shop/supply/nega', endpoint: '/api/suppliers/supply/public-products', options: { page: 1, categoryId: 'category-1' }, data: { items: [{ id: 'product-1', name: 'Visible product' }] }, expected: '/shop/supply/proizvod/product-1' },
    { path: '/brendovi', endpoint: '/api/brendovi', options: { query: 'Visible' }, data: [{ name: 'Visible brand' }], expected: 'Visible brand' },
    { path: '/inspiracija', endpoint: '/api/inspiracija', options: { query: '' }, data: [{ title: 'Visible inspiration', salon: { slug: 'salon-1' } }], expected: '/saloni/salon-1' },
    { path: '/recnik', endpoint: '/api/recnik', options: { query: '' }, data: [{ term: 'Visible term' }], expected: 'Visible term' },
  ];
  try {
    for (const scenario of cases) {
      const observer = new QueryObserver(client, {
        queryKey: [scenario.endpoint, scenario.options], initialData: scenario.data,
        staleTime: Infinity,
      });
      const unsubscribe = observer.subscribe(() => undefined);
      try {
        const result = listingMetadataSchema(scenario.path, '', { title: 'Current catalogue', description: 'Current', indexable: true }, client, 'https://lumera.example');
        assert.match(JSON.stringify(result.structuredData), /"ItemList"/, scenario.path);
        assert.ok(JSON.stringify(result.structuredData).includes(scenario.expected), scenario.path);
      } finally { unsubscribe(); }
    }
  } finally { client.clear(); }
});

test('metadata reuses current public detail cache and shared schema builder without extra fetches', async () => {
  const client = new QueryClient();
  const item = {
    name: 'Javni salon', city: 'Čačak', address: 'Javna ulica 1',
    description: 'Opis vidljivog salona', services: [], reviews: [], hours: [],
  };
  client.setQueryData(['/api/salons/javni'], item);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected duplicate request'); };
  try {
    const result = await resolveDynamicMetadata('/saloni/javni', client, 'https://lumera.example');
    assert.match(result!.title, /u Čačku/);
    assert.match(JSON.stringify(result!.structuredData), /Javni salon/);
    assert.doesNotMatch(JSON.stringify(result!.structuredData), /telephone/);
    const graph = (result!.structuredData as { '@graph': Record<string, any>[] })['@graph'];
    const crumbs = graph.find((node) => node['@type'] === 'BreadcrumbList')!.itemListElement;
    assert.deepEqual(crumbs.map((crumb: any) => [crumb.name, crumb.item]), [
      ['Početna', 'https://lumera.example/'],
      ['Javni salon', 'https://lumera.example/saloni/javni'],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    client.clear();
  }
});

test('terminal public-detail failures never trigger a metadata retry or schema', async () => {
  const client = new QueryClient();
  let requests = 0;
  await client.fetchQuery({
    queryKey: ['/api/salons/unavailable'],
    queryFn: async () => { throw Object.assign(new Error('Not public'), { status: 404 }); },
    retry: false,
  }).catch(() => undefined);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests++; return new Response('{}'); };
  try {
    assert.equal(await resolveDynamicMetadata('/saloni/unavailable', client, 'https://lumera.example'), null);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    client.clear();
  }
});

test('metadata-first HTTP 404 preserves the generated visible-page error contract', async () => {
  const client = new QueryClient();
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  };
  try {
    assert.equal(await resolveDynamicMetadata('/saloni/missing', client, 'https://lumera.example'), null);
    assert.equal(getApiErrorDetails(client.getQueryState(['/api/salons/missing'])?.error).status, 404);
    assert.equal(await resolveDynamicMetadata('/saloni/missing', client, 'https://lumera.example'), null);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; client.clear(); }
});

test('live metadata waits for the lazy visible detail hook rather than prefetching before its forced mount refresh', async () => {
  const client = new QueryClient();
  const endpoint = '/api/salons/lazy';
  let requests = 0;
  assert.equal(visibleDetailReady(client, endpoint), false);
  assert.equal(client.getQueryState([endpoint]), undefined);
  const observer = new QueryObserver(client, {
    queryKey: [endpoint], refetchOnMount: 'always',
    queryFn: async () => { requests++; return { name: 'Lazy salon', city: 'Beograd' }; },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    await client.getQueryCache().find({ queryKey: [endpoint] })!.promise;
    assert.equal(visibleDetailReady(client, endpoint), true);
    await resolveDynamicMetadata('/saloni/lazy', client, 'https://lumera.example');
    assert.equal(requests, 1, 'metadata must reuse the completed visible-hook request');
  } finally { unsubscribe(); client.clear(); }
});

test('an obsolete visible request cannot become schema-eligible after a delayed completion', async () => {
  const client = new QueryClient();
  const endpoint = '/api/salons/obsolete';
  let complete!: (value: { name: string; city: string }) => void;
  const delayed = new Promise<{ name: string; city: string }>((resolve) => { complete = resolve; });
  let aborted = false;
  const observer = new QueryObserver(client, {
    queryKey: [endpoint],
    queryFn: ({ signal }) => {
      signal.addEventListener('abort', () => { aborted = true; });
      return delayed;
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  assert.equal(visibleDetailReady(client, endpoint), false);
  unsubscribe();
  try {
    assert.equal(aborted, true, 'generated-style signal ownership aborts on route unmount');
    complete({ name: 'Obsolete salon', city: 'Beograd' });
    await delayed;
    await Promise.resolve();
    assert.equal(visibleDetailReady(client, endpoint), false);
    assert.equal(client.getQueryData([endpoint]), undefined);
    const current = await resolvePostMountSeo('/', '', client, 'https://lumera.example');
    assert.match(JSON.stringify(current.structuredData), /"WebSite"/);
    assert.doesNotMatch(JSON.stringify(current.structuredData), /Obsolete salon/);
  } finally { client.clear(); }
});

test('site-wide noindex survives client metadata updates and domain changes', () => {
  const payload = { title: 'Salon', description: 'Salon description', indexable: true };
  const staged = seoHeadMetadata('/saloni/test', payload, 'https://new-domain.example', false);
  assert.equal(staged.robots, 'noindex, nofollow');
  assert.equal(staged.canonical, 'https://new-domain.example/saloni/test');
  assert.equal(staged.openGraph.url, staged.canonical);
  assert.equal(staged.image, 'https://new-domain.example/og-lumera.png');
  assert.equal(seoHeadMetadata('/saloni/test', payload, 'https://new-domain.example', false).robots, 'noindex, nofollow');
});

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
  }, 'https://lumera.example', false);
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
  }, 'https://lumera.example', false);
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
  }, 'https://lumera.example', false);
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
    }, 'https://lumera.example', false);
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
        title: 'Studio LUMERA u Beogradu | LUMERA',
        description: 'Javni opis salona.',
        image: '/api/media/images/salon-cover?size=large&format=fallback',
        imageAlt: 'Studio LUMERA — u Beogradu — Enterijer salona sa dve radne stolice',
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
        imageAlt: 'Javni serum — Bočica seruma pored cveta kamilice',
        imageWidth: 1600,
        imageHeight: 1200,
        imageType: 'image/jpeg',
        indexable: true,
        canonicalPath: '/shop/aurora/proizvod/product-1',
      },
    );
    assert.equal(
      seoHeadMetadata('/saloni/studio-lumera', salon!, 'https://lumera.example', false).openGraph.imageAlt,
      'Studio LUMERA — u Beogradu — Enterijer salona sa dve radne stolice',
    );
    assert.equal(
      seoHeadMetadata('/shop/aurora/proizvod/product-1', product!, 'https://lumera.example', false).openGraph.image,
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
    'Studio LUMERA — Enterijer sa dve radne stolice',
  );
  assert.equal(
    galleryImageAlt({ ...shared, mediaUrl: '/cover.jpg', index: 1, variant: 'gallery' }),
    'Studio LUMERA — Enterijer sa dve radne stolice',
  );
  assert.equal(
    galleryImageAlt({ ...shared, mediaUrl: '/gallery.jpg', index: 1, variant: 'gallery' }),
    'Studio LUMERA — fotografija 2',
  );
  assert.equal(
    galleryImageAlt({ ...shared, mediaUrl: '/gallery.jpg', index: 1, variant: 'gallery', altText: '  Balajaž na dugoj kosi  ' }),
    'Studio LUMERA — Balajaž na dugoj kosi',
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

  assert.match(salonsSource, /alt=\{publicImageAlt\(\{ name: salon\.name, category: salon\.popularServices\?\.join\(', '\), city: salon\.city, description: salon\.coverImageDescription \}\)\}/);
  assert.match(homeSalonCardSource, /alt=\{publicImageAlt\(\{ name: salon\.name, category: salon\.popularServices\?\.join\(', '\), city: salon\.city, description: salon\.coverImageDescription \}\)\}/);
  assert.match(
    salonProfileSource,
    /coverImageUrl=\{salonData\.imageUrl\}[\s\S]{0,120}coverImageDescription=\{salonData\.coverImageDescription\}/,
  );
  assert.match(educationSource, /alt=\{publicImageAlt\(\{ name: course\.title, category: course\.category, city: course\.city, description: course\.coverImageDescription \}\)\}/);
  assert.match(
    educationSource,
    /coverImageUrl=\{course\.imageUrl\}[\s\S]{0,120}coverImageDescription=\{course\.coverImageDescription\}/,
  );
});