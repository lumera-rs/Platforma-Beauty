import { createReadStream, existsSync, promises as fs, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import categoryDefinitions from './src/lib/public-category-pages.json' with { type: 'json' };
import legalPages from './src/content/legal-pages.json' with { type: 'json' };

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, 'dist', 'public');
const fallbackDescription = 'Pronađite proverene salone, beauty i wellness tretmane i stručne edukacije na jednom mestu uz LUMERA.';
const categoryPages = new Map(categoryDefinitions.map((page) => [page.path, page]));
const legalPageByPath = new Map(legalPages.map((page) => [page.path, page]));
const staticPages = new Map([
  ['/', ['LUMERA | Saloni, tretmani i edukacije', fallbackDescription, 'Pronađite salon, tretman ili beauty edukaciju koja vam odgovara.']],
  ['/za-biznise', ['LUMERA Biznis Hub | Poslovna platforma', 'Otkrijte sve mogućnosti LUMERA platforme za vaš beauty biznis.', 'LUMERA Biznis Hub']],
  ['/za-biznise/saloni', ['LUMERA za salone | Operativni sistem', 'Sve što vam je potrebno za vođenje i rast vašeg beauty salona.', 'LUMERA za salone']],
  ['/za-biznise/edukativni-centri', ['LUMERA za edukativne centre | Infrastruktura', 'Infrastruktura za organizaciju i prodaju beauty edukacija.', 'LUMERA za edukativne centre']],
  ['/za-biznise/poslovi', ['LUMERA Poslovi za biznise | Zapošljavanje', 'Pronađite najbolje talente za vaš salon ili edukativni centar.', 'LUMERA Poslovi za biznise']],
  ['/za-biznise/edukacije', ['LUMERA Edukacije za biznise | Usavršavanje tima', 'Unapredite veštine svog tima kroz B2B beauty edukacije.', 'LUMERA Edukacije za biznise']],
  ['/pridruzi-se-edukativni-centar', ['Registracija Edukativnog Centra | LUMERA', 'Registrujte svoj edukativni centar na LUMERA platformi.', 'Registracija Edukativnog Centra']],
  ['/saloni', ['Saloni i beauty tretmani | LUMERA', 'Istražite salone, wellness centre i beauty tretmane, uporedite ocene i pronađite svoj sledeći termin.', 'Pronađite salon i tretman koji vam odgovaraju.']],
  ['/proizvodi', ['Beauty proizvodi za kupce | LUMERA', 'Istražite javno dostupne beauty proizvode sa jasnim cenama i opisima za kupce.', 'Beauty proizvodi za kupce']],
  ['/poslovi', ['Beauty poslovi i oglasi | LUMERA', 'Pronađite poslove, freelance angažmane i oglase za iznajmljivanje beauty opreme, prostora i stolica.', 'Beauty poslovi, angažmani i iznajmljivanje']],
  ['/inspiracija', ['Beauty inspiracija | LUMERA vodič', 'Ideje za frizure, nokte, negu lica i wellness tretmane iz LUMERA salona.', 'Inspiracija za sledeći beauty termin.']],
  ['/recnik', ['Rečnik beauty pojmova | LUMERA', 'Jasna objašnjenja beauty tretmana, tehnika i profesionalnih pojmova pre zakazivanja.', 'Jasna objašnjenja beauty pojmova.']],
  ['/brendovi', ['Profesionalni beauty brendovi | LUMERA', 'Pronađite salone prema profesionalnim brendovima i proizvodima koje koriste.', 'Profesionalni brendovi koje koriste LUMERA saloni.']],
  ['/edukacije', ['Beauty edukacije i kursevi | LUMERA', 'Pronađite stručne beauty edukacije, praktične kurseve i sertifikovane programe.', 'Stručni kursevi i beauty edukacije.']],
  ['/uslovi-koriscenja', ['Uslovi korišćenja | LUMERA', 'Uslovi korišćenja LUMERA platforme.', 'Uslovi korišćenja']],
  ['/politika-privatnosti', ['Politika privatnosti | LUMERA', 'Kako LUMERA obrađuje i štiti podatke korisnika.', 'Kako štitimo privatnost korisnika.']],
  ['/politika-kolacica', ['Politika kolačića | LUMERA', 'Informacije o korišćenju kolačića na LUMERA platformi.', 'Informacije o kolačićima.']],
  ['/uslovi-kupovine', ['Uslovi kupovine | LUMERA', 'Uslovi kupovine edukacija i usluga putem LUMERA platforme.', 'Uslovi kupovine na LUMERA platformi.']],
  ['/otkazivanje-termina', ['Otkazivanje termina | LUMERA', 'Pravila i smernice za otkazivanje zakazanih termina.', 'Pravila otkazivanja termina.']],
  ['/povracaj-sredstava', ['Povraćaj sredstava | LUMERA', 'Informacije o refundacijama i zaštiti kupovine na LUMERA platformi.', 'Informacije o povraćaju sredstava.']],
]);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function clip(value, limit = 158) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function asAbsolute(origin, value) {
  try { return new URL(value || '/og-lumera.svg', origin).href; } catch { return `${origin}/og-lumera.svg`; }
}

function requestOrigin(req) {
  const configured = process.env.LUMERA_PUBLIC_URL;
  if (configured) {
    const parsed = new URL(configured);
    if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('LUMERA_PUBLIC_URL must be an HTTPS origin without a path, query, or hash.');
    }
    return parsed.origin;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('LUMERA_PUBLIC_URL must be configured in production.');
  }
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0];
  return `${proto}://${host}`;
}

