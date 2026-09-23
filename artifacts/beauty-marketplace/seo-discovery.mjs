import { listingCanonical, normalizeCity, publicSiteOrigin } from './seo-policy.mjs';
import staticPages from './src/lib/static-seo-pages.json' with { type: 'json' };
import categoryPages from './src/lib/public-category-pages.json' with { type: 'json' };

// Robots is a crawl inventory, not an authorization boundary. Public API and
// asset requests inherit Allow: /; never block /api or a public detail family.
export const robotsInventory = Object.freeze([
  ...['/admin', '/vlasnik', '/zaposleni', '/moj-nalog', '/biznis', '/student', '/poslovi/nalog',
    '/korpa', '/porudzbina/pracenje', '/widget'].map(path => ({ path, reason: 'Private account, operation, checkout or embedded workflow', subtree: true })),
  ...['/prijava', '/poslovna-prijava', '/poslovna-registracija', '/postavi-lozinku',
    '/pridruzi-se-edukativni-centar', '/moji-oglasi', '/beauty-poslovi/novi',
    '/beauty-poslovi/moji-oglasi', '/beauty-poslovi/prijave',
    '/edukacije/lista-zelja', '/edukacije/vauceri', '/edukacije/moji-paketi']
    .map(path => ({ path, reason: 'Authentication or private user action', subtree: true })),
  ...['/saloni', '/saloni/kategorija/*', '/edukacije', '/edukacije/sekcije/*', '/poslovi', '/proizvodi', '/shop/*']
    .flatMap(path => ['search', 'q'].map(key => ({
      path: `${path}?*${key}=`, reason: 'Internal search on public listing UI only; never an asset or API query', pattern: true,
    }))),
  { path: '/poslovi?*query=', reason: 'Beauty jobs UI text-search parameter', pattern: true },
  ...['/api/auth', '/api/admin', '/api/internal', '/api/customer', '/api/salon',
    '/api/employee', '/api/business', '/api/jobseeker', '/api/appointments',
    '/api/booking-commands', '/api/booking-groups', '/api/orders', '/api/shop/quotes',
    '/api/growth', '/api/retail/cart', '/api/retail/cart-summary', '/api/retail/checkout-preview',
    '/api/retail/orders', '/api/retail/wishlist', '/api/referrals/dashboard',
    '/api/loyalty/status', '/api/featured-placements/mine']
    .map(path => ({ path, reason: 'Private/authenticated API namespace (source: marketplace, phase3, commerce-ef and booking routes)', subtree: true })),
  ...['/api/education/courses', '/api/education/centers', '/api/education/center',
    '/api/education/enrollments', '/api/education/notifications', '/api/education/placements/mine',
    '/api/education/wishlist', '/api/education/gift-vouchers', '/api/education/purchases',
    '/api/education/disputes', '/api/education/subscription/status', '/api/education/operations',
    '/api/education/b2b', '/api/education/bundle-purchases', '/api/education/payment-slips',
    '/api/beauty-jobs/mine', '/api/beauty-jobs/saved', '/api/beauty-jobs/inbox',
    '/api/beauty-jobs/notifications', '/api/beauty-jobs/rental-requests']
    .map(path => ({ path, reason: 'Authenticated education or job account API; public sibling routes remain crawlable', subtree: true })),
  { path: '/api/education/instructors', reason: 'Instructor management list; public profile GET is a separate child', subtree: true },
  ...['/api/beauty-jobs/*/applicants', '/api/beauty-jobs/*/messages',
    '/api/education/bundles/*/purchases']
    .map(path => ({ path, reason: 'Private action beneath a public detail API', pattern: true })),
  // Explicit public reads document mixed-method namespaces. Robots cannot
  // distinguish GET from POST; mutation security remains authorization's job.
  ...['/assets/', '/api/salons', '/api/suppliers', '/api/beauty-jobs',
    '/api/education/public/', '/api/education/bundles', '/api/education/subscription/plans',
    '/api/education/instructors/*/public', '/api/media/',
    '/api/education/courses/*/availability', '/api/growth/packages/public',
    '/api/inspiracija', '/api/recnik', '/api/brendovi',
    '/api/cities', '/api/category-images', '/api/discovery/', '/api/b2c/']
    .map(path => ({ path, directive: 'Allow', reason: 'Anonymous public read API or rendering asset; do not block mixed-method public GET' })),
]);

export function formatRobots({ indexable, origin }) {
  if (!indexable) return 'User-agent: *\nDisallow: /\n';
  const base = publicSiteOrigin({ PUBLIC_SITE_URL: origin });
  const rules = robotsInventory.flatMap(({ path, subtree, directive }) => directive === 'Allow' ? [`Allow: ${path}`] : subtree
    ? [`Disallow: ${path}$`, `Disallow: ${path}?`, `Disallow: ${path}/`]
    : [`Disallow: ${path}`]);
  return `User-agent: *\nAllow: /\n${rules.join('\n')}\nSitemap: ${base}/sitemap.xml\n`;
}

