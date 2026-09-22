import { createReadStream, existsSync, promises as fs, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import categoryDefinitions from './src/lib/public-category-pages.json' with { type: 'json' };
import staticPageDefinitions from './src/lib/static-seo-pages.json' with { type: 'json' };
import legalPages from './src/content/legal-pages.json' with { type: 'json' };
import { publicSiteOrigin, siteIndexable, normalizedPublicPath, canonicalRedirect, applySitePolicy } from './seo-policy.mjs';
import { compactSchema, buildPageStructuredData, breadcrumbStructuredData, publicReviews, publicJobDate, validPrice } from './structured-data.mjs';
import { cityPhrase, cityLocatives, publicImageAlt, publicSalonCategories, categoryListingHref } from './seo-text.mjs';
import { listingPage, listingCanonical, listingIndexable } from './seo-policy.mjs';
import { publicSalonAddress } from './public-salon-address.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, 'dist', 'public');
const fallbackDescription = staticPageDefinitions.find((page) => page.path === '/')?.description
  ?? 'Pronađite proverene salone, beauty i wellness tretmane i stručne edukacije na jednom mestu uz LUMERA.';
const fallbackImageAlt = 'LUMERA platforma za beauty i wellness usluge, proizvode i edukacije';
const fallbackImageMetadata = { width: 1200, height: 630, type: 'image/png' };
const categoryPages = new Map(categoryDefinitions.map((page) => [page.path, page]));
const legalPageByPath = new Map(legalPages.map((page) => [page.path, page]));
const staticPages = new Map(staticPageDefinitions.map((page) => [page.path, page]));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function clip(value, limit = 158) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function asAbsolute(origin, value) {
  try { return new URL(value || '/og-lumera.png', origin).href; } catch { return `${origin}/og-lumera.png`; }
}

function toLastmod(...values) {
  for (const value of values) {
    if (!value) continue;
    const localized = String(value).trim().match(/^(\d{1,2})\.\s*(januar|februar|mart|april|maj|jun|jul|avgust|septembar|oktobar|novembar|decembar)\s+(\d{4})\.$/i);
    if (localized) {
      const months = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar'];
      const month = months.indexOf(localized[2].toLowerCase()) + 1;
      return `${localized[3]}-${String(month).padStart(2, '0')}-${String(localized[1]).padStart(2, '0')}`;
    }
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return date.toISOString().slice(0, 10);
  }
  return undefined;
}

function entityLastmod(entity) {
  return toLastmod(entity?.updatedAt, entity?.modifiedAt, entity?.publishedAt, entity?.createdAt);
}

function latestLastmod(entities) {
  const dates = (entities ?? []).map(entityLastmod).filter(Boolean).sort();
  return dates.at(-1);
}

function requestOrigin() {
  return publicSiteOrigin();
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

async function getListingPage(req, endpoint, page, pageSize) {
  const url = new URL(endpoint, apiOrigin(req));
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(pageSize));
  const payload = await getJson(req, `${url.pathname}${url.search}`);
  const items = Array.isArray(payload) ? payload : payload?.items ?? [];
  let hasNext = false;
  const totalPages = payload?.totalPages ?? payload?.pageCount;
  const total = payload?.total ?? payload?.totalCount;
  if (Number.isInteger(totalPages) && totalPages >= 0) hasNext = page < totalPages;
  else if (Number.isInteger(total) && total >= 0) hasNext = page * pageSize < total;
  else if (items.length === pageSize) {
    // Array DTOs have no count. A bounded same-size next-page probe preserves
    // offset semantics and proves that a next URL has actual public content.
    url.searchParams.set('page', String(page + 1));
    const next = await getJson(req, `${url.pathname}${url.search}`);
    hasNext = (Array.isArray(next) ? next : next?.items ?? []).length > 0;
  }
  return { items, hasNext };
}

// This POST is an existing public read-only lookup, not an asset mutation.
// Do not forward cookies: only descriptions visible to anonymous visitors.
async function publicImageDescriptions(req, urls) {
  const managed = [...new Set(urls.filter(value => typeof value === 'string' && value.includes('/api/media/')))].slice(0, 20);
  if (!managed.length) return {};
  const response = await fetch(new URL('/api/media/descriptions', apiOrigin(req)), {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ urls: managed }), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Public image descriptions unavailable (${response.status})`);
  const body = await response.json();
  return Object.fromEntries((body.items ?? []).map(item => [item.url, item.altText]));
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
  if (meta.extraContent) body += meta.extraContent;
  if (meta.pathname !== '/' && !JSON.stringify(meta.schema ?? {}).includes('"BreadcrumbList"')) {
    const heading = body.match(/<h1>(.*?)<\/h1>/)?.[1];
    const name = heading ? heading.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : meta.title;
    const crumbs = [{ name: 'Početna', pathname: '/' }, { name, pathname: meta.pathname }];
    meta.schema = meta.schema
      ? { '@context': 'https://schema.org', '@graph': [meta.schema, breadcrumbs(origin, crumbs)].filter(Boolean) }
      : buildPageStructuredData('static', { name }, { origin, canonical: meta.pathname, breadcrumbs: crumbs });
    body = breadcrumbHtml(crumbs) + body;
  }
  meta.schema = compactSchema(meta.schema);
  return `<main id="seo-prerender" aria-label="LUMERA sadržaj">
    <style>#seo-prerender{font-family:Inter,Arial,sans-serif;color:#261c2a;max-width:1120px;margin:0 auto;padding:36px 20px;line-height:1.55}#seo-prerender a{color:#7c3156;text-decoration:underline}#seo-prerender .seo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}#seo-prerender article{border:1px solid #eadfe5;border-radius:14px;padding:18px;background:#fff}#seo-prerender img{max-width:100%;height:auto;border-radius:10px}#seo-prerender .seo-kicker{color:#7c3156;font-weight:700;text-transform:uppercase;font-size:.8rem;letter-spacing:.08em}@media(min-width:700px){#seo-prerender{padding:64px 30px}}html[data-app-ready="true"] #seo-prerender{display:none}</style>
    <header><p class="seo-kicker">LUMERA</p><nav aria-label="Glavna navigacija"><a href="/">Početna</a> · <a href="/saloni">Saloni</a> · <a href="/edukacije">Edukacije</a> · <a href="/poslovi">Poslovi</a> · <a href="/inspiracija">Inspiracija</a></nav></header>
    ${body}
    <footer><nav aria-label="Gradovi i kategorije">${Object.keys(cityLocatives).map(city => `<a href="/saloni?city=${encodeURIComponent(city)}">${escapeHtml(city)}</a>`).join(' · ')}<br>${[...categoryPages.entries()].map(([href, category]) => `<a href="${escapeHtml(href)}">${escapeHtml(category.label)}</a>`).join(' · ')}</nav><p><a href="/uslovi-koriscenja">Uslovi korišćenja</a> · <a href="/politika-privatnosti">Privatnost</a> · <a href="/politika-kolacica">Kolačići</a></p></footer>
  </main>`;
}

function makeMeta(pathname, title, description, options = {}) {
  const usesFallbackImage = !options.image;
  return {
    pathname,
    title: clip(title, 60),
    description: clip(description),
    image: options.image ?? '/og-lumera.png',
    imageAlt: String(options.imageAlt ?? '').trim() || (options.image ? clip(title, 60) : fallbackImageAlt),
    imageWidth: options.imageWidth ?? (usesFallbackImage ? fallbackImageMetadata.width : undefined),
    imageHeight: options.imageHeight ?? (usesFallbackImage ? fallbackImageMetadata.height : undefined),
    imageType: options.imageType ?? (usesFallbackImage ? fallbackImageMetadata.type : undefined),
    indexable: options.indexable ?? true,
    schema: options.schema,
    heroPreload: options.heroPreload,
  };
}

function socialImageOptions(entity, fallbackImage) {
  const image = entity?.socialImage;
  return {
    image: image?.url ?? fallbackImage,
    imageWidth: image?.width,
    imageHeight: image?.height,
    imageType: image?.type,
  };
}

function card({ href, title, description, image, detail, city, category, imageDescription }) {
  return `<article>${image ? `<img src="${escapeHtml(image)}" width="640" height="400" alt="${escapeHtml(publicImageAlt({ name: title, city, category, description: imageDescription }))}">` : ''}<h2><a href="${escapeHtml(href)}">${escapeHtml(title)}</a></h2>${description ? `<p>${escapeHtml(clip(description, 220))}</p>` : ''}${detail ? `<p>${escapeHtml(detail)}</p>` : ''}</article>`;
}

function isPublicRetailSupplier(supplier) {
  return Boolean(supplier?.active && (supplier.scope === 'B2C' || supplier.scope === 'BOTH'));
}

function supplierDescription(supplier) {
  return supplier.description || `Istražite javnu ponudu beauty proizvoda dobavljača ${supplier.name} na LUMERA platformi.`;
}

function breadcrumbs(origin, items) {
  return breadcrumbStructuredData(origin, items);
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
    category: product.category,
    imageDescription: product.coverImageDescription,
    detail: validPrice(product.discountPrice ?? product.price) ? `${product.discountPrice ?? product.price} RSD` : undefined,
  });
}

function courseCard(course) {
  return card({
    href: `/edukacije/${encodeURIComponent(course.id)}`, title: course.title,
    description: course.description || [course.category, course.duration].filter(Boolean).join(' · '),
    image: course.imageUrl, category: course.category, city: course.city, imageDescription: course.coverImageDescription,
    detail: [course.publisher, validPrice(course.price) ? `${course.price} RSD` : undefined].filter(Boolean).join(' · '),
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

async function renderPublicPage(req, pathname) {
  const origin = requestOrigin();
  const search = new URL(req.url ?? '/', origin).search;
  const pageNumber = listingPage(search);
  const filterParams = new URLSearchParams(search);
  filterParams.delete('page');
  filterParams.delete('pageSize');
  const listingQuery = (size) => `page=${pageNumber}&pageSize=${size}${filterParams.size ? `&${filterParams}` : ''}`;
  const pagination = (hasNext) => {
    const link = (page, label) => {
      const params = new URLSearchParams(search);
      params.set('page', String(page));
      params.sort();
      return `<a href="${escapeHtml(`${pathname}?${params}`)}">${label}</a>`;
    };
    return `<nav aria-label="Stranice">${pageNumber > 1 ? link(pageNumber - 1, 'Prethodna') : ''}${hasNext ? ` ${link(pageNumber + 1, 'Sledeća')}` : ''}</nav>`;
  };
  const staticPage = staticPages.get(pathname);
  if (staticPage) {
    const { title, description, indexable, heading = title.replace(/\s*\|\s*LUMERA$/, '') } = staticPage;
    if (pathname === '/') {
      const salons = await getJson(req, '/api/salons?page=1&pageSize=6') ?? [];
      const salonCards = salons.slice(0, 6).map((salon) => card({ href: `/saloni/${salon.slug}`, title: salon.name, description: salon.shortDescription, image: salon.imageUrl, city: salon.city, category: salon.popularServices?.join(', '), imageDescription: salon.coverImageDescription, detail: `${salon.city} · Ocena ${salon.rating}` })).join('');
      const meta = makeMeta(pathname, title, description, {
        heroPreload: '/hero-bg.jpg',
        schema: buildPageStructuredData('home', { description }, { origin, canonical: pathname }),
      });
      return { meta, html: pageShell(meta, `<section><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(description)}</p><p><a href="/saloni">Istražite sve salone i tretmane</a> · <a href="/edukacije">Pogledajte beauty edukacije</a></p></section><section><h2>Izdvojeni saloni</h2><div class="seo-grid">${salonCards || '<p>Saloni će uskoro biti dostupni.</p>'}</div></section>`, origin) };
    }
    if (pathname === '/saloni') {
      const { items: salons, hasNext } = await getListingPage(req, `/api/salons?${listingQuery(6)}`, pageNumber, 6);
      const cities = filterParams.getAll('city').map(city => city.trim()).filter(Boolean);
      const city = cities.length === 1 ? cities[0] : '';
      const cityHeading = city ? `Saloni ${cityPhrase(city)}` : heading;
      const cityTitle = city ? `${cityHeading} | LUMERA` : title;
      const canonicalPath = listingCanonical(pathname, search);
      const meta = makeMeta(canonicalPath, cityTitle, description, {
        indexable: !city || salons.length > 0,
        schema: buildPageStructuredData('list', { name: city ? cityHeading : 'LUMERA saloni', items: salons.map(salon => ({ name: salon.name, pathname: `/saloni/${salon.slug}` })) }, { origin, canonical: canonicalPath }),
      });
      const cards = salons.map((salon) => card({ href: `/saloni/${salon.slug}`, title: salon.name, description: salon.shortDescription, image: salon.imageUrl, city: salon.city, category: salon.popularServices?.join(', '), imageDescription: salon.coverImageDescription, detail: `${salon.city} · Ocena ${salon.rating} (${salon.reviewCount} recenzija)` })).join('');
      meta.extraContent = pagination(hasNext);
      return { meta, html: pageShell(meta, `<section><h1>${escapeHtml(cityHeading)}</h1><p>${escapeHtml(description)}</p></section><section><h2>Dostupni saloni</h2><div class="seo-grid">${cards || '<p>Trenutno nema dostupnih salona.</p>'}</div></section>`, origin) };
    }
    if (pathname === '/proizvodi') {
      const suppliers = (await getJson(req, '/api/suppliers') ?? []).filter(isPublicRetailSupplier);
      const meta = makeMeta(pathname, title, description, {
        schema: buildPageStructuredData('list', { name: 'LUMERA dobavljači beauty proizvoda', items: suppliers.map(supplier => ({ name: supplier.name, pathname: `/shop/${encodeURIComponent(supplier.slug)}` })) }, { origin, canonical: pathname }),
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
      const { items: jobs, hasNext } = await getListingPage(req, `/api/beauty-jobs?${listingQuery(10)}${filterParams.has('sort') ? '' : '&sort=newest'}`, pageNumber, 10);
      const meta = makeMeta(pathname, title, description, {
        schema: buildPageStructuredData('list', { name: 'LUMERA Beauty Poslovi', items: jobs.map(job => ({ name: job.title, pathname: `/poslovi/${encodeURIComponent(beautyJobSlug(job))}/${encodeURIComponent(job.id)}` })) }, { origin, canonical: pathname }),
      });
      meta.extraContent = pagination(hasNext);
      meta.pathname = listingCanonical(pathname, search);
      const cards = jobs.map((job) => card({
        href: `/poslovi/${encodeURIComponent(beautyJobSlug(job))}/${encodeURIComponent(job.id)}`,
        title: job.title,
        city: job.city, category: job.categoryName, imageDescription: job.coverImageDescription,
        description: job.description,
        image: job.photos?.[0],
        detail: `${beautyJobIntentLabel(job.intent)} · ${beautyJobTypeLabel(job.type)} · ${job.city}, ${job.region}`,
      })).join('');
      return { meta, html: pageShell(meta, `<section><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(description)}</p></section><section><h2>Aktuelni oglasi</h2><div class="seo-grid">${cards || '<p>Trenutno nema aktivnih oglasa.</p>'}</div></section>`, origin) };
    }
    if (pathname === '/edukacije') {
      const { items: courses, hasNext } = await getListingPage(req, `/api/education/public/courses?${listingQuery(24)}`, pageNumber, 24);
      const meta = makeMeta(pathname, title, description, {
        schema: buildPageStructuredData('list', { name: 'LUMERA beauty edukacije', items: courses.map(course => ({ name: course.title, pathname: `/edukacije/${encodeURIComponent(course.id)}` })) }, { origin, canonical: pathname }),
      });
      meta.extraContent = pagination(hasNext);
      meta.pathname = listingCanonical(pathname, search);
      const cards = courses.map(courseCard).join('');
      return { meta, html: pageShell(meta, `<section><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(description)}</p></section><section><h2>Dostupne edukacije</h2><div class="seo-grid">${cards || '<p>Trenutno nema dostupnih edukacija.</p>'}</div></section>`, origin) };
    }
    if (['/inspiracija', '/recnik', '/brendovi'].includes(pathname)) {
      const endpoint = pathname === '/inspiracija' ? '/api/inspiracija' : pathname === '/recnik' ? '/api/recnik' : '/api/brendovi';
      const items = await getJson(req, endpoint) ?? [];
      const cards = items.slice(0, 30).map((item) => card({ href: item.salon?.slug ? `/saloni/${item.salon.slug}` : '/saloni', title: item.title ?? item.term ?? item.name, description: item.definition ?? item.description, image: pathname === '/inspiracija' ? item.imageUrl : undefined, detail: item.salon?.name ?? item.category })).join('');
      const guideItems = items.slice(0, 30);
      const meta = makeMeta(pathname, title, description, {
        schema: buildPageStructuredData('list', { name: heading, items: guideItems.map(item => ({ name: item.title ?? item.term ?? item.name, pathname: item.salon?.slug ? `/saloni/${encodeURIComponent(item.salon.slug)}` : undefined })) }, { origin, canonical: pathname }),
      });
      return { meta, html: pageShell(meta, `<section><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(description)}</p></section><section><h2>Sadržaj vodiča</h2><div class="seo-grid">${cards || '<p>Vodič je trenutno prazan.</p>'}</div></section>`, origin) };
    }
    const legalPage = legalPageByPath.get(pathname);
    const meta = makeMeta(pathname, title, description, { indexable });
    if (legalPage) {
      const sections = legalPage.sections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2>${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</section>`).join('');
      return { meta, html: pageShell(meta, `<article><h1>${escapeHtml(legalPage.title)}</h1><p>${escapeHtml(legalPage.lead)}</p><p><strong>Poslednje ažuriranje:</strong> ${escapeHtml(legalPage.lastUpdated)}</p><p><strong>Radna pravna verzija:</strong> tekst mora biti potvrđen od strane odgovornog pravnog lica i pravnog savetnika pre komercijalnog lansiranja.</p>${sections}</article>`, origin) };
    }
    return { meta, html: pageShell(meta, `<article><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(description)}</p><p>Za dodatne informacije pogledajte <a href="/saloni">javni katalog salona</a> ili <a href="/edukacije">beauty edukacije</a>.</p></article>`, origin) };
  }

  const categoryPage = categoryPages.get(pathname);
  if (categoryPage) {
    const categoryParams = new URLSearchParams(filterParams);
    categoryParams.set('category', categoryPage.apiCategory);
    const { items: salons, hasNext } = await getListingPage(req, `/api/salons?${categoryParams}&page=${pageNumber}&pageSize=6`, pageNumber, 6);
    const meta = makeMeta(pathname, categoryPage.title, categoryPage.description, {
      schema: buildPageStructuredData('list', { name: categoryPage.h1, items: salons.map(salon => ({ name: salon.name, pathname: `/saloni/${salon.slug}` })) }, { origin, canonical: pathname }),
    });
    meta.extraContent = pagination(hasNext);
    meta.pathname = listingCanonical(pathname, search);
    const cards = salons.map((salon) => card({
      href: `/saloni/${salon.slug}`,
      title: salon.name,
      city: salon.city, category: categoryPage.label, imageDescription: salon.coverImageDescription,
      description: salon.shortDescription,
      image: salon.imageUrl,
      detail: `${salon.city} · Ocena ${salon.rating} (${salon.reviewCount} recenzija)`,
    })).join('');
    return {
      meta,
      html: pageShell(meta, `<section><h1>${escapeHtml(categoryPage.h1)}</h1><p>${escapeHtml(categoryPage.description)}</p><p>${escapeHtml(categoryPage.intro)}</p></section><section><h2>${escapeHtml(categoryPage.label)}</h2><div class="seo-grid">${cards || '<p>Trenutno nema dostupnih salona u ovoj kategoriji.</p>'}</div></section>`, origin),
    };
  }

  const educationTaxonomyMatch = pathname.match(/^\/edukacije\/sekcije\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
  if (educationTaxonomyMatch) {
    const sectionSlug = decodeURIComponent(educationTaxonomyMatch[1]);
    const categorySlug = educationTaxonomyMatch[2] ? decodeURIComponent(educationTaxonomyMatch[2]) : null;
    const subcategorySlug = educationTaxonomyMatch[3] ? decodeURIComponent(educationTaxonomyMatch[3]) : null;

    const taxonomy = await getJson(req, '/api/education/public/taxonomy');
    if (!Array.isArray(taxonomy)) return null;

    const section = taxonomy.find(s => s.slug === sectionSlug);
    if (!section) return null;

    let category = null;
    let subcategory = null;
    let filterParams = `sectionId=${encodeURIComponent(section.id)}`;
    let title = section.name;
    let description = `Pronađite kurseve i obuke iz kategorije ${section.name}.`;

    if (categorySlug) {
      category = section.categories?.find(c => c.slug === categorySlug);
      if (!category) return null;
      filterParams = `categoryId=${encodeURIComponent(category.id)}`;
      title = category.name;
      description = `Istražite edukacije za ${category.name}.`;

      if (subcategorySlug) {
        subcategory = category.subcategories?.find(s => s.slug === subcategorySlug);
        if (!subcategory) return null;
        filterParams = `subcategoryId=${encodeURIComponent(subcategory.id)}`;
        title = subcategory.name;
        description = `Kursevi i obuke za tehniku ${subcategory.name}.`;
      }
    }

    const taxonomyParams = new URLSearchParams(search);
    for (const key of ['sectionId', 'categoryId', 'subcategoryId']) taxonomyParams.delete(key);
    for (const [key, value] of new URLSearchParams(filterParams)) taxonomyParams.set(key, value);
    const { items: courses, hasNext } = await getListingPage(req, `/api/education/public/courses?${taxonomyParams}`, pageNumber, 24);

    const crumbs = [{ name: 'Edukacije', pathname: '/edukacije' }];
    crumbs.push({ name: section.name, pathname: `/edukacije/sekcije/${encodeURIComponent(section.slug)}` });
    if (category) crumbs.push({ name: category.name, pathname: `/edukacije/sekcije/${encodeURIComponent(section.slug)}/${encodeURIComponent(category.slug)}` });
    if (subcategory) crumbs.push({ name: subcategory.name, pathname: `/edukacije/sekcije/${encodeURIComponent(section.slug)}/${encodeURIComponent(category.slug)}/${encodeURIComponent(subcategory.slug)}` });

    const meta = makeMeta(pathname, `${title} | Edukacije | LUMERA`, description, {
      schema: buildPageStructuredData('list', { name: title, items: courses.map(course => ({ name: course.title, pathname: `/edukacije/${course.id}` })) }, { origin, canonical: pathname, breadcrumbs: crumbs }),
    });
    meta.extraContent = pagination(hasNext);
    meta.pathname = listingCanonical(pathname, search);

    const cards = courses.map(courseCard).join('');

    return {
      meta,
      html: pageShell(meta, `<section>${breadcrumbHtml(crumbs)}<h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></section><section><h2>Dostupne edukacije</h2><div class="seo-grid">${cards || '<p>Trenutno nema edukacija u ovoj kategoriji.</p>'}</div></section>`, origin),
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
      ...socialImageOptions(product, product.imageUrl),
      imageAlt: publicImageAlt({ name: product.name, category: product.category, description: product.coverImageDescription }),
      schema: buildPageStructuredData('product', product, { origin, canonical: canonicalPath, breadcrumbs: crumbs }),
    });
    return {
      meta,
      html: pageShell(meta, `<article>${breadcrumbHtml(crumbs)}<h1>${escapeHtml(product.name)}</h1><p>${escapeHtml(description)}</p>${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" width="960" height="720" alt="${escapeHtml(meta.imageAlt)}">` : ''}${validPrice(price) ? `<p><strong>Cena: ${escapeHtml(price)} RSD</strong></p>` : ''}<p>${escapeHtml(product.category)}${product.brand ? ` · ${escapeHtml(product.brand)}` : ''}</p><p><a href="/shop/${escapeHtml(encodeURIComponent(supplier.slug))}">Svi proizvodi dobavljača ${escapeHtml(supplier.name)}</a></p></article>`, origin),
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
    const productParams = new URLSearchParams(filterParams);
    if (category) productParams.set('categoryId', category.id);
    const productsEndpoint = `/api/suppliers/${encodeURIComponent(supplier.slug)}/public-products?page=${pageNumber}&pageSize=24${productParams.size ? `&${productParams}` : ''}`;
    const { items: products, hasNext } = await getListingPage(req, productsEndpoint, pageNumber, 24);
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
      ...socialImageOptions(supplier, supplier.logoUrl),
      schema: buildPageStructuredData('list', { name: category ? `${category.name} — ${supplier.name}` : `${supplier.name} proizvodi`, items: products.map(product => ({ name: product.name, pathname: `/shop/${encodeURIComponent(supplier.slug)}/proizvod/${encodeURIComponent(product.id)}` })) }, { origin, canonical: canonicalPath, breadcrumbs: crumbs }),
    });
    meta.extraContent = pagination(hasNext);
    meta.pathname = listingCanonical(canonicalPath, search);
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
      ...socialImageOptions(job, job.photos?.[0]),
      imageAlt: job.coverImageDescription,
       schema: buildPageStructuredData('job', job, { origin, canonical: canonicalPath }),
    });
    const price = validPrice(job.priceAmount) ? `${job.priceAmount} RSD${job.pricePeriod ? ` / ${job.pricePeriod}` : ''}` : job.negotiable ? 'Cena po dogovoru' : '';
    const published = publicJobDate(job);
    const photoDescriptions = await publicImageDescriptions(req, job.photos ?? []);
    meta.imageAlt = publicImageAlt({ name: job.title, category: job.categoryName, city: job.city, description: photoDescriptions[job.photos?.[0]] || job.coverImageDescription });
    const publishedHtml = published ? `<p>Objavljeno: <time datetime="${escapeHtml(published)}">${escapeHtml(published.slice(0, 10))}</time></p>` : '';
    meta.extraContent = publishedHtml
      + (job.categoryName ? `<p>${escapeHtml(job.categoryName)}</p>` : '')
      + (job.dayLabels?.length ? `<p>${job.dayLabels.map(escapeHtml).join(' · ')}</p>` : '')
      + (job.photos ?? []).slice(1, 4).map(image => `<img src="${escapeHtml(image)}" width="960" height="640" alt="${escapeHtml(publicImageAlt({ name: job.title, category: job.categoryName, city: job.city, description: photoDescriptions[image] }))}">`).join('')
      + ((job.type === 'space_rental' || job.type === 'equipment_rental') && job.intent === 'offering' ? (job.availableSlots ?? []).map(slot => `<p>${escapeHtml(slot.startsAt)} – ${escapeHtml(slot.endsAt)}${slot.available ? '' : ' · Zauzeto'}</p>`).join('') : '');
    return {
      meta,
      html: pageShell(meta, `<article><p class="seo-kicker">${escapeHtml(beautyJobIntentLabel(job.intent))} · ${escapeHtml(beautyJobTypeLabel(job.type))}</p><h1>${escapeHtml(job.title)}</h1><p>${escapeHtml(description)}</p>${job.photos?.[0] ? `<img src="${escapeHtml(job.photos[0])}" width="960" height="640" alt="${escapeHtml(meta.imageAlt)}">` : ''}<p><strong>${escapeHtml(job.city)}, ${escapeHtml(job.region)}</strong>${price ? ` · ${escapeHtml(price)}` : ''}</p>${job.availabilityPattern ? `<p>Raspoloživost: ${escapeHtml(job.availabilityPattern)}</p>` : ''}<p>Oglašivač: ${escapeHtml(job.authorDisplayName)}</p><p><a href="/poslovi">Svi Beauty Poslovi oglasi</a></p></article>`, origin),
    };
  }

  const salonMatch = pathname.match(/^\/saloni\/([^/]+)$/);
  if (salonMatch) {
    const salon = await getJson(req, `/api/salons/${encodeURIComponent(salonMatch[1])}`);
    if (!salon) return null;
    const address = publicSalonAddress(salon);
    const addressHtml = address ? `<p><a href="${escapeHtml(address.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(address.text)}</a></p>` : '';
    const description = salon.description || salon.shortDescription || `${salon.name} — salon i beauty tretmani ${cityPhrase(salon.city)}.`;
    const meta = makeMeta(pathname, `${salon.name} ${cityPhrase(salon.city)} | LUMERA`, description, {
      ...socialImageOptions(salon, salon.imageUrl),
       imageAlt: publicImageAlt({ name: salon.name, category: publicSalonCategories(salon).join(', '), city: salon.city, description: salon.coverImageDescription }),
       schema: buildPageStructuredData('salon', salon, { origin, canonical: pathname, description: salon.description || salon.shortDescription }),
    });
    const services = (salon.services ?? []).map((service) => `<li>${escapeHtml(service.name)}${validPrice(service.promoPrice ?? service.price) ? ` — od ${escapeHtml(service.promoPrice ?? service.price)} RSD` : ''}${service.durationMinutes != null ? ` · ${escapeHtml(service.durationMinutes)} min` : ''}${service.description ? `<p>${escapeHtml(service.description)}</p>` : ''}</li>`).join('');
    const reviews = publicReviews(salon);
    const publicDetails = `${meta.schema?.priceRange ? `<p>Raspon cena: ${escapeHtml(meta.schema.priceRange)}</p>` : ''}`
      + ((salon.hours ?? []).length ? `<section><h2>Radno vreme</h2><ul>${salon.hours.map((hour) => `<li>${escapeHtml(hour.day)}: ${hour.closed ? 'Ne radi' : `${escapeHtml(hour.open)} – ${escapeHtml(hour.close)}`}</li>`).join('')}</ul></section>` : '')
      + (reviews.length ? `<section><h2>Recenzije</h2>${reviews.map((review) => `<article><p>${escapeHtml(review.authorName)} · ${escapeHtml(review.rating)}${review.date ? ` · <time>${escapeHtml(review.date)}</time>` : ''}</p>${review.text ? `<p>${escapeHtml(review.text)}</p>` : ''}</article>`).join('')}</section>` : '');
    const related = (await getJson(req, `/api/salons?city=${encodeURIComponent(salon.city ?? '')}&page=1&pageSize=9`) ?? []).filter(item => item.slug !== salon.slug && item.city === salon.city && item.active !== false).slice(0, 8);
    const relatedHtml = `<nav aria-label="Grad i kategorije"><a href="/saloni?city=${encodeURIComponent(salon.city ?? '')}">Saloni ${escapeHtml(cityPhrase(salon.city))}</a>${publicSalonCategories(salon).map(category => ` · <a href="${categoryListingHref(category)}">${escapeHtml(category)}</a>`).join('')}</nav>${related.length ? `<section><h2>Saloni ${escapeHtml(cityPhrase(salon.city))}</h2>${related.map(item => card({ href: `/saloni/${item.slug}`, title: item.name, city: item.city, category: item.popularServices?.join(', '), image: item.imageUrl, imageDescription: item.coverImageDescription, description: item.shortDescription })).join('')}</section>` : ''}`;
    const heroImage = salon.imageUrl ?? salon.gallery?.[0];
    const galleryDescriptions = await publicImageDescriptions(req, salon.gallery ?? []);
    const heroImageAlt = heroImage === salon.imageUrl ? meta.imageAlt : publicImageAlt({ name: salon.name, city: salon.city });
    meta.extraContent = `${salon.acceptsCards ? '<p>Plaćanje karticom</p>' : ''}${salon.homeService ? '<p>Dolazak na adresu</p>' : ''}${relatedHtml}`
      + (salon.gallery ?? []).filter(image => image && image !== heroImage).map(image => `<img src="${escapeHtml(image)}" width="960" height="640" alt="${escapeHtml(publicImageAlt({ name: salon.name, category: publicSalonCategories(salon).join(', '), city: salon.city, description: galleryDescriptions[image] }))}">`).join('');
    return { meta, html: pageShell(meta, `<article><h1>${escapeHtml(salon.name)}</h1><p>${escapeHtml(description)}</p>${heroImage ? `<img src="${escapeHtml(heroImage)}" width="960" height="640" alt="${escapeHtml(heroImageAlt)}">` : ''}<p>${escapeHtml(salon.city ?? '')}</p>${addressHtml}<p>Ocena: ${escapeHtml(typeof salon.rating === 'number' ? salon.rating.toFixed(1) : 'Nema ocenu')} ${salon.reviewCount ? `(${escapeHtml(salon.reviewCount)} recenzija)` : ''}</p><section><h2>Usluge</h2>${services ? `<ul>${services}</ul>` : '<p>Pogledajte dostupne tretmane u aplikaciji.</p>'}</section>${publicDetails}<p><a href="/saloni">Pogledajte sve salone</a></p></article>`, origin) };
  }

  const courseMatch = pathname.match(/^\/edukacije\/([a-zA-Z0-9-]+)$/);
  if (courseMatch) {
    const course = await getJson(req, `/api/education/public/courses/${encodeURIComponent(courseMatch[1])}`);
    if (!course) return null;
    const description = course.description || `${course.title} — stručna beauty edukacija na LUMERA platformi.`;
    const meta = makeMeta(pathname, `${course.title} | LUMERA edukacije`, description, { ...socialImageOptions(course, course.imageUrl), imageAlt: publicImageAlt({ name: course.title, category: course.category, city: course.city, description: course.coverImageDescription }), schema: buildPageStructuredData('course', course, { origin, canonical: pathname }) });
    const outcomes = (course.learningOutcomes ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    const displayedSession = course.sessions?.find(item => !item.cancelledAt) ?? course.sessions?.[0];
    const courseFields = [['city', 'Grad'], ['level', 'Nivo'], ['startDate', 'Početak'], ['theoryHours', 'Teorija (časova)'], ['practicalHours', 'Praksa (časova)'], ['language', 'Jezik'], ['refundPolicy', 'Uslovi povraćaja']];
    meta.extraContent = courseFields.filter(([key]) => course[key] != null && course[key] !== '').map(([key, label]) => `<p>${label}: ${escapeHtml(course[key])}</p>`).join('')
      + (course.certification ? '<p>Sertifikat</p>' : '')
      + (displayedSession?.availableSeats != null ? `<p>${escapeHtml(displayedSession.availableSeats)} slobodnih mesta</p>` : '')
      + (course.faq ?? []).map(item => `<section><h2>${escapeHtml(item.question)}</h2><p>${escapeHtml(item.answer)}</p></section>`).join('')
      + (course.publicModules ?? []).map(item => `<section><h2>${escapeHtml(item.title)}</h2>${item.description ? `<p>${escapeHtml(item.description)}</p>` : ''}${item.lessonCount != null ? `<p>${escapeHtml(item.lessonCount)} lekcija</p>` : ''}</section>`).join('')
      + (course.instructorProfile ? `<section><h2>${escapeHtml(course.instructorProfile.fullName)}</h2><p>${escapeHtml(course.instructorProfile.biography ?? '')}</p>${course.instructorProfile.specializations?.map(value => `<p>${escapeHtml(value)}</p>`).join('') ?? ''}</section>` : '')
      + (course.instructorProfile?.industryYears != null ? `<p>${escapeHtml(course.instructorProfile.industryYears)} god. u industriji</p>` : '')
      + (course.instructorProfile?.experienceYears != null ? `<p>${escapeHtml(course.instructorProfile.experienceYears)} god. edukatorskog iskustva</p>` : '')
      + (course.reviews ?? []).map(review => `<article><p>${escapeHtml(review.rating)}</p><p>${escapeHtml(review.comment ?? '')}</p></article>`).join('')
      + (course.dayProgram ?? []).map(day => `<section><h2>Dan ${escapeHtml(day.dayNumber)}: ${escapeHtml(day.title)}</h2>${day.description ? `<p>${escapeHtml(day.description)}</p>` : ''}${day.durationMinutes ? `<p>${escapeHtml(day.durationMinutes)} min</p>` : ''}</section>`).join('')
      + (course.includedItems?.length ? `<section><h2>Uključeno u cenu</h2><ul>${course.includedItems.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : '')
      + (course.requirements ? `<section><h2>Preduslovi</h2><p>${escapeHtml(course.requirements)}</p></section>` : '')
      + (course.paymentMode === 'live_deposit' && validPrice(course.depositAmount) ? `<p>Plaćanje depozita od ${escapeHtml(course.depositAmount)} RSD za rezervaciju, ostatak uživo.</p>` : course.paymentMode === 'live_off_platform' ? '<p>Plaćanje uživo na lokaciji centra.</p>' : '')
      + (course.center ? `<section><h2><a href="/edukacije/centri/${encodeURIComponent(course.center.id)}">${escapeHtml(course.center.name)}</a></h2>${course.center.description ? `<p>${escapeHtml(course.center.description)}</p>` : ''}</section>` : '')
      + (course.gallery ?? []).filter(media => media.url && media.url !== course.imageUrl).map(media => `<img src="${escapeHtml(media.url)}" width="960" height="640" alt="${escapeHtml(publicImageAlt({ name: course.title, category: course.category, city: course.city, description: media.altText }))}">`).join('');
    return { meta, html: pageShell(meta, `<article><h1>${escapeHtml(course.title)}</h1><p>${escapeHtml(description)}</p>${course.imageUrl ? `<img src="${escapeHtml(course.imageUrl)}" width="960" height="540" alt="${escapeHtml(meta.imageAlt)}">` : ''}<p>${[course.publisher, course.format, course.duration, validPrice(course.price) ? `${course.price} RSD` : null].filter(Boolean).map(escapeHtml).join(' · ')}</p>${outcomes ? `<section><h2>Šta ćete naučiti</h2><ul>${outcomes}</ul></section>` : ''}${course.centerId ? `<p><a href="/edukacije/centri/${escapeHtml(course.centerId)}">Pogledajte edukativni centar</a></p>` : ''}<p><a href="/edukacije">Sve edukacije</a></p></article>`, origin) };
  }

  const bundleMatch = pathname.match(/^\/edukacije\/paketi\/([a-zA-Z0-9-]+)$/);
  if (bundleMatch) {
    const bundle = await getJson(req, `/api/education/bundles/${encodeURIComponent(bundleMatch[1])}`);
    if (!bundle) return null;
    const name = bundle.name || bundle.title || 'Paket edukacija';
    const description = bundle.description || `${name} — paket stručnih beauty edukacija na LUMERA platformi.`;
    const meta = makeMeta(pathname, `${name} | LUMERA edukacije`, description, {
      schema: buildPageStructuredData('bundle', bundle, { origin, canonical: pathname }),
    });
    const courses = (bundle.courses ?? []).map((course) =>
      `<li><a href="/edukacije/${escapeHtml(encodeURIComponent(course.courseId))}">${escapeHtml(course.title)}</a>${course.duration ? ` · ${escapeHtml(course.duration)}` : ''}</li>`).join('');
    return {
      meta,
      html: pageShell(meta, `<article><h1>${escapeHtml(name)}</h1><p>${escapeHtml(description)}</p>${validPrice(bundle.price) ? `<p><strong>${escapeHtml(bundle.price)} RSD</strong></p>` : ''}<section><h2>Kursevi u paketu</h2>${courses ? `<ul>${courses}</ul>` : '<p>Trenutno nema javnih kurseva u paketu.</p>'}</section><p><a href="/edukacije">Sve edukacije</a></p></article>`, origin),
    };
  }

  const centerMatch = pathname.match(/^\/edukacije\/centri\/([a-zA-Z0-9-]+)$/);
  if (centerMatch) {
    const center = await getJson(req, `/api/education/public/centers/${encodeURIComponent(centerMatch[1])}`);
    if (!center) return null;
    const name = center.name || 'Edukativni centar';
    const description = center.description || `Kursevi i edukacije centra ${name}.`;
    const meta = makeMeta(pathname, `${name} | LUMERA edukacije`, description, {
      ...socialImageOptions(center, center.imageUrl),
      schema: buildPageStructuredData('center', center, { origin, canonical: pathname }),
    });
    const courses = (center.courses ?? []).map((course) => card({ href: `/edukacije/${course.id}`, title: course.title, description: course.description, image: course.imageUrl })).join('');
    return { meta, html: pageShell(meta, `<article><h1>${escapeHtml(name)}</h1><p>${escapeHtml(description)}</p>${center.imageUrl ? `<img src="${escapeHtml(center.imageUrl)}" width="960" height="640" alt="${escapeHtml(name)}">` : ''}<section><h2>Programi centra</h2><div class="seo-grid">${courses || '<p>Trenutno nema javnih programa.</p>'}</div></section><p><a href="/edukacije">Sve edukacije</a></p></article>`, origin) };
  }

  const instructorMatch = pathname.match(/^\/edukacije\/instruktori\/([a-zA-Z0-9-]+)$/);
  if (instructorMatch) {
    const instructor = await getJson(req, `/api/education/instructors/${encodeURIComponent(instructorMatch[1])}/public`);
    if (!instructor) return null;
    const name = instructor.name || 'Instruktor';
    const description = instructor.biography || `Upoznajte instruktora ${name} i dostupne beauty edukacije.`;
    const meta = makeMeta(pathname, `${name} | LUMERA edukacije`, description, {
      ...socialImageOptions(instructor, instructor.photoUrl),
      schema: buildPageStructuredData('instructor', instructor, { origin, canonical: pathname }),
    });
    const courses = (instructor.courses ?? []).map((course) => card({ href: `/edukacije/${course.id}`, title: course.title, description: course.description, image: course.imageUrl })).join('');
    return { meta, html: pageShell(meta, `<article><h1>${escapeHtml(name)}</h1><p>${escapeHtml(description)}</p>${instructor.photoUrl ? `<img src="${escapeHtml(instructor.photoUrl)}" width="480" height="480" alt="${escapeHtml(name)}">` : ''}<section><h2>Edukacije instruktora</h2><div class="seo-grid">${courses || '<p>Trenutno nema javnih programa.</p>'}</div></section><p><a href="/edukacije">Sve edukacije</a></p></article>`, origin) };
  }
  return null;
}

function injectDocument(template, page, origin) {
  const canonical = `${origin}${page.meta.pathname}`;
  const imageDetails = `${page.meta.imageWidth ? `<meta property="og:image:width" content="${escapeHtml(page.meta.imageWidth)}">` : ''}${page.meta.imageHeight ? `<meta property="og:image:height" content="${escapeHtml(page.meta.imageHeight)}">` : ''}${page.meta.imageType ? `<meta property="og:image:type" content="${escapeHtml(page.meta.imageType)}">` : ''}`;
  const metadata = `<title>${escapeHtml(page.meta.title)}</title><meta name="description" content="${escapeHtml(page.meta.description)}"><meta name="robots" content="${page.meta.indexable ? 'index, follow' : 'noindex, follow'}"><link rel="canonical" href="${escapeHtml(canonical)}">${page.meta.heroPreload ? `<link rel="preload" as="image" href="${escapeHtml(page.meta.heroPreload)}" fetchpriority="high">` : ''}<meta property="og:title" content="${escapeHtml(page.meta.title)}"><meta property="og:description" content="${escapeHtml(page.meta.description)}"><meta property="og:type" content="website"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:image" content="${escapeHtml(asAbsolute(origin, page.meta.image))}"><meta property="og:image:alt" content="${escapeHtml(page.meta.imageAlt)}">${imageDetails}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(page.meta.title)}"><meta name="twitter:description" content="${escapeHtml(page.meta.description)}"><meta name="twitter:url" content="${escapeHtml(canonical)}"><meta name="twitter:image" content="${escapeHtml(asAbsolute(origin, page.meta.image))}"><meta name="twitter:image:alt" content="${escapeHtml(page.meta.imageAlt)}">`;
  const withoutDefaultMetadata = stripSeoMetadata(template);
  return withoutDefaultMetadata
    .replace('</head>', `${metadata}${page.meta.schema ? `<script type="application/ld+json" data-lumera-structured-data="current-page">${JSON.stringify(page.meta.schema).replace(/</g, '\\u003c')}</script>` : ''}</head>`)
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
  const origin = requestOrigin();
  const entries = [
    ...[...staticPages.values()].filter((page) => page.indexable).map((page) => page.path),
    ...categoryPages.keys(),
  ]
    .map((pathname) => ({
      pathname,
      lastmod: toLastmod(legalPageByPath.get(pathname)?.lastUpdated),
      priority: pathname === '/' ? '1.0' : categoryPages.has(pathname) ? '0.8' : '0.7',
    }));
  const [salons, courses, bundles, suppliers, beautyJobs, taxonomy, inspiration, glossary, brands] = await Promise.all([
    listAll(req, '/api/salons', 24),
    listAll(req, '/api/education/public/courses', 24),
    getJson(req, '/api/education/bundles'),
    getJson(req, '/api/suppliers'),
    listAll(req, '/api/beauty-jobs', 100),
    getJson(req, '/api/education/public/taxonomy'),
    getJson(req, '/api/inspiracija'),
    getJson(req, '/api/recnik'),
    getJson(req, '/api/brendovi'),
  ]);
  const setCollectionLastmod = (pathname, entities) => {
    const entry = entries.find((item) => item.pathname === pathname);
    if (entry) entry.lastmod = latestLastmod(entities) ?? entry.lastmod;
  };
  setCollectionLastmod('/', salons);
  setCollectionLastmod('/saloni', salons);
  setCollectionLastmod('/edukacije', [...courses, ...(bundles ?? [])]);
  setCollectionLastmod('/proizvodi', suppliers);
  setCollectionLastmod('/poslovi', beautyJobs);
  setCollectionLastmod('/inspiracija', inspiration);
  setCollectionLastmod('/recnik', glossary);
  setCollectionLastmod('/brendovi', brands);
  const seenCenters = new Set();
  const seenInstructors = new Set();
  for (const salon of salons) entries.push({ pathname: `/saloni/${encodeURIComponent(salon.slug)}`, lastmod: entityLastmod(salon), priority: '0.8' });
  for (const course of courses) {
    const lastmod = entityLastmod(course);
    entries.push({ pathname: `/edukacije/${encodeURIComponent(course.id)}`, lastmod, priority: '0.8' });
    if (course.centerId && !seenCenters.has(course.centerId)) { seenCenters.add(course.centerId); entries.push({ pathname: `/edukacije/centri/${encodeURIComponent(course.centerId)}`, priority: '0.6' }); }
    if (course.instructorProfileId && !seenInstructors.has(course.instructorProfileId)) { seenInstructors.add(course.instructorProfileId); entries.push({ pathname: `/edukacije/instruktori/${encodeURIComponent(course.instructorProfileId)}`, priority: '0.6' }); }
  }
  for (const bundle of bundles ?? []) {
    entries.push({
      pathname: `/edukacije/paketi/${encodeURIComponent(bundle.id)}`,
      lastmod: entityLastmod(bundle),
      priority: '0.7',
    });
  }
  for (const supplier of (suppliers ?? []).filter(isPublicRetailSupplier)) {
    const supplierPath = `/shop/${encodeURIComponent(supplier.slug)}`;
    const supplierLastmod = entityLastmod(supplier);
    entries.push({ pathname: supplierPath, lastmod: supplierLastmod, priority: '0.8' });
    const [categories, products] = await Promise.all([
      getJson(req, `/api/suppliers/${encodeURIComponent(supplier.slug)}/categories`),
      listAll(req, `/api/suppliers/${encodeURIComponent(supplier.slug)}/public-products`, 100),
    ]);
    for (const category of categories ?? []) {
      if (category.active) entries.push({
        pathname: `${supplierPath}/${category.path.split('/').map(encodeURIComponent).join('/')}`,
        lastmod: entityLastmod(category),
        priority: '0.7',
      });
    }
    for (const product of products) {
      entries.push({ pathname: `${supplierPath}/proizvod/${encodeURIComponent(product.id)}`, lastmod: entityLastmod(product), priority: '0.7' });
    }
  }
  for (const job of beautyJobs) {
    entries.push({ pathname: `/poslovi/${encodeURIComponent(beautyJobSlug(job))}/${encodeURIComponent(job.id)}`, lastmod: entityLastmod(job), priority: '0.7' });
  }

  if (Array.isArray(taxonomy)) {
    for (const section of taxonomy) {
      const sectionLastmod = entityLastmod(section);
      entries.push({ pathname: `/edukacije/sekcije/${encodeURIComponent(section.slug)}`, lastmod: sectionLastmod, priority: '0.7' });
      for (const category of (section.categories || [])) {
        const taxonomyCategoryLastmod = entityLastmod(category);
        entries.push({ pathname: `/edukacije/sekcije/${encodeURIComponent(section.slug)}/${encodeURIComponent(category.slug)}`, lastmod: taxonomyCategoryLastmod, priority: '0.6' });
        for (const sub of (category.subcategories || [])) {
          entries.push({ pathname: `/edukacije/sekcije/${encodeURIComponent(section.slug)}/${encodeURIComponent(category.slug)}/${encodeURIComponent(sub.slug)}`, lastmod: entityLastmod(sub), priority: '0.5' });
        }
      }
    }
  }

  return sitemapXml(origin, entries);
}

function privateDocument(pathname, origin) {
  const meta = makeMeta(pathname, 'LUMERA | Privatna stranica', fallbackDescription, { indexable: false });
  return pageShell(meta, '<article><h1>LUMERA</h1><p>Ova stranica je dostupna u aplikaciji i nije namenjena indeksiranju pretraživača.</p><p><a href="/">Povratak na početnu</a></p></article>', origin);
}

function notFoundDocument(pathname, origin) {
  const meta = makeMeta(pathname, 'Stranica nije pronađena | LUMERA', 'Tražena LUMERA stranica nije pronađena.', { indexable: false });
  return pageShell(meta, '<article><h1>Stranica nije pronađena</h1><p>Proverite adresu ili nastavite pretragu javnog LUMERA sadržaja.</p><form action="/saloni" method="get" role="search"><label for="seo-search">Pretražite salone i tretmane</label><p><input id="seo-search" name="category" type="search" autocomplete="off"> <button type="submit">Pretraži</button></p></form><p><a href="/saloni">Svi saloni</a> · <a href="/edukacije">Beauty edukacije</a> · <a href="/inspiracija">Inspiracija</a> · <a href="/">Početna</a></p></article>', origin);
}

export async function createSeoResponse(req, template) {
  const url = new URL(req.url ?? '/', requestOrigin());
  const pathname = normalizedPublicPath(url.pathname).replace(/\/+$/, '') || '/';
  const origin = requestOrigin();
  const redirectLocation = (targetPath) => canonicalRedirect(req, targetPath, url.search, origin) ?? `${targetPath}${url.search}`;
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
          status: 301,
          type: 'text/plain; charset=utf-8',
          body: 'Permanent redirect to the supplier product listing.',
          headers: { location: redirectLocation(`/shop/${encodeURIComponent(supplier.slug)}/proizvod/${encodeURIComponent(product.id)}`) },
        };
      }
    } catch {
      // Unknown or unavailable legacy products use the normal not-found response.
    }
  }
  if (pathname === '/beauty-poslovi') {
    return {
      status: 301,
      type: 'text/plain; charset=utf-8',
      body: 'Permanent redirect to the canonical Beauty Poslovi catalog.',
      headers: { location: redirectLocation('/poslovi') },
    };
  }
  const legacyBeautyJob = pathname.match(/^\/beauty-poslovi\/([a-zA-Z0-9-]+)$/);
  if (legacyBeautyJob) {
    try {
      const job = await getJson(req, `/api/beauty-jobs/${encodeURIComponent(legacyBeautyJob[1])}`);
      if (job) {
        return {
          status: 301,
          type: 'text/plain; charset=utf-8',
          body: 'Permanent redirect to the canonical Beauty Poslovi listing.',
          headers: { location: redirectLocation(`/poslovi/${encodeURIComponent(beautyJobSlug(job))}/${encodeURIComponent(job.id)}`) },
        };
      }
    } catch {
      // Private fallback below keeps an unknown legacy identifier non-indexable.
    }
  }
  const redirect = canonicalRedirect(req, pathname, url.search, origin);
  if (redirect) return { status: 301, type: 'text/plain; charset=utf-8', body: 'Permanent redirect to the canonical URL.', headers: { location: redirect } };
  if (pathname === '/robots.txt') {
    if (!siteIndexable(req)) return { status: 200, type: 'text/plain; charset=utf-8', body: 'User-agent: *\nDisallow: /\n', headers: { 'X-Robots-Tag': 'noindex, nofollow' } };
    return { status: 200, type: 'text/plain; charset=utf-8', body: `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /vlasnik/\nDisallow: /zaposleni/\nDisallow: /moj-nalog\nDisallow: /korpa\nDisallow: /porudzbina/pracenje\nDisallow: /biznis/\nDisallow: /prijava\nDisallow: /poslovna-\nDisallow: /student/\nDisallow: /widget/\nDisallow: /beauty-poslovi/\nDisallow: /pridruzi-se-\nSitemap: ${origin}/sitemap.xml\n` };
  }
  if (pathname === '/sitemap.xml') {
    try { return { status: 200, type: 'application/xml; charset=utf-8', body: await buildSitemap(req) }; }
    catch {
      const staticEntries = [...staticPages.values()]
        .filter((page) => page.indexable)
        .map((page) => page.path)
        .map((pathname) => ({ pathname, lastmod: toLastmod(legalPageByPath.get(pathname)?.lastUpdated) }));
      return { status: 503, type: 'application/xml; charset=utf-8', body: sitemapXml(origin, staticEntries) };
    }
  }
  const hasQuery = url.search.length > 0;
  try {
    const page = await renderPublicPage(req, pathname);
    if (page && hasQuery) {
      const canonicalPath = listingCanonical(pathname, url.search);
      page.meta = {
        ...page.meta,
        pathname: canonicalPath,
        indexable: page.meta.indexable && listingIndexable(pathname, url.search),
      };
    }
    if (page) return { status: 200, type: 'text/html; charset=utf-8', body: applySitePolicy(injectDocument(template, page, origin), req) };
  } catch {
    // Fall through to the client app with a non-indexable response. Public API
    // outages must never cause a private-page-looking response to be indexed.
  }
  const queryCanonical = hasQuery
    ? `<link rel="canonical" href="${escapeHtml(`${origin}${listingCanonical(pathname, url.search)}`)}">`
    : '';
  const privateHead = `<title>LUMERA | Privatna stranica</title><meta name="description" content="${escapeHtml(fallbackDescription)}"><meta name="robots" content="noindex, follow">${queryCanonical}`;
  const fallbackDocument = hasQuery ? privateDocument(pathname, origin) : notFoundDocument(pathname, origin);
  const html = stripSeoMetadata(template)
    .replace('</head>', `${privateHead}</head>`)
    .replace('<div id="root"></div>', `${fallbackDocument}<div id="root"></div>`);
  return { status: hasQuery ? 200 : 404, type: 'text/html; charset=utf-8', body: applySitePolicy(html, req) };
}

const mimeTypes = { '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

export async function startSeoServer() {
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

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) void startSeoServer();