function apiOrigin(req) {
  const configured = process.env.LUMERA_SEO_API_ORIGIN;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('LUMERA_SEO_API_ORIGIN must be configured in production.');
  }
  return 'http://127.0.0.1:8080';
}

async function getJson(req, pathname) {
  const response = await fetch(new URL(pathname, apiOrigin(req)), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  return response.json();
}

async function listAll(req, endpoint, pageSize) {
  const result = [];
  for (let page = 1; page <= 100; page += 1) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const payload = await getJson(req, `${endpoint}${separator}page=${page}&pageSize=${pageSize}`);
    const rows = Array.isArray(payload) ? payload : payload?.items;
    if (!Array.isArray(rows) || !rows.length) break;
    result.push(...rows);
    if (rows.length < pageSize) break;
  }
  return result;
}

function pageShell(meta, body, origin) {
  const canonical = `${origin}${meta.pathname}`;
  const image = asAbsolute(origin, meta.image);
  const robots = meta.indexable ? 'index, follow' : 'noindex, follow';
  const jsonLd = meta.schema ? `<script type="application/ld+json">${JSON.stringify(meta.schema).replace(/</g, '\\u003c')}</script>` : '';
  return `<main id="seo-prerender" aria-label="LUMERA sadržaj">
    <style>#seo-prerender{font-family:Inter,Arial,sans-serif;color:#261c2a;max-width:1120px;margin:0 auto;padding:36px 20px;line-height:1.55}#seo-prerender a{color:#7c3156;text-decoration:underline}#seo-prerender .seo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}#seo-prerender article{border:1px solid #eadfe5;border-radius:14px;padding:18px;background:#fff}#seo-prerender img{max-width:100%;height:auto;border-radius:10px}#seo-prerender .seo-kicker{color:#7c3156;font-weight:700;text-transform:uppercase;font-size:.8rem;letter-spacing:.08em}@media(min-width:700px){#seo-prerender{padding:64px 30px}}html[data-app-ready="true"] #seo-prerender{display:none}</style>
    <header><p class="seo-kicker">LUMERA</p><nav aria-label="Glavna navigacija"><a href="/">Početna</a> · <a href="/saloni">Saloni</a> · <a href="/edukacije">Edukacije</a> · <a href="/poslovi">Poslovi</a> · <a href="/inspiracija">Inspiracija</a></nav></header>
    ${body}
    <footer><p><a href="/uslovi-koriscenja">Uslovi korišćenja</a> · <a href="/politika-privatnosti">Privatnost</a> · <a href="/politika-kolacica">Kolačići</a></p></footer>
  </main>`;
}

function makeMeta(pathname, title, description, options = {}) {
  return {
    pathname,
    title: clip(title, 60),
    description: clip(description),
    image: options.image ?? '/og-lumera.svg',
    indexable: options.indexable ?? true,
    schema: options.schema,
  };
}

function card({ href, title, description, image, detail }) {
  return `<article>${image ? `<img src="${escapeHtml(image)}" width="640" height="400" alt="${escapeHtml(title)}">` : ''}<h2><a href="${escapeHtml(href)}">${escapeHtml(title)}</a></h2>${description ? `<p>${escapeHtml(clip(description, 220))}</p>` : ''}${detail ? `<p>${escapeHtml(detail)}</p>` : ''}</article>`;
}

function isPublicRetailSupplier(supplier) {
  return Boolean(supplier?.active && (supplier.scope === 'B2C' || supplier.scope === 'BOTH'));
}

function supplierDescription(supplier) {
  return supplier.description || `Istražite javnu ponudu beauty proizvoda dobavljača ${supplier.name} na LUMERA platformi.`;
}

