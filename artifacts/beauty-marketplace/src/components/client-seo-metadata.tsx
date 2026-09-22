import { useLayoutEffect, useRef } from 'react';
import { buildPageStructuredData, compactSchema } from '../../structured-data.mjs';
import { cityPhrase, publicImageAlt, publicSalonCategories } from '../../seo-text.mjs';
import { listingCanonical, listingIndexable, listingPage, publicSiteOrigin as configuredSeoOrigin } from '../../seo-policy.mjs';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { customFetch, getBeautyJob, getGetBeautyJobQueryKey } from '@workspace/api-client-react';
import { getPublicCategoryPage } from '@/lib/public-category-pages';
import staticSeoPages from '@/lib/static-seo-pages.json';
import { publicSiteOrigin } from '@/lib/public-site-url';
import {
  isRetryableBeautyJobDetailError,
  shouldRetryBeautyJobDetail,
} from '@/lib/beauty-job-detail-query';

export type SeoPayload = {
  title: string;
  description: string;
  image?: string;
  imageAlt?: string | null;
  imageWidth?: number;
  imageHeight?: number;
  imageType?: string;
  indexable: boolean;
  canonicalPath?: string;
  structuredData?: unknown;
  structuredDataPending?: boolean;
  breadcrumbs?: { name: string; pathname: string }[];
  listName?: string;
};

export type SeoHeadMetadata = {
  title: string;
  description: string;
  canonical: string;
  robots: 'index, follow' | 'noindex, follow' | 'noindex, nofollow';
  image: string;
  imageAlt: string;
  openGraph: {
    title: string;
    description: string;
    url: string;
    image: string;
    imageAlt: string;
    imageWidth?: number;
    imageHeight?: number;
    imageType?: string;
  };
  twitter: {
    title: string;
    description: string;
    url: string;
    image: string;
    imageAlt: string;
  };
};

const APP_NAME = 'LUMERA';

const staticSeoByPath = new Map(staticSeoPages.map((page) => [page.path, page]));
const defaultDescription = staticSeoByPath.get('/')?.description
  ?? 'Pronađite proverene salone, beauty i wellness tretmane i stručne edukacije na jednom mestu uz LUMERA.';
const defaultImageAlt = 'LUMERA platforma za beauty i wellness usluge, proizvode i edukacije';

