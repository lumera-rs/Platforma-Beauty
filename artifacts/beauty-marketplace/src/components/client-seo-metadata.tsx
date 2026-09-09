import { useEffect } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getBeautyJob, getGetBeautyJobQueryKey } from '@workspace/api-client-react';
import { getPublicCategoryPage } from '@/lib/public-category-pages';
import {
  isRetryableBeautyJobDetailError,
  shouldRetryBeautyJobDetail,
} from '@/lib/beauty-job-detail-query';

type SeoPayload = {
  title: string;
  description: string;
  image?: string;
  indexable: boolean;
  canonicalPath?: string;
};

const APP_NAME = 'LUMERA';
const defaultDescription = 'Pronađite proverene salone, beauty i wellness tretmane i stručne edukacije na jednom mestu uz LUMERA.';

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
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

  const pages: Record<string, SeoPayload> = {
    '/': { title: 'LUMERA | Saloni, tretmani i edukacije', description: defaultDescription, indexable: true },
    '/za-biznise': { title: 'LUMERA Biznis Hub | Poslovna platforma', description: 'Otkrijte sve mogućnosti LUMERA platforme za vaš beauty biznis.', indexable: true },
    '/za-biznise/saloni': { title: 'LUMERA za salone | Operativni sistem', description: 'Sve što vam je potrebno za vođenje i rast vašeg beauty salona.', indexable: true },
    '/za-biznise/edukativni-centri': { title: 'LUMERA za edukativne centre | Infrastruktura', description: 'Infrastruktura za organizaciju i prodaju beauty edukacija.', indexable: true },
    '/za-biznise/poslovi': { title: 'LUMERA Poslovi za biznise | Zapošljavanje', description: 'Pronađite najbolje talente za vaš salon ili edukativni centar.', indexable: true },
    '/za-biznise/edukacije': { title: 'LUMERA Edukacije za biznise | Usavršavanje tima', description: 'Unapredite veštine svog tima kroz B2B beauty edukacije.', indexable: true },
    '/pridruzi-se-edukativni-centar': { title: 'Registracija Edukativnog Centra | LUMERA', description: 'Registrujte svoj edukativni centar na LUMERA platformi.', indexable: false },
    '/saloni': { title: 'Saloni i beauty tretmani | LUMERA', description: 'Istražite salone, wellness centre i beauty tretmane, uporedite ocene i pronađite svoj sledeći termin.', indexable: true },
    '/proizvodi': { title: 'Beauty proizvodi za kupce | LUMERA', description: 'Istražite javno dostupne beauty proizvode sa jasnim cenama i opisima za kupce.', indexable: true },
    '/poslovi': { title: 'Beauty poslovi i oglasi | LUMERA', description: 'Pronađite poslove, freelance angažmane i oglase za iznajmljivanje beauty opreme, prostora i stolica.', indexable: true },
    '/inspiracija': { title: 'Beauty inspiracija | LUMERA vodič', description: 'Ideje za frizure, nokte, negu lica i wellness tretmane iz LUMERA salona.', indexable: true },
    '/recnik': { title: 'Rečnik beauty pojmova | LUMERA', description: 'Jasna objašnjenja beauty tretmana, tehnika i profesionalnih pojmova pre zakazivanja.', indexable: true },
    '/brendovi': { title: 'Profesionalni beauty brendovi | LUMERA', description: 'Pronađite salone prema profesionalnim brendovima i proizvodima koje koriste.', indexable: true },
    '/edukacije': { title: 'Beauty edukacije i kursevi | LUMERA', description: 'Pronađite stručne beauty edukacije, praktične kurseve i sertifikovane programs.', indexable: true },
    '/provera-statusa': { title: 'Provera statusa porudžbine | LUMERA', description: 'Pratite status vaše porudžbine i saznajte kada stiže.', indexable: false },
    '/porudzbina/pracenje': { title: 'Praćenje porudžbine | LUMERA', description: 'Pratite status vaše porudžbine.', indexable: false },
    '/uslovi-koriscenja': { title: 'Uslovi korišćenja | LUMERA', description: 'Uslovi korišćenja LUMERA platforme.', indexable: true },
    '/politika-privatnosti': { title: 'Politika privatnosti | LUMERA', description: 'Kako LUMERA obrađuje i štiti podatke korisnika.', indexable: true },
    '/politika-kolacica': { title: 'Politika kolačića | LUMERA', description: 'Informacije o korišćenju kolačića na LUMERA platformi.', indexable: true },
    '/uslovi-kupovine': { title: 'Uslovi kupovine | LUMERA', description: 'Uslovi kupovine edukacija i usluga putem LUMERA platforme.', indexable: true },
    '/otkazivanje-termina': { title: 'Otkazivanje termina | LUMERA', description: 'Pravila i smernice za otkazivanje zakazanih termina.', indexable: true },
    '/povracaj-sredstava': { title: 'Povraćaj sredstava | LUMERA', description: 'Informacije o refundacijama i zaštiti kupovine na LUMERA platformi.', indexable: true },
  };
  return pages[pathname] ?? null;
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

function applySeo(pathname: string, payload: SeoPayload) {
  const origin = window.location.origin;
  const cleanPathname = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname;
  const canonical = `${origin}${payload.canonicalPath ?? cleanPathname}`;
  const image = payload.image ? new URL(payload.image, origin).href : `${origin}/og-lumera.svg`;
  document.title = payload.title;
  setMeta('meta[name="description"]', 'name', 'description', payload.description);
  setMeta('meta[name="robots"]', 'name', 'robots', payload.indexable ? 'index, follow' : 'noindex, follow');
  setMeta('meta[property="og:title"]', 'property', 'og:title', payload.title);
  setMeta('meta[property="og:description"]', 'property', 'og:description', payload.description);
  setMeta('meta[property="og:url"]', 'property', 'og:url', canonical);
  setMeta('meta[property="og:image"]', 'property', 'og:image', image);
  setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', payload.title);
  setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', payload.description);
  setMeta('meta[name="twitter:image"]', 'name', 'twitter:image', image);
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.append(link);
  }
  link.href = canonical;
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

export function ClientSeoMetadata() {
  const [pathname] = useLocation();
  const searchString = useSearch();
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    const fallback = staticMetadata(pathname);
    if (fallback) {
      applySeo(pathname, withQueryIndexability(fallback, searchString));
      return;
    }
    void dynamicMetadata(pathname, queryClient).then((payload) => {
      if (!cancelled) applySeo(pathname, payload ? withQueryIndexability(payload, searchString) : {
        title: `${APP_NAME} | Privatna stranica`,
        description: defaultDescription,
        indexable: false,
      });
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