function breadcrumbs(origin, items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${origin}${item.pathname}`,
    })),
  };
}

function breadcrumbHtml(items) {
  return `<nav aria-label="Putanja">${items.map((item) => `<a href="${escapeHtml(item.pathname)}">${escapeHtml(item.name)}</a>`).join(' · ')}</nav>`;
}

function supplierProductCard(product, supplierSlug) {
  return card({
    href: `/shop/${encodeURIComponent(supplierSlug)}/proizvod/${encodeURIComponent(product.id)}`,
    title: product.name,
    description: product.description,
    image: product.imageUrl,
    detail: `${product.discountPrice ?? product.price} RSD`,
  });
}

function beautyJobTypeLabel(type) {
  return ({ job: 'Posao', freelance: 'Freelance angažman', equipment_rental: 'Iznajmljivanje opreme', space_rental: 'Iznajmljivanje prostora ili stolice' })[type] ?? 'Beauty oglas';
}

function beautyJobIntentLabel(intent) {
  return intent === 'seeking' ? 'Tražim' : 'Nudim';
}

function beautyJobSlug(job) {
  if (typeof job?.slug === 'string' && job.slug.trim()) return job.slug.trim();
  return String(job?.title ?? 'oglas')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'oglas';
}

function beautyJobSchema(job, origin, pathname) {
  if (job.type === 'job') {
    const salary = job.priceAmount ? {
      '@type': 'MonetaryAmount',
      currency: 'RSD',
      value: {
        '@type': 'QuantitativeValue',
        value: job.priceAmount,
        unitText: String(job.pricePeriod ?? 'month').toUpperCase(),
      },
    } : undefined;
    return {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: job.title,
      description: job.description,
      datePosted: job.createdAt,
      validThrough: job.expiresAt,
      hiringOrganization: { '@type': 'Organization', name: job.authorDisplayName || 'LUMERA oglašivač' },
      jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: job.city, addressRegion: job.region, addressCountry: 'RS' } },
      baseSalary: salary,
      url: `${origin}${pathname}`,
    };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'Offer',
    name: job.title,
    description: job.description,
    url: `${origin}${pathname}`,
    priceCurrency: job.priceAmount ? 'RSD' : undefined,
    price: job.priceAmount ? String(job.priceAmount) : undefined,
    areaServed: { '@type': 'AdministrativeArea', name: `${job.city}, ${job.region}` },
    itemOffered: { '@type': 'Service', name: beautyJobTypeLabel(job.type) },
    availabilityEnds: job.expiresAt,
  };
}

async function renderPublicPage(req, pathname) {
  const origin = requestOrigin(req);
  const staticPage = staticPages.get(pathname);
  if (staticPage) {
    const [title, description, heading = title.replace(/\s*\|\s*LUMERA$/, '')] = staticPage;
    if (pathname === '/') {
      const salons = await getJson(req, '/api/salons?page=1&pageSize=6') ?? [];
      const salonCards = salons.slice(0, 6).map((salon) => card({ href: `/saloni/${salon.slug}`, title: salon.name, description: salon.shortDescription, image: salon.imageUrl, detail: `${salon.city} · Ocena ${salon.rating}` })).join('');
      const meta = makeMeta(pathname, title, description, { schema: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'LUMERA', url: origin, description } });
      return { meta, html: pageShell(meta, `<section><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(description)}</p><p><a href="/saloni">Istražite sve salone i tretmane</a> · <a href="/edukacije">Pogledajte beauty edukacije</a></p></section><section><h2>Izdvojeni saloni</h2><div class="seo-grid">${salonCards || '<p>Saloni će uskoro biti dostupni.</p>'}</div></section>`, origin) };
    }
    if (pathname === '/saloni') {
      const salons = await getJson(req, '/api/salons?page=1&pageSize=24') ?? [];
      const meta = makeMeta(pathname, title, description, { schema: { '@context': 'https://schema.org', '@type': 'ItemList', name: 'LUMERA saloni', itemListElement: salons.map((salon, index) => ({ '@type': 'ListItem', position: index + 1, url: `${origin}/saloni/${salon.slug}`, name: salon.name })) } });
      const cards = salons.map((salon) => card({ href: `/saloni/${salon.slug}`, title: salon.name, description: salon.shortDescription, image: salon.imageUrl, detail: `${salon.city} · Ocena ${salon.rating} (${salon.reviewCount} recenzija)` })).join('');
      return { meta, html: pageShell(meta, `<section><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(description)}</p></section><section><h2>Dostupni saloni</h2><div class="seo-grid">${cards || '<p>Trenutno nema dostupnih salona.</p>'}</div></section>`, origin) };
    }
    if (pathname === '/proizvodi') {
      const suppliers = (await getJson(req, '/api/suppliers') ?? []).filter(isPublicRetailSupplier);
      const meta = makeMeta(pathname, title, description, {
        schema: {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'LUMERA dobavljači beauty proizvoda',
          itemListElement: suppliers.map((supplier, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: `${origin}/shop/${encodeURIComponent(supplier.slug)}`,
            name: supplier.name,
          })),
        },
      });
      const cards = suppliers.map((supplier) => card({
        href: `/shop/${encodeURIComponent(supplier.slug)}`,
        title: supplier.name,
        description: supplierDescription(supplier),
        image: supplier.logoUrl,
        detail: 'Pogledajte javnu ponudu',
      })).join('');
      return { meta, html: pageShell(meta, `<section><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(description)}</p></section><section><h2>Aktivni dobavljači</h2><div class="seo-grid">${cards || '<p>Trenutno nema javno dostupnih dobavljača.</p>'}</div></section>`, origin) };
    }
    if (pathname === '/poslovi') {
      const jobs = (await getJson(req, '/api/beauty-jobs?page=1&pageSize=24&sort=newest'))?.items ?? [];
      const meta = makeMeta(pathname, title, description, {
        schema: {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'LUMERA Beauty Poslovi',
          itemListElement: jobs.map((job, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: `${origin}/poslovi/${encodeURIComponent(beautyJobSlug(job))}/${encodeURIComponent(job.id)}`,
            name: job.title,
          })),
        },
      });
      const cards = jobs.map((job) => card({
        href: `/poslovi/${encodeURIComponent(beautyJobSlug(job))}/${encodeURIComponent(job.id)}`,
        title: job.title,
        description: job.description,
        image: job.photos?.[0],
        detail: `${beautyJobIntentLabel(job.intent)} · ${beautyJobTypeLabel(job.type)} · ${job.city}, ${job.region}`,
      })).join('');
      return { meta, html: pageShell(meta, `<section><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(description)}</p></section><section><h2>Aktuelni oglasi</h2><div class="seo-grid">${cards || '<p>Trenutno nema aktivnih oglasa.</p>'}</div></section>`, origin) };
    }
    if (pathname === '/edukacije') {
      const courses = await getJson(req, '/api/education/public/courses?page=1&pageSize=24') ?? [];
      const meta = makeMeta(pathname, title, description);
      const cards = courses.map((course) => card({ href: `/edukacije/${course.id}`, title: course.title, description: course.description || `${course.category} · ${course.duration}`, image: course.imageUrl, detail: `${course.publisher} · ${course.price} RSD` })).join('');
      return { meta, html: pageShell(meta, `<section><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(description)}</p></section><section><h2>Dostupne edukacije</h2><div class="seo-grid">${cards || '<p>Trenutno nema dostupnih edukacija.</p>'}</div></section>`, origin) };
    }
    if (['/inspiracija', '/recnik', '/brendovi'].includes(pathname)) {
      const endpoint = pathname === '/inspiracija' ? '/api/inspiracija' : pathname === '/recnik' ? '/api/recnik' : '/api/brendovi';
      const items = await getJson(req, endpoint) ?? [];
      const cards = items.slice(0, 30).map((item) => card({ href: item.salon?.slug ? `/saloni/${item.salon.slug}` : '/saloni', title: item.title ?? item.term ?? item.name, description: item.definition ?? item.description, image: pathname === '/inspiracija' ? item.imageUrl : undefined, detail: item.salon?.name ?? item.category })).join('');
      const meta = makeMeta(pathname, title, description);
      return { meta, html: pageShell(meta, `<section><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(description)}</p></section><section><h2>Sadržaj vodiča</h2><div class="seo-grid">${cards || '<p>Vodič je trenutno prazan.</p>'}</div></section>`, origin) };
    }
    const legalPage = legalPageByPath.get(pathname);
    const meta = makeMeta(pathname, title, description, { indexable: pathname !== '/pridruzi-se-edukativni-centar' });
    if (legalPage) {
      const sections = legalPage.sections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2>${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</section>`).join('');
      return { meta, html: pageShell(meta, `<article><h1>${escapeHtml(legalPage.title)}</h1><p>${escapeHtml(legalPage.lead)}</p><p><strong>Poslednje ažuriranje:</strong> ${escapeHtml(legalPage.lastUpdated)}</p><p><strong>Radna pravna verzija:</strong> tekst mora biti potvrđen od strane odgovornog pravnog lica i pravnog savetnika pre komercijalnog lansiranja.</p>${sections}</article>`, origin) };
    }
    return { meta, html: pageShell(meta, `<article><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(description)}</p><p>Za dodatne informacije pogledajte <a href="/saloni">javni katalog salona</a> ili <a href="/edukacije">beauty edukacije</a>.</p></article>`, origin) };
  }

  const categoryPage = categoryPages.get(pathname);
  if (categoryPage) {
    const salons = await getJson(req, `/api/salons?category=${encodeURIComponent(categoryPage.apiCategory)}&page=1&pageSize=24`) ?? [];
    const meta = makeMeta(pathname, categoryPage.title, categoryPage.description, {
      schema: {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: categoryPage.h1,
        itemListElement: salons.map((salon, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${origin}/saloni/${salon.slug}`,
          name: salon.name,
        })),
      },
    });
    const cards = salons.map((salon) => card({
      href: `/saloni/${salon.slug}`,
      title: salon.name,
      description: salon.shortDescription,
      image: salon.imageUrl,
      detail: `${salon.city} · Ocena ${salon.rating} (${salon.reviewCount} recenzija)`,
    })).join('');
    return {
      meta,
      html: pageShell(meta, `<section><h1>${escapeHtml(categoryPage.h1)}</h1><p>${escapeHtml(categoryPage.description)}</p><p>${escapeHtml(categoryPage.intro)}</p></section><section><h2>${escapeHtml(categoryPage.label)}</h2><div class="seo-grid">${cards || '<p>Trenutno nema dostupnih salona u ovoj kategoriji.</p>'}</div></section>`, origin),
    };
  }

  const supplierProductMatch = pathname.match(/^\/shop\/([^/]+)\/proizvod\/([^/]+)$/);
  if (supplierProductMatch) {
    const supplierSlug = decodeURIComponent(supplierProductMatch[1]);
    const productId = decodeURIComponent(supplierProductMatch[2]);
    const [supplier, product] = await Promise.all([
      getJson(req, `/api/suppliers/${encodeURIComponent(supplierSlug)}`),
      getJson(req, `/api/suppliers/${encodeURIComponent(supplierSlug)}/public-products/${encodeURIComponent(productId)}`),
    ]);
    if (!isPublicRetailSupplier(supplier) || !product) return null;
    const description = product.description || `${product.name} — javno dostupan beauty proizvod na LUMERA platformi.`;
    const price = product.discountPrice ?? product.price;
    const canonicalPath = `/shop/${encodeURIComponent(supplier.slug)}/proizvod/${encodeURIComponent(product.id)}`;
    const crumbs = [
      { name: 'Proizvodi', pathname: '/proizvodi' },
      { name: supplier.name, pathname: `/shop/${encodeURIComponent(supplier.slug)}` },
      { name: product.name, pathname: canonicalPath },
    ];
    const meta = makeMeta(canonicalPath, `${product.name} | ${supplier.name}`, description, {
      image: product.images?.[0] ?? product.imageUrl,
      schema: {
        '@context': 'https://schema.org',
        '@graph': [{
          '@type': 'Product',
          name: product.name,
          description,
          image: asAbsolute(origin, product.images?.[0] ?? product.imageUrl),
          brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
          category: product.category,
          offers: {
            '@type': 'Offer',
            priceCurrency: 'RSD',
            price: String(price),
            availability: 'https://schema.org/InStock',
            url: `${origin}${canonicalPath}`,
          },
        }, breadcrumbs(origin, crumbs)],
      },
    });
    return {
      meta,
      html: pageShell(meta, `<article>${breadcrumbHtml(crumbs)}<h1>${escapeHtml(product.name)}</h1><p>${escapeHtml(description)}</p>${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" width="960" height="720" alt="${escapeHtml(product.name)}">` : ''}<p><strong>Cena: ${escapeHtml(price)} RSD</strong></p><p>${escapeHtml(product.category)}${product.brand ? ` · ${escapeHtml(product.brand)}` : ''}</p><p><a href="/shop/${escapeHtml(encodeURIComponent(supplier.slug))}">Svi proizvodi dobavljača ${escapeHtml(supplier.name)}</a></p></article>`, origin),
    };
  }

  const supplierShopMatch = pathname.match(/^\/shop\/([^/]+)(?:\/(.+))?$/);
  if (supplierShopMatch) {
    const supplierSlug = decodeURIComponent(supplierShopMatch[1]);
    const categoryPath = supplierShopMatch[2] ? supplierShopMatch[2].split('/').map(decodeURIComponent).join('/') : '';
    const [supplier, categories] = await Promise.all([
      getJson(req, `/api/suppliers/${encodeURIComponent(supplierSlug)}`),
      getJson(req, `/api/suppliers/${encodeURIComponent(supplierSlug)}/categories`),
    ]);
    if (!isPublicRetailSupplier(supplier) || !Array.isArray(categories)) return null;
    const category = categoryPath ? categories.find((item) => item.active && item.path === categoryPath) : null;
    if (categoryPath && !category) return null;
    const productsEndpoint = `/api/suppliers/${encodeURIComponent(supplier.slug)}/public-products?page=1&pageSize=24${category ? `&categoryId=${encodeURIComponent(category.id)}` : ''}`;
    const products = (await getJson(req, productsEndpoint))?.items ?? [];
    const canonicalPath = category
      ? `/shop/${encodeURIComponent(supplier.slug)}/${category.path.split('/').map(encodeURIComponent).join('/')}`
      : `/shop/${encodeURIComponent(supplier.slug)}`;
    const title = category ? `${category.name} | ${supplier.name}` : `${supplier.name} | Beauty proizvodi`;
    const description = category
      ? `${category.name} dobavljača ${supplier.name}. Pogledajte javno dostupne beauty proizvode, opise i cene za kupce.`
      : supplierDescription(supplier);
    const pathParts = category ? category.path.split('/') : [];
    const categoryCrumbs = pathParts.map((_, index) => {
      const pathValue = pathParts.slice(0, index + 1).join('/');
      const match = categories.find((item) => item.path === pathValue);
      return match ? {
        name: match.name,
        pathname: `/shop/${encodeURIComponent(supplier.slug)}/${pathValue.split('/').map(encodeURIComponent).join('/')}`,
      } : null;
    }).filter(Boolean);
    const crumbs = [
      { name: 'Proizvodi', pathname: '/proizvodi' },
      { name: supplier.name, pathname: `/shop/${encodeURIComponent(supplier.slug)}` },
      ...categoryCrumbs,
    ];
    const meta = makeMeta(canonicalPath, title, description, {
      image: supplier.logoUrl,
      schema: {
        '@context': 'https://schema.org',
        '@graph': [{
          '@type': 'ItemList',
          name: category ? `${category.name} — ${supplier.name}` : `${supplier.name} proizvodi`,
          itemListElement: products.map((product, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: `${origin}/shop/${encodeURIComponent(supplier.slug)}/proizvod/${encodeURIComponent(product.id)}`,
            name: product.name,
          })),
        }, breadcrumbs(origin, crumbs)],
      },
    });
    const cards = products.map((product) => supplierProductCard(product, supplier.slug)).join('');
    const categoryLinks = !category ? categories.filter((item) => item.active).map((item) =>
      `<li><a href="/shop/${escapeHtml(encodeURIComponent(supplier.slug))}/${item.path.split('/').map((part) => escapeHtml(encodeURIComponent(part))).join('/')}">${escapeHtml(item.name)}</a></li>`).join('') : '';
    return {
      meta,
      html: pageShell(meta, `<section>${breadcrumbHtml(crumbs)}<h1>${escapeHtml(category ? `${category.name} — ${supplier.name}` : supplier.name)}</h1><p>${escapeHtml(description)}</p>${categoryLinks ? `<nav aria-label="Kategorije"><h2>Kategorije</h2><ul>${categoryLinks}</ul></nav>` : ''}</section><section><h2>${category ? `Proizvodi u kategoriji ${escapeHtml(category.name)}` : 'Javno dostupni proizvodi'}</h2><div class="seo-grid">${cards || '<p>Trenutno nema javno dostupnih proizvoda.</p>'}</div></section>`, origin),
    };
  }

  const beautyJobMatch = pathname.match(/^\/poslovi\/[^/]+\/([a-zA-Z0-9-]+)$/);
  if (beautyJobMatch) {
    const job = await getJson(req, `/api/beauty-jobs/${encodeURIComponent(beautyJobMatch[1])}`);
    if (!job) return null;
    const canonicalPath = `/poslovi/${encodeURIComponent(beautyJobSlug(job))}/${encodeURIComponent(job.id)}`;
    const description = job.description || `${job.title} — ${beautyJobTypeLabel(job.type).toLowerCase()} u mestu ${job.city}.`;
    const meta = makeMeta(canonicalPath, `${job.title} | LUMERA Poslovi`, description, {
      image: job.photos?.[0],
      schema: beautyJobSchema(job, origin, canonicalPath),
    });
    const price = job.priceAmount ? `${job.priceAmount} RSD${job.pricePeriod ? ` / ${job.pricePeriod}` : ''}` : job.negotiable ? 'Cena po dogovoru' : '';
    return {
      meta,
      html: pageShell(meta, `<article><p class="seo-kicker">${escapeHtml(beautyJobIntentLabel(job.intent))} · ${escapeHtml(beautyJobTypeLabel(job.type))}</p><h1>${escapeHtml(job.title)}</h1><p>${escapeHtml(description)}</p>${job.photos?.[0] ? `<img src="${escapeHtml(job.photos[0])}" width="960" height="640" alt="${escapeHtml(job.title)}">` : ''}<p><strong>${escapeHtml(job.city)}, ${escapeHtml(job.region)}</strong>${price ? ` · ${escapeHtml(price)}` : ''}</p>${job.availabilityPattern ? `<p>Raspoloživost: ${escapeHtml(job.availabilityPattern)}</p>` : ''}<p>Oglašivač: ${escapeHtml(job.authorDisplayName)}</p><p><a href="/poslovi">Svi Beauty Poslovi oglasi</a></p></article>`, origin),
    };
  }

  const salonMatch = pathname.match(/^\/saloni\/([^/]+)$/);
  if (salonMatch) {
    const salon = await getJson(req, `/api/salons/${encodeURIComponent(salonMatch[1])}`);
    if (!salon) return null;
    const description = salon.description || salon.shortDescription || `${salon.name} — salon i beauty tretmani u gradu ${salon.city}.`;
    const meta = makeMeta(pathname, `${salon.name} u ${salon.city} | LUMERA`, description, {
      image: salon.gallery?.[0] ?? salon.imageUrl,
      schema: { '@context': 'https://schema.org', '@type': 'BeautySalon', name: salon.name, description, image: asAbsolute(origin, salon.gallery?.[0] ?? salon.imageUrl), address: { '@type': 'PostalAddress', addressLocality: salon.city, addressCountry: 'RS' }, aggregateRating: salon.rating ? { '@type': 'AggregateRating', ratingValue: salon.rating, reviewCount: salon.reviewCount ?? 0 } : undefined },
    });
    const services = (salon.services ?? []).slice(0, 24).map((service) => `<li>${escapeHtml(service.name)}${service.price ? ` — od ${escapeHtml(service.promoPrice ?? service.price)} RSD` : ''}</li>`).join('');
    return { meta, html: pageShell(meta, `<article><h1>${escapeHtml(salon.name)}</h1><p>${escapeHtml(description)}</p>${salon.gallery?.[0] || salon.imageUrl ? `<img src="${escapeHtml(salon.gallery?.[0] ?? salon.imageUrl)}" width="960" height="640" alt="${escapeHtml(salon.name)}">` : ''}<p>${escapeHtml(salon.city ?? '')}${salon.address ? ` · ${escapeHtml(salon.address)}` : ''}</p><p>Ocena: ${escapeHtml(salon.rating ?? 'Nema ocenu')} ${salon.reviewCount ? `(${escapeHtml(salon.reviewCount)} recenzija)` : ''}</p><section><h2>Usluge</h2>${services ? `<ul>${services}</ul>` : '<p>Pogledajte dostupne tretmane u aplikaciji.</p>'}</section><p><a href="/saloni">Pogledajte sve salone</a></p></article>`, origin) };
  }

  const courseMatch = pathname.match(/^\/edukacije\/([a-zA-Z0-9-]+)$/);
  if (courseMatch) {
    const course = await getJson(req, `/api/education/public/courses/${encodeURIComponent(courseMatch[1])}`);
    if (!course) return null;
    const description = course.description || `${course.title} — stručna beauty edukacija na LUMERA platformi.`;
    const meta = makeMeta(pathname, `${course.title} | LUMERA edukacije`, description, { image: course.imageUrl, schema: { '@context': 'https://schema.org', '@type': 'Course', name: course.title, description, provider: { '@type': 'Organization', name: course.publisher }, image: asAbsolute(origin, course.imageUrl) } });
    const outcomes = (course.learningOutcomes ?? []).slice(0, 10).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    return { meta, html: pageShell(meta, `<article><h1>${escapeHtml(course.title)}</h1><p>${escapeHtml(description)}</p>${course.imageUrl ? `<img src="${escapeHtml(course.imageUrl)}" width="960" height="540" alt="${escapeHtml(course.title)}">` : ''}<p>${escapeHtml(course.publisher)} · ${escapeHtml(course.format)} · ${escapeHtml(course.duration)} · ${escapeHtml(course.price)} RSD</p>${outcomes ? `<section><h2>Šta ćete naučiti</h2><ul>${outcomes}</ul></section>` : ''}${course.centerId ? `<p><a href="/edukacije/centri/${escapeHtml(course.centerId)}">Pogledajte edukativni centar</a></p>` : ''}<p><a href="/edukacije">Sve edukacije</a></p></article>`, origin) };
  }

  const centerMatch = pathname.match(/^\/edukacije\/centri\/([a-zA-Z0-9-]+)$/);
  if (centerMatch) {
    const center = await getJson(req, `/api/education/public/centers/${encodeURIComponent(centerMatch[1])}`);
    if (!center) return null;
    const name = center.name || 'Edukativni centar';
    const description = center.description || `Kursevi i edukacije centra ${name}.`;
    const meta = makeMeta(pathname, `${name} | LUMERA edukacije`, description, { image: center.imageUrl });
    const courses = (center.courses ?? []).map((course) => card({ href: `/edukacije/${course.id}`, title: course.title, description: course.description, image: course.imageUrl })).join('');
    return { meta, html: pageShell(meta, `<article><h1>${escapeHtml(name)}</h1><p>${escapeHtml(description)}</p><section><h2>Programi centra</h2><div class="seo-grid">${courses || '<p>Trenutno nema javnih programa.</p>'}</div></section><p><a href="/edukacije">Sve edukacije</a></p></article>`, origin) };
  }

  const instructorMatch = pathname.match(/^\/edukacije\/instruktori\/([a-zA-Z0-9-]+)$/);
  if (instructorMatch) {
    const instructor = await getJson(req, `/api/education/instructors/${encodeURIComponent(instructorMatch[1])}/public`);
    if (!instructor) return null;
    const name = instructor.name || 'Instruktor';
    const description = instructor.biography || `Upoznajte instruktora ${name} i dostupne beauty edukacije.`;
    const meta = makeMeta(pathname, `${name} | LUMERA edukacije`, description, { image: instructor.photoUrl });
    const courses = (instructor.courses ?? []).map((course) => card({ href: `/edukacije/${course.id}`, title: course.title, description: course.description, image: course.imageUrl })).join('');
    return { meta, html: pageShell(meta, `<article><h1>${escapeHtml(name)}</h1><p>${escapeHtml(description)}</p><section><h2>Edukacije instruktora</h2><div class="seo-grid">${courses || '<p>Trenutno nema javnih programa.</p>'}</div></section><p><a href="/edukacije">Sve edukacije</a></p></article>`, origin) };
  }
  return null;
}

function injectDocument(template, page, origin) {
  const canonical = `${origin}${page.meta.pathname}`;
  const metadata = `<title>${escapeHtml(page.meta.title)}</title><meta name="description" content="${escapeHtml(page.meta.description)}"><meta name="robots" content="${page.meta.indexable ? 'index, follow' : 'noindex, follow'}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:title" content="${escapeHtml(page.meta.title)}"><meta property="og:description" content="${escapeHtml(page.meta.description)}"><meta property="og:type" content="website"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:image" content="${escapeHtml(asAbsolute(origin, page.meta.image))}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(page.meta.title)}"><meta name="twitter:description" content="${escapeHtml(page.meta.description)}"><meta name="twitter:image" content="${escapeHtml(asAbsolute(origin, page.meta.image))}">`;
  const withoutDefaultMetadata = stripSeoMetadata(template);
  return withoutDefaultMetadata
    .replace('</head>', `${metadata}${page.meta.schema ? `<script type="application/ld+json">${JSON.stringify(page.meta.schema).replace(/</g, '\\u003c')}</script>` : ''}</head>`)
    .replace('<div id="root"></div>', `${page.html}<div id="root"></div>`);
}

function stripSeoMetadata(template) {
  return template
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta (?:name|property)="(?:description|robots|og:[^"]+|twitter:[^"]+)"[^>]*>\s*/gi, '')
    .replace(/<link rel="canonical"[^>]*>\s*/gi, '');
}

function sitemapXml(origin, entries) {
  const urls = entries.map(({ pathname, lastmod, priority = '0.6' }) => `<url><loc>${escapeHtml(`${origin}${pathname}`)}</loc>${lastmod ? `<lastmod>${escapeHtml(lastmod)}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>${priority}</priority></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

async function buildSitemap(req) {
  const origin = requestOrigin(req);
  const entries = [...staticPages.keys(), ...categoryPages.keys()]
    .filter((pathname) => pathname !== '/pridruzi-se-edukativni-centar')
    .map((pathname) => ({ pathname, priority: pathname === '/' ? '1.0' : categoryPages.has(pathname) ? '0.8' : '0.7' }));
  const [salons, courses, suppliers, beautyJobs] = await Promise.all([
    listAll(req, '/api/salons', 24),
    listAll(req, '/api/education/public/courses', 24),
    getJson(req, '/api/suppliers'),
    listAll(req, '/api/beauty-jobs', 100),
  ]);
  const seenCenters = new Set();
  const seenInstructors = new Set();
  for (const salon of salons) entries.push({ pathname: `/saloni/${encodeURIComponent(salon.slug)}`, lastmod: salon.createdAt ? new Date(salon.createdAt).toISOString().slice(0, 10) : undefined, priority: '0.8' });
  for (const course of courses) {
    entries.push({ pathname: `/edukacije/${encodeURIComponent(course.id)}`, priority: '0.8' });
    if (course.centerId && !seenCenters.has(course.centerId)) { seenCenters.add(course.centerId); entries.push({ pathname: `/edukacije/centri/${encodeURIComponent(course.centerId)}`, priority: '0.6' }); }
    if (course.instructorProfileId && !seenInstructors.has(course.instructorProfileId)) { seenInstructors.add(course.instructorProfileId); entries.push({ pathname: `/edukacije/instruktori/${encodeURIComponent(course.instructorProfileId)}`, priority: '0.6' }); }
  }
  for (const supplier of (suppliers ?? []).filter(isPublicRetailSupplier)) {
    const supplierPath = `/shop/${encodeURIComponent(supplier.slug)}`;
    entries.push({ pathname: supplierPath, priority: '0.8' });
    const [categories, products] = await Promise.all([
      getJson(req, `/api/suppliers/${encodeURIComponent(supplier.slug)}/categories`),
      listAll(req, `/api/suppliers/${encodeURIComponent(supplier.slug)}/public-products`, 100),
    ]);
    for (const category of categories ?? []) {
      if (category.active) entries.push({
        pathname: `${supplierPath}/${category.path.split('/').map(encodeURIComponent).join('/')}`,
        priority: '0.7',
      });
    }
    for (const product of products) {
      entries.push({ pathname: `${supplierPath}/proizvod/${encodeURIComponent(product.id)}`, priority: '0.7' });
    }
  }
  for (const job of beautyJobs) {
    entries.push({ pathname: `/poslovi/${encodeURIComponent(beautyJobSlug(job))}/${encodeURIComponent(job.id)}`, lastmod: job.updatedAt ? new Date(job.updatedAt).toISOString().slice(0, 10) : undefined, priority: '0.7' });
  }
  return sitemapXml(origin, entries);
}

function privateDocument(pathname, origin) {
  const meta = makeMeta(pathname, 'LUMERA | Privatna stranica', fallbackDescription, { indexable: false });
  return pageShell(meta, '<article><h1>LUMERA</h1><p>Ova stranica je dostupna u aplikaciji i nije namenjena indeksiranju pretraživača.</p><p><a href="/">Povratak na početnu</a></p></article>', origin);
}

export async function createSeoResponse(req, template) {
  const url = new URL(req.url ?? '/', requestOrigin(req));
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const origin = requestOrigin(req);
  const legacyProduct = pathname.match(/^\/proizvodi\/([^/]+)$/);
  if (legacyProduct) {
    try {
      const [product, suppliers] = await Promise.all([
        getJson(req, `/api/shop/public/products/${encodeURIComponent(legacyProduct[1])}`),
        getJson(req, '/api/suppliers'),
      ]);
      const supplier = (suppliers ?? []).find((item) => isPublicRetailSupplier(item) && item.id === product?.supplierId);
      if (product && supplier) {
        return {
          status: 308,
          type: 'text/plain; charset=utf-8',
          body: 'Permanent redirect to the supplier product listing.',
          headers: { location: `/shop/${encodeURIComponent(supplier.slug)}/proizvod/${encodeURIComponent(product.id)}${url.search}` },
        };
      }
    } catch {
      // Unknown or unavailable legacy products use the normal not-found response.
    }
  }
  if (pathname === '/beauty-poslovi') {
    return {
      status: 308,
      type: 'text/plain; charset=utf-8',
      body: 'Permanent redirect to the canonical Beauty Poslovi catalog.',
      headers: { location: `/poslovi${url.search}` },
    };
  }
  const legacyBeautyJob = pathname.match(/^\/beauty-poslovi\/([a-zA-Z0-9-]+)$/);
  if (legacyBeautyJob) {
    try {
      const job = await getJson(req, `/api/beauty-jobs/${encodeURIComponent(legacyBeautyJob[1])}`);
      if (job) {
        return {
          status: 308,
          type: 'text/plain; charset=utf-8',
          body: 'Permanent redirect to the canonical Beauty Poslovi listing.',
          headers: { location: `/poslovi/${encodeURIComponent(beautyJobSlug(job))}/${encodeURIComponent(job.id)}${url.search}` },
        };
      }
    } catch {
      // Private fallback below keeps an unknown legacy identifier non-indexable.
    }
  }
  if (pathname === '/robots.txt') {
    return { status: 200, type: 'text/plain; charset=utf-8', body: `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /vlasnik/\nDisallow: /zaposleni/\nDisallow: /moj-nalog\nDisallow: /korpa\nDisallow: /porudzbina/pracenje\nDisallow: /biznis/\nDisallow: /prijava\nDisallow: /poslovna-\nDisallow: /student/\nDisallow: /widget/\nDisallow: /beauty-poslovi/\nDisallow: /pridruzi-se-\nSitemap: ${origin}/sitemap.xml\n` };
  }
  if (pathname === '/sitemap.xml') {
    try { return { status: 200, type: 'application/xml; charset=utf-8', body: await buildSitemap(req) }; }
    catch {
      const staticEntries = [...staticPages.keys()]
        .filter((item) => item !== '/pridruzi-se-edukativni-centar')
        .map((item) => ({ pathname: item }));
      return { status: 503, type: 'application/xml; charset=utf-8', body: sitemapXml(origin, staticEntries) };
    }
  }
  const hasQuery = url.search.length > 0;
  try {
    const page = !hasQuery ? await renderPublicPage(req, pathname) : null;
    if (page) return { status: 200, type: 'text/html; charset=utf-8', body: injectDocument(template, page, origin) };
  } catch {
    // Fall through to the client app with a non-indexable response. Public API
    // outages must never cause a private-page-looking response to be indexed.
  }
  const queryCanonical = hasQuery
    ? `<link rel="canonical" href="${escapeHtml(`${origin}${pathname}`)}">`
    : '';
  const privateHead = `<title>LUMERA | Privatna stranica</title><meta name="description" content="${escapeHtml(fallbackDescription)}"><meta name="robots" content="noindex, follow">${queryCanonical}`;
  const html = stripSeoMetadata(template)
    .replace('</head>', `${privateHead}</head>`)
    .replace('<div id="root"></div>', `${privateDocument(pathname, origin)}<div id="root"></div>`);
  return { status: hasQuery ? 200 : 404, type: 'text/html; charset=utf-8', body: html };
}

const mimeTypes = { '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

async function start() {
  const template = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
  const port = Number(process.env.PORT ?? 23561);
  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const candidate = path.normalize(path.join(distDir, decodeURIComponent(url.pathname)));
    const seoDocument = url.pathname === '/robots.txt' || url.pathname === '/sitemap.xml';
    const servesFile = !seoDocument && candidate.startsWith(distDir) && existsSync(candidate) && statSync(candidate).isFile();
    if (servesFile) {
      res.writeHead(200, { 'content-type': mimeTypes[path.extname(candidate)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' });
      createReadStream(candidate).pipe(res);
      return;
    }
    const response = await createSeoResponse(req, template);
    res.writeHead(response.status, {
      'content-type': response.type,
      'cache-control': response.type.includes('html') ? 'public, max-age=60, s-maxage=300' : 'public, max-age=300, s-maxage=600',
      ...(response.headers ?? {}),
    });
    res.end(response.body);
  }).listen(port, '0.0.0.0');
}

if (process.env.NODE_ENV !== 'test') void start();