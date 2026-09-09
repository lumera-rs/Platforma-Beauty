import { useEffect } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getBeautyJob, getGetBeautyJobQueryKey } from '@workspace/api-client-react';
import { getPublicCategoryPage } from '@/lib/public-category-pages';
import staticSeoPages from '@/lib/static-seo-pages.json';
import {
  isRetryableBeautyJobDetailError,
  shouldRetryBeautyJobDetail,
} from '@/lib/beauty-job-detail-query';

export type SeoPayload = {
  title: string;
  description: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageType?: string;
  indexable: boolean;
  canonicalPath?: string;
};

export type SeoHeadMetadata = {
  title: string;
  description: string;
  canonical: string;
  robots: 'index, follow' | 'noindex, follow';
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

function imageTypeFromUrl(value: string): string | undefined {
  try {
    const extension = new URL(value, 'https://lumera.invalid').pathname.toLowerCase().match(/\.(avif|jpe?g|png|svg|webp)$/)?.[1];
    return ({ avif: 'image/avif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp' } as const)[extension as keyof typeof MIME_BY_EXTENSION];
  } catch {
    return undefined;
  }
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
export function seoHeadMetadata(pathname: string, payload: SeoPayload, origin: string): SeoHeadMetadata {
  const publicPath = payload.canonicalPath ?? pathname;
  const cleanPublicPath = publicPath !== '/' ? publicPath.replace(/\/+$/, '') : publicPath;
  const canonical = new URL(cleanPublicPath, origin).href;
  const image = payload.image ? new URL(payload.image, origin).href : `${origin}/og-lumera.png`;
  const title = clip(payload.title, 60);
  const description = clip(payload.description);
  const imageAlt = payload.image ? title : defaultImageAlt;
  const imageWidth = payload.imageWidth ?? (!payload.image ? defaultImageMetadata.width : undefined);
  const imageHeight = payload.imageHeight ?? (!payload.image ? defaultImageMetadata.height : undefined);
  const imageType = payload.imageType ?? (!payload.image ? defaultImageMetadata.type : imageTypeFromUrl(payload.image));
  return {
    title,
    description,
    canonical,
    robots: payload.indexable ? 'index, follow' : 'noindex, follow',
    image,
    imageAlt,
    openGraph: { title, description, url: canonical, image, imageAlt, imageWidth, imageHeight, imageType },
    twitter: { title, description, url: canonical, image, imageAlt },
  };
}

export function applySeo(pathname: string, payload: SeoPayload) {
  const metadata = seoHeadMetadata(pathname, payload, window.location.origin);
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

export function withQueryIndexability(payload: SeoPayload, searchString: string): SeoPayload {
  return { ...payload, indexable: payload.indexable && searchString.length === 0 };
}

export async function dynamicMetadata(pathname: string, queryClient: QueryClient): Promise<SeoPayload | null> {
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
      image: item.images?.[0] ?? item.imageUrl,
      indexable: true,
      canonicalPath: `/shop/${encodeURIComponent(canonicalSupplierSlug)}/proizvod/${encodeURIComponent(canonicalProductId)}`,
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
      image: supplier.logoUrl,
      indexable: true,
      canonicalPath: `/shop/${encodeURIComponent(canonicalSupplierSlug)}${canonicalCategoryPath}`,
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
      description: text(item.description, `${name} — javno dostupan beauty proizvod na LUMERA platformi.`),
      image: item.images?.[0] ?? item.imageUrl,
      indexable: true,
    };
  }
  const salon = pathname.match(/^\/saloni\/([^/]+)$/);
  if (salon) {
    const response = await fetch(`/api/salons/${encodeURIComponent(salon[1])}`);
    if (!response.ok) return null;
    const item = await response.json();
    const name = text(item.name, 'Salon');
    const city = text(item.city, 'Srbiji');
    return {
      title: `${name} u ${city} | LUMERA`,
      description: text(item.description, text(item.shortDescription, `${name} — salon i beauty tretmani u gradu ${city}.`)),
      image: item.gallery?.[0] ?? item.imageUrl,
      indexable: true,
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
      description: text(item.description, `${title} — stručna beauty edukacija na LUMERA platformi.`),
      image: item.imageUrl,
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
    return { title: `${name} | LUMERA edukacije`, description: text(item.description, `Kursevi i edukacije centra ${name}.`), image: item.imageUrl, indexable: true };
  }
  const instructor = pathname.match(/^\/edukacije\/instruktori\/([a-zA-Z0-9-]+)$/);
  if (instructor) {
    const response = await fetch(`/api/education/instructors/${encodeURIComponent(instructor[1])}/public`);
    if (!response.ok) return null;
    const item = await response.json();
    const name = text(item.name, 'Instruktor');
    return { title: `${name} | LUMERA edukacije`, description: text(item.biography, `Upoznajte instruktora ${name} i dostupne beauty edukacije.`), image: item.photoUrl, indexable: true };
  }
  if (pathname === '/poslovi/nalog' || pathname.startsWith('/poslovi/nalog/')) {
    return null;
  }
  const beautyJob = pathname.match(/^\/poslovi\/[^/]+\/([a-zA-Z0-9-]+)$/);
  if (beautyJob) {
    const listingId = beautyJob[1];
    const queryKey = getGetBeautyJobQueryKey(listingId);
    const cachedItem = queryClient.getQueryData<Awaited<ReturnType<typeof getBeautyJob>>>(queryKey);
    const cachedError = queryClient.getQueryState(queryKey)?.error;
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
      description: text(item.description, `${title} — beauty oglas na LUMERA platformi.`),
      image: item.photos?.[0],
      indexable: true,
    };
  }
  return null;
}

export async function resolvePostMountSeo(
  pathname: string,
  searchString: string,
  queryClient: QueryClient,
): Promise<SeoPayload> {
  let payload = staticMetadata(pathname);
  if (!payload) {
    try {
      payload = await dynamicMetadata(pathname, queryClient);
    } catch {
      payload = null;
    }
  }
  return withQueryIndexability(payload ?? {
    title: `${APP_NAME} | Privatna stranica`,
    description: defaultDescription,
    indexable: false,
  }, searchString);
}

export function ClientSeoMetadata() {
  const [pathname] = useLocation();
  const searchString = useSearch();
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    void resolvePostMountSeo(pathname, searchString, queryClient).then((payload) => {
      if (!cancelled) applySeo(pathname, payload);
    }).catch(() => {
      if (!cancelled) applySeo(pathname, {
        title: `${APP_NAME} | Privatna stranica`,
        description: defaultDescription,
        indexable: false,
      });
    });
    return () => { cancelled = true; };
  }, [pathname, queryClient, searchString]);

  return null;
}

const MIME_BY_EXTENSION = {
  avif: 'image/avif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
} as const;