const defaultImageMetadata = { width: 1200, height: 630, type: 'image/png' };
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function clip(value: string, limit = 158): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1).trimEnd()}…`;
}
function isPublicRetailSupplier(value: any): boolean {
  return Boolean(value?.active && (value.scope === 'B2C' || value.scope === 'BOTH'));
}

function staticMetadata(pathname: string): SeoPayload | null {
  const categorySlug = pathname.match(/^\/saloni\/kategorija\/([^/]+)$/)?.[1];
  const categoryPage = getPublicCategoryPage(categorySlug);
  if (categoryPage) {
    return {
      title: categoryPage.title,
      description: categoryPage.description,
      indexable: true,
    };
  }

  const page = staticSeoByPath.get(pathname);
  return page
    ? { title: page.title, description: page.description, indexable: page.indexable }
    : null;
}

function setMeta(selector: string, attribute: 'name' | 'property', key: string, content: string) {
  let node = document.head.querySelector<HTMLMetaElement>(selector);
  if (!node) {
    node = document.createElement('meta');
    node.setAttribute(attribute, key);
    document.head.append(node);
  }
  node.content = content;
}

function setOptionalMeta(selector: string, attribute: 'name' | 'property', key: string, content?: string | number) {
  if (content === undefined) {
    document.head.querySelector(selector)?.remove();
    return;
  }
  setMeta(selector, attribute, key, String(content));
}
export function seoHeadMetadata(pathname: string, payload: SeoPayload, origin: string, siteAllowed: boolean): SeoHeadMetadata {
  const publicPath = payload.canonicalPath ?? pathname;
  const cleanPublicPath = publicPath !== '/' ? publicPath.replace(/\/+$/, '') : publicPath;
  const canonical = new URL(cleanPublicPath, origin).href;
  const image = payload.image ? new URL(payload.image, origin).href : `${origin}/og-lumera.png`;
  const title = clip(payload.title, 60);
  const description = clip(payload.description);
  const imageAlt = payload.image ? text(payload.imageAlt, title) : defaultImageAlt;
  const imageWidth = payload.imageWidth ?? (!payload.image ? defaultImageMetadata.width : undefined);
  const imageHeight = payload.imageHeight ?? (!payload.image ? defaultImageMetadata.height : undefined);
  const imageType = payload.imageType ?? (!payload.image ? defaultImageMetadata.type : undefined);
  return {
    title,
    description,
    canonical,
    robots: !siteAllowed ? 'noindex, nofollow' : payload.indexable ? 'index, follow' : 'noindex, follow',
    image,
    imageAlt,
    openGraph: { title, description, url: canonical, image, imageAlt, imageWidth, imageHeight, imageType },
    twitter: { title, description, url: canonical, image, imageAlt },
  };
}

function socialImagePayload(entity: any, fallbackImage?: string): Pick<SeoPayload, 'image' | 'imageWidth' | 'imageHeight' | 'imageType'> {
  const image = entity?.socialImage;
  return {
    image: text(image?.url, fallbackImage),
    imageWidth: typeof image?.width === 'number' ? image.width : undefined,
    imageHeight: typeof image?.height === 'number' ? image.height : undefined,
    imageType: text(image?.type) || undefined,
  };
}
export function applySeo(pathname: string, payload: SeoPayload) {
  const origin = publicSiteOrigin();
  const allowed = document.querySelector<HTMLMetaElement>('meta[name="lumera:site-indexable"]')?.content === 'true'
    && window.location.host.toLowerCase() === new URL(origin).host;
  const metadata = seoHeadMetadata(pathname, payload, origin, allowed);
  document.title = metadata.title;
  setMeta('meta[name="description"]', 'name', 'description', metadata.description);
  setMeta('meta[name="robots"]', 'name', 'robots', metadata.robots);
  setMeta('meta[property="og:title"]', 'property', 'og:title', metadata.openGraph.title);
  setMeta('meta[property="og:description"]', 'property', 'og:description', metadata.openGraph.description);
  setMeta('meta[property="og:url"]', 'property', 'og:url', metadata.openGraph.url);
  setMeta('meta[property="og:image"]', 'property', 'og:image', metadata.openGraph.image);
  setMeta('meta[property="og:image:alt"]', 'property', 'og:image:alt', metadata.openGraph.imageAlt);
  setOptionalMeta('meta[property="og:image:width"]', 'property', 'og:image:width', metadata.openGraph.imageWidth);
  setOptionalMeta('meta[property="og:image:height"]', 'property', 'og:image:height', metadata.openGraph.imageHeight);
  setOptionalMeta('meta[property="og:image:type"]', 'property', 'og:image:type', metadata.openGraph.imageType);
  setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', metadata.twitter.title);
  setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', metadata.twitter.description);
  setMeta('meta[name="twitter:url"]', 'name', 'twitter:url', metadata.twitter.url);
  setMeta('meta[name="twitter:image"]', 'name', 'twitter:image', metadata.twitter.image);
  setMeta('meta[name="twitter:image:alt"]', 'name', 'twitter:image:alt', metadata.twitter.imageAlt);
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.append(link);
  }
  link.href = metadata.canonical;
}

export function withQueryIndexability(payload: SeoPayload, searchString: string, pathname?: string): SeoPayload {
  return { ...payload, indexable: payload.indexable && listingIndexable(pathname ?? '', searchString) };
}

export async function dynamicMetadata(pathname: string, queryClient: QueryClient, origin?: string): Promise<SeoPayload | null> {
  // Use the same URL keys as the generated public hooks, including their
  // in-flight promises. Terminal public-detail errors must not cause a second
  // request merely to populate metadata.
  const fetch = async (url: string): Promise<Response> => {
    const queryKey = [url];
    const state = queryClient.getQueryState(queryKey);
    if (state?.error && !isRetryableBeautyJobDetailError(state.error)) {
      return new Response(null, { status: 404 });
    }
    try {
      const cached = state?.fetchStatus === 'fetching' ? undefined : queryClient.getQueryData(queryKey);
      const data = cached ?? await queryClient.fetchQuery({
        queryKey,
        // The visible generated hooks share this cache entry. Preserve their
        // ApiError contract so a metadata-first 404 still renders "not found",
        // rather than being misclassified by the UI as a transient failure.
        queryFn: () => customFetch(url, { method: 'GET', responseType: 'json' }),
        retry: false,
      });
      return new Response(JSON.stringify(data), { status: 200 });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
  const schemaOrigin = () => origin ?? (typeof document === 'undefined' ? configuredSeoOrigin() : publicSiteOrigin());
  const schema = (type: string, data: any, description?: string, breadcrumbs = [{ name: text(data.name, data.title), pathname }]) => compactSchema(buildPageStructuredData(type, data, {
    origin: schemaOrigin(),
    canonical: new URL(breadcrumbs.at(-1)?.pathname ?? pathname, schemaOrigin()).href,
    description,
    breadcrumbs,
  }));
  const supplierProduct = pathname.match(/^\/shop\/([^/]+)\/proizvod\/([^/]+)$/);
  if (supplierProduct) {
    const supplierSlug = decodeURIComponent(supplierProduct[1]);
    const productId = decodeURIComponent(supplierProduct[2]);
    const [supplierResponse, productResponse] = await Promise.all([
      fetch(`/api/suppliers/${encodeURIComponent(supplierSlug)}`),
      fetch(`/api/suppliers/${encodeURIComponent(supplierSlug)}/public-products/${encodeURIComponent(productId)}`),
    ]);
    if (!supplierResponse.ok || !productResponse.ok) return null;
    const [supplier, item] = await Promise.all([supplierResponse.json(), productResponse.json()]);
    if (!isPublicRetailSupplier(supplier)) return null;
    const name = text(item.name, 'Beauty proizvod');
    const supplierName = text(supplier.name, 'LUMERA');
    const canonicalSupplierSlug = text(supplier.slug, supplierSlug);
    const canonicalProductId = text(item.id, productId);
    return {
      title: `${name} | ${supplierName}`,
      description: text(item.description, `${name} — javno dostupan beauty proizvod na LUMERA platformi.`),
      ...socialImagePayload(item, item.imageUrl),
      imageAlt: publicImageAlt({ name, category: item.category, description: item.coverImageDescription }),
      indexable: true,
      canonicalPath: `/shop/${encodeURIComponent(canonicalSupplierSlug)}/proizvod/${encodeURIComponent(canonicalProductId)}`,
      structuredData: schema('product', item, undefined, [
        { name: 'Proizvodi', pathname: '/proizvodi' },
        { name: supplierName, pathname: `/shop/${encodeURIComponent(canonicalSupplierSlug)}` },
        { name, pathname: `/shop/${encodeURIComponent(canonicalSupplierSlug)}/proizvod/${encodeURIComponent(canonicalProductId)}` },
      ]),
    };
  }
  const supplierShop = pathname.match(/^\/shop\/([^/]+)(?:\/(.+))?$/);
  if (supplierShop) {
    const supplierSlug = decodeURIComponent(supplierShop[1]);
    const categoryPath = supplierShop[2]
      ? supplierShop[2].split('/').map(decodeURIComponent).join('/')
      : '';
    const [supplierResponse, categoriesResponse] = await Promise.all([
      fetch(`/api/suppliers/${encodeURIComponent(supplierSlug)}`),
      fetch(`/api/suppliers/${encodeURIComponent(supplierSlug)}/categories`),
    ]);
    if (!supplierResponse.ok || !categoriesResponse.ok) return null;
    const [supplier, categories] = await Promise.all([supplierResponse.json(), categoriesResponse.json()]);
    if (!isPublicRetailSupplier(supplier) || !Array.isArray(categories)) return null;
    const category = categoryPath
      ? categories.find((item: any) => item.active && item.path === categoryPath)
      : null;
    if (categoryPath && !category) return null;
    const supplierName = text(supplier.name, 'Beauty proizvodi');
    const canonicalSupplierSlug = text(supplier.slug, supplierSlug);
    const canonicalCategoryPath = category
      ? `/${String(category.path).split('/').map(encodeURIComponent).join('/')}`
      : '';
    return {
      title: category
        ? `${text(category.name, 'Beauty proizvodi')} | ${supplierName}`
        : `${supplierName} | Beauty proizvodi`,
      description: category
        ? `${text(category.name, 'Beauty proizvodi')} dobavljača ${supplierName}. Pogledajte javno dostupne beauty proizvode, opise i cene za kupce.`
        : text(supplier.description, `Istražite javnu ponudu beauty proizvoda dobavljača ${supplierName} na LUMERA platformi.`),
      ...socialImagePayload(supplier, supplier.logoUrl),
      indexable: true,
      canonicalPath: `/shop/${encodeURIComponent(canonicalSupplierSlug)}${canonicalCategoryPath}`,
      listName: category ? `${category.name} — ${supplierName}` : `${supplierName} proizvodi`,
      breadcrumbs: [
        { name: 'Proizvodi', pathname: '/proizvodi' },
        { name: supplierName, pathname: `/shop/${encodeURIComponent(canonicalSupplierSlug)}` },
        ...(category ? [{ name: category.name, pathname }] : []),
      ],
    };
  }
  const product = pathname.match(/^\/proizvodi\/([^/]+)$/);
  if (product) {
    const response = await fetch(`/api/shop/public/products/${encodeURIComponent(product[1])}`);
    if (!response.ok) return null;
    const item = await response.json();
    const name = text(item.name, 'Beauty proizvod');
    return {
      title: `${name} | LUMERA proizvodi`,
      structuredData: schema('product', item),
      description: text(item.description, `${name} — javno dostupan beauty proizvod na LUMERA platformi.`),
      ...socialImagePayload(item, item.imageUrl),
      imageAlt: publicImageAlt({ name, category: item.category, description: item.coverImageDescription }),
      indexable: true,
    };
  }
  const salon = pathname.match(/^\/saloni\/([^/]+)$/);
  if (salon) {
    const response = await fetch(`/api/salons/${encodeURIComponent(salon[1])}`);
    if (!response.ok) return null;
    const item = await response.json();
    const name = text(item.name, 'Salon');
    const city = cityPhrase(item.city);
    return {
      title: `${name} ${city} | LUMERA`,
      description: text(item.description, text(item.shortDescription, `${name} — salon i beauty tretmani ${city}.`)),
      ...socialImagePayload(item, item.imageUrl),
      imageAlt: publicImageAlt({ name, category: publicSalonCategories(item).join(', '), city: item.city, description: item.coverImageDescription }),
      indexable: true,
      structuredData: schema('salon', item, text(item.description, item.shortDescription)),
    };
  }
  const taxonomyMatch = pathname.match(/^\/edukacije\/sekcije\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
  if (taxonomyMatch) {
    const [sectionSlug, categorySlug, subcategorySlug] = taxonomyMatch.slice(1).map((value) =>
      value ? decodeURIComponent(value) : undefined);
    const response = await fetch('/api/education/public/taxonomy');
    if (!response.ok) return null;
    const taxonomy = await response.json();
    if (!Array.isArray(taxonomy)) return null;
    const section = taxonomy.find((item: any) => item.slug === sectionSlug);
    if (!section) return null;

    let title = text(section.name, 'Beauty edukacije');
    let description = `Pronađite kurseve i obuke iz kategorije ${title}.`;
    if (categorySlug) {
      const category = section.categories?.find((item: any) => item.slug === categorySlug);
      if (!category) return null;
      title = text(category.name, title);
      description = `Istražite edukacije za ${title}.`;
      if (subcategorySlug) {
        const subcategory = category.subcategories?.find((item: any) => item.slug === subcategorySlug);
        if (!subcategory) return null;
        title = text(subcategory.name, title);
        description = `Kursevi i obuke za tehniku ${title}.`;
      }
    }
    return {
      title: `${title} | Edukacije | LUMERA`,
      description,
      indexable: true,
      breadcrumbs: [
        { name: 'Edukacije', pathname: '/edukacije' },
        { name: section.name, pathname: `/edukacije/sekcije/${sectionSlug}` },
        ...(categorySlug ? [{ name: section.categories.find((item: any) => item.slug === categorySlug).name, pathname: `/edukacije/sekcije/${sectionSlug}/${categorySlug}` }] : []),
        ...(subcategorySlug ? [{ name: title, pathname }] : []),
      ],
    };
  }
  const course = pathname.match(/^\/edukacije\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  if (course) {
    const response = await fetch(`/api/education/public/courses/${encodeURIComponent(course[1])}`);
    if (!response.ok) return null;
    const item = await response.json();
    const title = text(item.title, 'Beauty edukacija');
    return {
      title: `${title} | LUMERA edukacije`,
      structuredData: schema('course', item),
      description: text(item.description, `${title} — stručna beauty edukacija na LUMERA platformi.`),
      ...socialImagePayload(item, item.imageUrl),
      imageAlt: publicImageAlt({ name: title, category: item.category, city: item.city, description: item.coverImageDescription }),
      indexable: true,
    };
  }
  const bundle = pathname.match(/^\/edukacije\/paketi\/([a-zA-Z0-9-]+)$/);
  if (bundle) {
    const response = await fetch(`/api/education/bundles/${encodeURIComponent(bundle[1])}`);
    if (!response.ok) return null;
    const item = await response.json();
    const name = text(item.name, text(item.title, 'Paket edukacija'));
    return {
      title: `${name} | LUMERA edukacije`,
      structuredData: schema('bundle', item),
      description: text(item.description, `${name} — paket stručnih beauty edukacija na LUMERA platformi.`),
      indexable: true,
    };
  }
  const center = pathname.match(/^\/edukacije\/centri\/([a-zA-Z0-9-]+)$/);
  if (center) {
    const response = await fetch(`/api/education/public/centers/${encodeURIComponent(center[1])}`);
    if (!response.ok) return null;
    const item = await response.json();
    const name = text(item.name, 'Edukativni centar');
    return { title: `${name} | LUMERA edukacije`, description: text(item.description, `Kursevi i edukacije centra ${name}.`), ...socialImagePayload(item, item.imageUrl), indexable: true, structuredData: schema('center', item) };
  }
  const instructor = pathname.match(/^\/edukacije\/instruktori\/([a-zA-Z0-9-]+)$/);
  if (instructor) {
    const response = await fetch(`/api/education/instructors/${encodeURIComponent(instructor[1])}/public`);
    if (!response.ok) return null;
    const item = await response.json();
    const name = text(item.name, 'Instruktor');
    return { title: `${name} | LUMERA edukacije`, description: text(item.biography, `Upoznajte instruktora ${name} i dostupne beauty edukacije.`), ...socialImagePayload(item, item.photoUrl), indexable: true, structuredData: schema('instructor', item) };
  }
  if (pathname === '/poslovi/nalog' || pathname.startsWith('/poslovi/nalog/')) {
    return null;
  }
  const beautyJob = pathname.match(/^\/poslovi\/[^/]+\/([a-zA-Z0-9-]+)$/);
  if (beautyJob) {
    const listingId = beautyJob[1];
    const queryKey = getGetBeautyJobQueryKey(listingId);
    const queryState = queryClient.getQueryState(queryKey);
    const cachedItem = queryState?.fetchStatus === 'fetching' ? undefined
      : queryClient.getQueryData<Awaited<ReturnType<typeof getBeautyJob>>>(queryKey);
    const cachedError = queryState?.error;
    if (cachedError && !isRetryableBeautyJobDetailError(cachedError)) return null;

    const item = cachedItem ?? await queryClient.fetchQuery({
      queryKey,
      queryFn: () => getBeautyJob(listingId),
      retry: shouldRetryBeautyJobDetail,
    });
    if (!item) return null;
    const title = text(item.title, 'Beauty oglas');
    return {
      title: `${title} | LUMERA Poslovi`,
      structuredData: schema('job', item),
      description: text(item.description, `${title} — beauty oglas na LUMERA platformi.`),
      ...socialImagePayload(item, item.photos?.[0]),
      imageAlt: publicImageAlt({ name: title, category: item.categoryName, city: item.city, description: item.coverImageDescription }),
      indexable: true,
    };
  }
  return null;
}

function listEndpoint(pathname: string): string | undefined {
  if (pathname === '/saloni' || pathname.startsWith('/saloni/kategorija/')) return '/api/salons';
  if (pathname === '/edukacije' || pathname.startsWith('/edukacije/sekcije/')) return '/api/education/public/courses';
  if (pathname === '/poslovi') return '/api/beauty-jobs';
  if (pathname === '/proizvodi') return '/api/suppliers';
  if (['/inspiracija', '/recnik', '/brendovi'].includes(pathname)) return `/api${pathname}`;
  const shop = pathname.match(/^\/shop\/([^/]+)(?:\/(?!proizvod\/).*)?$/);
  if (shop) return `/api/suppliers/${decodeURIComponent(shop[1])}/public-products`;
  return undefined;
}

/** The route's visible detail hook is the request owner, including lazy mounts. */
function detailEndpoint(pathname: string): string | undefined {
  const salon = pathname.match(/^\/saloni\/([^/]+)$/);
  if (salon) return `/api/salons/${decodeURIComponent(salon[1])}`;
  const course = pathname.match(/^\/edukacije\/([0-9a-f-]{36})$/i);
  if (course) return `/api/education/public/courses/${course[1]}`;
  const education = pathname.match(/^\/edukacije\/(paketi|centri|instruktori)\/([^/]+)$/);
  if (education) return education[1] === 'paketi' ? `/api/education/bundles/${education[2]}`
    : education[1] === 'centri' ? `/api/education/public/centers/${education[2]}`
      : `/api/education/instructors/${education[2]}/public`;
  const job = pathname.match(/^\/poslovi\/(?!nalog\/)[^/]+\/([^/]+)$/);
  if (job) return `/api/beauty-jobs/${job[1]}`;
  const product = pathname.match(/^\/proizvodi\/([^/]+)$/);
  if (product) return `/api/shop/public/products/${product[1]}`;
  const supplierProduct = pathname.match(/^\/shop\/([^/]+)\/proizvod\/([^/]+)$/);
  if (supplierProduct) return `/api/suppliers/${supplierProduct[1]}/public-products/${supplierProduct[2]}`;
  return undefined;
}

export function visibleDetailReady(client: QueryClient, endpoint: string): boolean {
  const query = client.getQueryCache().find({ queryKey: [endpoint], exact: true });
  return Boolean(query?.isActive() && query.state.status !== 'pending' && query.state.fetchStatus === 'idle');
}

/**
 * Read the SAME successful query observed by the visible public listing.
 * Placeholder/keepPreviousData lives on observers, never in the new query's
 * successful state. No parallel metadata fetch can invent another result set.
 */
export function listingMetadataSchema(pathname: string, search: string, payload: SeoPayload, client: QueryClient, origin: string): Partial<SeoPayload> {
  const endpoint = listEndpoint(pathname);
  const canonical = payload.canonicalPath ?? listingCanonical(pathname, search);
  const salonCategory = pathname.startsWith('/saloni/kategorija/') ? getPublicCategoryPage(pathname.split('/')[3]) : undefined;
  const heading = salonCategory?.h1
    ?? staticSeoByPath.get(pathname)?.heading ?? payload.title.split(' | ')[0];
  const listName = payload.listName ?? ({
    '/saloni': 'LUMERA saloni', '/edukacije': 'LUMERA beauty edukacije',
    '/poslovi': 'LUMERA Beauty Poslovi', '/proizvodi': 'LUMERA dobavljači beauty proizvoda',
  } as Record<string, string>)[pathname] ?? heading;
  const breadcrumbs = payload.breadcrumbs ?? [{ name: heading, pathname: canonical }];
  if (!endpoint) {
    if (pathname === '/') return { structuredData: buildPageStructuredData('home', { description: payload.description }, { origin, canonical: '/' }) };
    if (staticSeoByPath.has(pathname)) return { structuredData: buildPageStructuredData('static', { name: heading }, { origin, canonical, breadcrumbs }) };
    return {};
  }
  const params = new URLSearchParams(search);
  const expectedCategory = salonCategory?.apiCategory;
  const scopedFilters: Record<string, unknown> = {};
  if (pathname.startsWith('/edukacije/sekcije/')) {
    const [, , , sectionSlug, categorySlug, subcategorySlug] = pathname.split('/');
    const taxonomy: any = client.getQueryData(['/api/education/public/taxonomy']);
    const section = taxonomy?.find((item: any) => item.slug === sectionSlug);
    const category = section?.categories?.find((item: any) => item.slug === categorySlug);
    const subcategory = category?.subcategories?.find((item: any) => item.slug === subcategorySlug);
    if (!section || (categorySlug && !category) || (subcategorySlug && !subcategory)) return { structuredDataPending: true };
    Object.assign(scopedFilters, { sectionId: section.id, categoryId: category?.id, subcategoryId: subcategory?.id });
  }
  if (endpoint.endsWith('/public-products')) {
    const supplierSlug = decodeURIComponent(pathname.split('/')[2]);
    const categoryPath = pathname.split('/').slice(3).map(decodeURIComponent).join('/');
    const categories: any = client.getQueryData([`/api/suppliers/${supplierSlug}/categories`]);
    if (categoryPath) {
      const category = categories?.find((item: any) => item.path === categoryPath && item.active);
      if (!category) return { structuredDataPending: true };
      scopedFilters.categoryId = category.id;
    }
  }
  const candidates = client.getQueryCache?.().findAll({ queryKey: [endpoint] }) ?? [];
  const current = candidates.find((query) => {
    if (!query.isActive()) return false;
    const options = (query.queryKey[1] ?? {}) as Record<string, unknown>;
    if (options.page !== undefined && Number(options.page) !== listingPage(search)) return false;
    if (expectedCategory && options.category !== expectedCategory) return false;
    for (const key of ['city', 'municipality', 'brand', 'q', 'query', 'search', 'region', 'type', 'intent', 'listingMode', 'category', 'minPrice', 'maxPrice', 'priceMax', 'format', 'level', 'language', 'sort', 'sectionId', 'categoryId', 'subcategoryId', 'courseTypeId', 'discountsOnly', 'gender', 'acceptsCards', 'openSunday', 'instantBooking', 'homeService', 'topSalon', 'featured', 'accredited', 'certification', 'minRating', 'minReviewCount', 'availability', 'minDurationMinutes', 'maxDurationMinutes', 'productType', 'needTag']) {
      if (key === 'category' && expectedCategory) continue;
      if (key in scopedFilters) {
        if (options[key] !== scopedFilters[key]) return false;
        continue;
      }
      // Guide search is a local, visible filter with its own observed query.
      if (key === 'query' && ['/inspiracija', '/recnik', '/brendovi'].includes(pathname)) continue;
      const requested = params.get(key);
      if (requested !== null && String(options[key] ?? '') !== requested) return false;
      if (requested === null && options[key] != null && options[key] !== '' && key !== 'sort') return false;
    }
    return true;
  });
  if (!current || current.state.status === 'pending' || current.state.fetchStatus === 'fetching') return { structuredDataPending: true };
  if (current.state.status === 'error') return { structuredData: undefined, indexable: false };
  const data: any = current.state.data;
  const rows: any[] = Array.isArray(data) ? data : data?.items ?? data?.products ?? [];
  const items = rows.filter((item) => endpoint !== '/api/suppliers' || isPublicRetailSupplier(item)).map((item) => {
    if (endpoint === '/api/salons') return { name: item.name, pathname: `/saloni/${item.slug}` };
    if (endpoint === '/api/education/public/courses') return { name: item.title, pathname: `/edukacije/${item.id}` };
    if (endpoint === '/api/beauty-jobs') return { name: item.title, pathname: `/poslovi/${item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'oglas'}/${item.id}` };
    if (endpoint === '/api/suppliers') return { name: item.name, pathname: `/shop/${encodeURIComponent(item.slug)}` };
    if (endpoint.endsWith('/public-products')) return { name: item.name, pathname: `/shop/${pathname.split('/')[2]}/proizvod/${encodeURIComponent(item.id)}` };
    return { name: item.title ?? item.term ?? item.name, pathname: item.salon?.slug ? `/saloni/${item.salon.slug}` : undefined };
  });
  return {
    structuredData: buildPageStructuredData(items.length ? 'list' : 'static', { name: listName, items }, { origin, canonical, breadcrumbs }),
    ...(pathname === '/saloni' && params.has('city') && !items.length ? { indexable: false } : {}),
  };
}

export async function resolvePostMountSeo(
  pathname: string,
  searchString: string,
  queryClient: QueryClient,
  origin?: string,
): Promise<SeoPayload> {
  let payload = staticMetadata(pathname);
  if (!payload) {
    try {
      payload = await dynamicMetadata(pathname, queryClient, origin);
    } catch {
      payload = null;
    }
  }
  if (payload && pathname === '/saloni') {
    const cities = new URLSearchParams(searchString).getAll('city').map((city) => city.trim()).filter(Boolean);
    if (cities.length === 1) {
      const heading = `Saloni ${cityPhrase(cities[0])}`;
      payload = {
        ...payload, title: `${heading} | LUMERA`, listName: heading,
        breadcrumbs: [{ name: heading, pathname: listingCanonical(pathname, searchString) }],
      };
    }
  }
  const resolved = withQueryIndexability(payload ?? {
    title: `${APP_NAME} | Privatna stranica`,
    description: defaultDescription,
    indexable: false,
  }, searchString, pathname);
  return {
    ...resolved,
    ...(payload ? listingMetadataSchema(pathname, searchString, payload, queryClient, origin ?? (typeof document === 'undefined' ? configuredSeoOrigin() : publicSiteOrigin())) : {}),
    canonicalPath: resolved.canonicalPath ?? listingCanonical(pathname, searchString),
  };
}

export function ClientSeoMetadata() {
  const [pathname] = useLocation();
  const searchString = useSearch();
  const queryClient = useQueryClient();
  const lastRoute = useRef(`${pathname}?${searchString}`);
  const preserveInitialSchema = useRef(true);

  useLayoutEffect(() => {
    let cancelled = false;
    let generation = 0;
    let queued = false;
    const route = `${pathname}?${searchString}`;
    if (lastRoute.current !== route) {
      preserveInitialSchema.current = false;
      replacePageStructuredData();
    }
    lastRoute.current = route;
    const refresh = () => {
      const request = ++generation;
      const detail = detailEndpoint(pathname);
      // Metadata can mount before the lazy route bundle. Starting its request
      // then causes the visible hook's refetchOnMount:"always" to issue a second
      // request. Wait for that hook instead; its completion drives subscription.
      if (detail && !visibleDetailReady(queryClient, detail)) {
        if (!preserveInitialSchema.current) replacePageStructuredData();
        return;
      }
      void resolvePostMountSeo(pathname, searchString, queryClient, publicSiteOrigin()).then((payload) => {
      if (!cancelled && request === generation) {
        applySeo(pathname, payload);
        if (!payload.structuredDataPending) {
          preserveInitialSchema.current = false;
          replacePageStructuredData(payload.structuredData);
        } else if (!preserveInitialSchema.current) replacePageStructuredData();
      }
    }).catch(() => {
      if (!cancelled && request === generation) {
        replacePageStructuredData();
        applySeo(pathname, {
        title: `${APP_NAME} | Privatna stranica`,
        description: defaultDescription,
        indexable: false,
      });
      }
    });
    };
    const endpoint = listEndpoint(pathname) ?? detailEndpoint(pathname);
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (!endpoint || event.query.queryKey[0] !== endpoint || queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; if (!cancelled) refresh(); });
    });
    refresh();
    return () => { cancelled = true; unsubscribe(); };
  }, [pathname, queryClient, searchString]);

  return null;
}

/** Remove head AND SSR body scripts before installing the current public DTO. */
export function replacePageStructuredData(value?: unknown, owner: Document = document) {
  owner.querySelectorAll('script[data-lumera-structured-data="current-page"], script#lumera-structured-data, #seo-prerender script[type="application/ld+json"]')
    .forEach((node) => node.remove());
  const data = compactSchema(value);
  if (!data) return;
  const script = owner.createElement('script');
  script.type = 'application/ld+json';
  script.dataset.lumeraStructuredData = 'current-page';
  script.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  owner.head.append(script);
}