export const sitemapTypes = Object.freeze(['salons', 'cities', 'education', 'jobs', 'products', 'content']);
const xmlEscape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const segment = value => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Discovery entity is missing its canonical identifier');
  return encodeURIComponent(value);
};

// Creation/publication are not modification evidence. In particular, never
// substitute the generation time for a missing public DTO updatedAt.
export function discoveryLastmod(entity) {
  for (const value of [entity?.updatedAt, entity?.modifiedAt]) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) continue;
    const date = new Date(value);
    if (Number.isFinite(date.valueOf())) return date.toISOString();
  }
  return undefined;
}

function arrayDto(value, endpoint) {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error(`Invalid discovery array DTO: ${endpoint}`);
  }
  return value;
}

// API predicates are the authority: these are the same anonymous read endpoints
// used by SSR. No credentials, local database, or HTTP self-page requests here.
export async function readDiscoveryPages(fetchJson, endpoint, apiOrigin, pageSize = 24) {
  const result = [];
  const seen = new Set();
  for (let page = 1; ; page += 1) {
    const url = new URL(endpoint, apiOrigin);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(pageSize));
    const payload = await fetchJson(`${url.pathname}${url.search}`, apiOrigin);
    const rows = arrayDto(Array.isArray(payload) ? payload : payload?.items, endpoint);
    if (rows.length > pageSize) throw new Error(`Discovery API ignored pageSize: ${endpoint}`);
    for (const row of rows) {
      const key = row.id ?? row.slug;
      if (!key || seen.has(key)) throw new Error(`Discovery pagination repeated/missing identifier: ${endpoint}`);
      seen.add(key);
    }
    result.push(...rows);
    const total = Array.isArray(payload) ? undefined : payload.total ?? payload.totalCount;
    if (total !== undefined && (!Number.isSafeInteger(total) || total < result.length)) throw new Error(`Invalid discovery total: ${endpoint}`);
    if (total !== undefined && result.length === total) return result;
    if (rows.length < pageSize) {
      if (total !== undefined) throw new Error(`Truncated discovery pagination: ${endpoint}`);
      return result;
    }
  }
}

function jobSlug(job) {
  return typeof job.slug === 'string' && job.slug.trim() ? job.slug.trim()
    : String(job.title ?? 'oglas').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'oglas';
}

