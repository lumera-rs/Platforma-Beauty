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
};

const APP_NAME = 'LUMERA';
const defaultDescription = 'Pronađite proverene salone, beauty i wellness tretmane i stručne edukacije na jednom mestu uz LUMERA.';

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
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
    '/edukacije': { title: 'Beauty edukacije i kursevi | LUMERA', description: 'Pronađite stručne beauty edukacije, praktične kurseve i sertifikovane programe.', indexable: true },
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
  const canonical = `${origin}${pathname}`;
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

async function dynamicMetadata(pathname: string, queryClient: QueryClient): Promise<SeoPayload | null> {
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
  const course = pathname.match(/^\/edukacije\/([a-zA-Z0-9-]+)$/);
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
      applySeo(pathname, { ...fallback, indexable: fallback.indexable && searchString.length === 0 });
      return;
    }
    void dynamicMetadata(pathname, queryClient).then((payload) => {
      if (!cancelled) applySeo(pathname, payload ? {
        ...payload,
        indexable: payload.indexable && searchString.length === 0,
      } : {
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