async function discover(fetchJson, apiOrigin) {
  const groups = Object.fromEntries(sitemapTypes.map(type => [type, new Map()]));
  const diagnostics = { missingLastmod: [], omitted: [] };
  const add = (type, pathname, entity) => {
    const lastmod = discoveryLastmod(entity);
    groups[type].set(pathname, { pathname, lastmod });
    if (!lastmod) diagnostics.missingLastmod.push({ type, pathname, reason: 'No valid public updatedAt/modifiedAt; lastmod omitted' });
  };
  const read = async endpoint => arrayDto(await fetchJson(endpoint, apiOrigin), endpoint);
  const paged = endpoint => readDiscoveryPages(fetchJson, endpoint, apiOrigin);
  const [salons, courses, jobs, suppliers, bundles, taxonomy] = await Promise.all([
    paged('/api/salons'), paged('/api/education/public/courses'), paged('/api/beauty-jobs'),
    read('/api/suppliers'), read('/api/education/bundles'), read('/api/education/public/taxonomy'),
  ]);
  // Static definitions are the SSR definitions, not a second manually curated list.
  for (const page of staticPages.filter(page => page.indexable)) add('content', page.path);
  for (const page of categoryPages) add('content', page.path);
  for (const salon of salons) {
    if (salon.active === false) continue;
    add('salons', `/saloni/${segment(salon.slug)}`, salon);
    if (typeof salon.city === 'string' && salon.city.trim()) {
      // Shared NFC/case/whitespace normalization also governs page canonicals.
      const cityPath = listingCanonical('/saloni', new URLSearchParams({ city: normalizeCity(salon.city) }).toString());
      if (!groups.cities.has(cityPath)) add('cities', cityPath);
    }
  }
  const centers = new Set();
  const instructors = new Set();
  for (const course of courses) {
    add('education', `/edukacije/${segment(course.id)}`, course);
    if (course.centerId) centers.add(course.centerId);
    if (course.instructorProfileId) instructors.add(course.instructorProfileId);
  }
  // Relations alone do not prove that a public detail page is available.
  for (const [ids, endpoint, prefix] of [
    [centers, id => `/api/education/public/centers/${segment(id)}`, '/edukacije/centri'],
    [instructors, id => `/api/education/instructors/${segment(id)}/public`, '/edukacije/instruktori'],
  ]) {
    for (const id of ids) {
      try {
        const entity = await fetchJson(endpoint(id), apiOrigin);
        if (!entity || typeof entity !== 'object' || Array.isArray(entity)
          || entity.id !== id || typeof entity.name !== 'string' || !entity.name.trim()
          || !Array.isArray(entity.courses)) throw new Error(`Invalid discovery detail DTO: ${endpoint(id)}`);
        add('education', `${prefix}/${segment(id)}`, entity);
      } catch (error) {
        if (error?.status !== 404 && error?.status !== 410) throw error;
        diagnostics.omitted.push({ pathname: `${prefix}/${segment(id)}`, reason: `Public detail returned ${error.status}` });
      }
    }
  }
  for (const bundle of bundles) add('education', `/edukacije/paketi/${segment(bundle.id)}`, bundle);
  for (const section of taxonomy) {
    const root = `/edukacije/sekcije/${segment(section.slug)}`;
    add('education', root, section);
    for (const category of arrayDto(section.categories ?? [], '/taxonomy/categories')) {
      const path = `${root}/${segment(category.slug)}`;
      add('education', path, category);
      for (const sub of arrayDto(category.subcategories ?? [], '/taxonomy/subcategories')) add('education', `${path}/${segment(sub.slug)}`, sub);
    }
  }
  for (const job of jobs) add('jobs', `/poslovi/${segment(jobSlug(job))}/${segment(job.id)}`, job);
  for (const supplier of suppliers.filter(s => s.active && ['B2C', 'BOTH'].includes(s.scope))) {
    const path = `/shop/${segment(supplier.slug)}`;
    add('products', path, supplier);
    const endpoint = `/api/suppliers/${segment(supplier.slug)}`;
    const [categories, products] = await Promise.all([read(`${endpoint}/categories`), paged(`${endpoint}/public-products`)]);
    for (const category of categories.filter(c => c.active)) add('products', `${path}/${category.path.split('/').map(segment).join('/')}`, category);
    for (const product of products) add('products', `${path}/proizvod/${segment(product.id)}`, product);
  }
  return { groups, diagnostics };
}

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
const namespace = 'http://www.sitemaps.org/schemas/sitemap/0.9';
export function renderSitemapDocuments(origin, groups, maxUrls = 50000) {
  const base = publicSiteOrigin({ PUBLIC_SITE_URL: origin });
  if (!Number.isInteger(maxUrls) || maxUrls < 1 || maxUrls > 50000) throw new Error('Sitemap child limit must be 1–50000');
  const documents = new Map();
  for (const type of sitemapTypes) {
    const entries = [...groups[type].values()].sort((a, b) => a.pathname.localeCompare(b.pathname));
    const count = Math.max(1, Math.ceil(entries.length / maxUrls));
    for (let part = 0; part < count; part += 1) {
      const pathname = `/sitemaps/${type}${part ? `-${part + 1}` : ''}.xml`;
      const urls = entries.slice(part * maxUrls, (part + 1) * maxUrls).map(entry =>
        `<url><loc>${xmlEscape(`${base}${entry.pathname}`)}</loc>${entry.lastmod ? `<lastmod>${xmlEscape(entry.lastmod)}</lastmod>` : ''}</url>`).join('');
      documents.set(pathname, `${xmlHeader}<urlset xmlns="${namespace}">${urls}</urlset>`);
    }
  }
  if (documents.size > 50000) throw new Error('Sitemap index exceeds 50000 children');
  documents.set('/sitemap.xml', `${xmlHeader}<sitemapindex xmlns="${namespace}">${[...documents.keys()].map(path =>
    `<sitemap><loc>${xmlEscape(`${base}${path}`)}</loc></sitemap>`).join('')}</sitemapindex>`);
  return documents;
}

export function createSitemapDiscovery({ fetchJson, cacheTtlMs = 300000, maxUrls = 50000, now = Date.now }) {
  if (typeof fetchJson !== 'function') throw new Error('Discovery requires an anonymous, strict API JSON reader');
  if (!Number.isFinite(cacheTtlMs) || cacheTtlMs < 0) throw new Error('Invalid discovery cache TTL');
  const cache = new Map();
  return {
    clear() { cache.clear(); },
    async get({ origin, apiOrigin, pathname }) {
      if (pathname !== '/sitemap.xml' && !/^\/sitemaps\/(salons|cities|education|jobs|products|content)(?:-[2-9]\d*|-1\d+)?\.xml$/.test(pathname)) return null;
      const base = publicSiteOrigin({ PUBLIC_SITE_URL: origin });
      const api = new URL(apiOrigin);
      if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.pathname !== '/' || api.search || api.hash) throw new Error('Invalid discovery API origin');
      const key = JSON.stringify([base, api.origin]);
      let entry = cache.get(key);
      if (!entry || entry.expiresAt <= now()) {
        entry = { expiresAt: Infinity };
        entry.pending = discover(fetchJson, api.origin).then(({ groups, diagnostics }) => {
          entry.expiresAt = now() + cacheTtlMs;
          return { documents: renderSitemapDocuments(base, groups, maxUrls), diagnostics };
        }).catch(error => {
          if (cache.get(key) === entry) cache.delete(key);
          throw error; // Never cache failure, serve partial inventories or stale tombstones.
        });
        cache.set(key, entry);
      }
      const { documents, diagnostics } = await entry.pending;
      const xml = documents.get(pathname);
      return xml === undefined ? null : { xml, diagnostics };
    },
  };
}