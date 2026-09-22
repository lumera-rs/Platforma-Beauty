import staticPages from './src/lib/static-seo-pages.json' with { type: 'json' };

export function normalizedQuery(search = '') {
  const params = new URLSearchParams([...new URLSearchParams(search)].filter(([, value]) => value !== ''));
  params.sort();
  return params;
}

export function normalizeCity(value = '') {
  return String(value).normalize('NFC').trim().replace(/\s+/gu, ' ')
    .toLocaleLowerCase('sr-Latn').replace(/(^|[\s-])(\p{L})/gu,
      (_, separator, letter) => separator + letter.toLocaleUpperCase('sr-Latn'));
}

export function listingPage(search = '') {
  const value = new URLSearchParams(search).get('page');
  return value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : 1;
}
export function listingCanonical(pathname, search = '') {
  const params = normalizedQuery(search);
  if (!['/saloni', '/edukacije', '/poslovi'].includes(pathname)
    && !pathname.startsWith('/saloni/kategorija/')
    && !pathname.startsWith('/edukacije/sekcije/')
    && !(/^\/shop\/[^/]+(?:\/.*)?$/.test(pathname) && !pathname.includes('/proizvod/'))) return pathname;
  const pageValue = params.get('page');
  const page = pageValue && /^[1-9]\d*$/.test(pageValue) && Number.isSafeInteger(Number(pageValue))
    ? Number(pageValue)
    : 1;

  if (pathname === '/saloni') {
    const cities = params.getAll('city').map(normalizeCity).filter(Boolean);
    const canonical = new URLSearchParams();
    if (cities.length === 1) canonical.set('city', cities[0]);

    const filters = new URLSearchParams(params);
    filters.delete('page');
    filters.delete('pageSize');
    const isPlainOrCityOnly = filters.size === 0
      || (filters.size === 1 && filters.has('city') && cities.length === 1);
    if (isPlainOrCityOnly && page >= 2) canonical.set('page', String(page));
    canonical.sort();
    return canonical.size ? `${pathname}?${canonical}` : pathname;
  }

  if (pathname.startsWith('/shop/') || pathname.startsWith('/saloni/kategorija/')
    || pathname.startsWith('/edukacije/sekcije/')) {
    return params.size ? `${pathname}?${params}` : pathname;
  }

  // Page one always folds into the unpaginated parent. Existing page two and
  // later listing contracts retain their filters.
  if (page < 2) return pathname;
  params.set('page', String(page));
  params.sort();
  return `${pathname}?${params}`;
}

export function listingIndexable(pathname, search = '') {
  const params = normalizedQuery(search);
  if (pathname !== '/saloni') return params.size === 0;
  params.delete('pageSize');
  if (params.get('page') === '1') params.delete('page');
  params.sort();
  const normalizedRequest = params.size ? `${pathname}?${params}` : pathname;
  return listingCanonical(pathname, search) === normalizedRequest;
}

export function publicSiteOrigin(env = process.env) {
  const value = env.PUBLIC_SITE_URL || env.LUMERA_PUBLIC_URL;
  if (!value) throw new Error('PUBLIC_SITE_URL must be configured.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_SITE_URL must be an HTTPS origin without credentials, path, query or hash.');
  }
  url.hostname = url.hostname.replace(/^www\./i, '');
  return url.origin;
}

export function requestHost(req) {
  return String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim().toLowerCase();
}

export function siteIndexable(req, env = process.env) {
  return env.SITE_INDEXABLE === 'true' && requestHost(req) === new URL(publicSiteOrigin(env)).host;
}

export function applySitePolicy(html, req, env = process.env) {
  const origin = publicSiteOrigin(env);
  const allowed = siteIndexable(req, env);
  let document = html.replace(/<meta name="lumera:(?:public-site-url|site-indexable)"[^>]*>\s*/gi, '');
  if (!allowed) document = document.replace(/<meta name="robots"[^>]*>\s*/gi, '');
  return document.replace('</head>', `${!allowed ? '<meta name="robots" content="noindex, nofollow">' : ''}<meta name="lumera:public-site-url" content="${origin}"><meta name="lumera:site-indexable" content="${allowed}"></head>`);
}

// Only human-readable public routes are case-normalized. API paths, asset
// names, account routes and opaque entity IDs must retain their exact bytes.
export function normalizedPublicPath(pathname) {
  const trimmed = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  const lower = trimmed.toLowerCase();
  if (/^\/poslovi\/nalog(?:\/|$)/.test(lower)
    || /^\/beauty-poslovi\/(?:novi|moji-oglasi|prijave)(?:\/|$)/.test(lower)) return pathname;
  if (staticPages.some(page => page.path === lower)
    || ['/robots.txt', '/sitemap.xml', '/beauty-poslovi'].includes(lower)
    || /^\/saloni\/(?:kategorija\/)?[^/]+$/.test(lower)
    || /^\/edukacije\/sekcije\/[^/]+(?:\/[^/]+){0,2}$/.test(lower)) return lower;
  const match = trimmed.match(/^\/(edukacije|poslovi|beauty-poslovi|proizvodi|shop)(\/.*)$/i);
  if (!match) return pathname;
  const parts = trimmed.split('/');
  parts[1] = parts[1].toLowerCase();
  if (parts[1] === 'shop') {
    parts[2] = parts[2]?.toLowerCase();
    if (parts[3]?.toLowerCase() === 'proizvod') parts[3] = 'proizvod';
    else return trimmed.toLowerCase(); // public category slugs
  } else if (parts[1] === 'poslovi' && parts.length === 4) {
    parts[2] = parts[2].toLowerCase();
  } else if (parts[1] === 'edukacije' && parts.length === 4
    && ['paketi', 'centri', 'instruktori'].includes(parts[2].toLowerCase())) {
    parts[2] = parts[2].toLowerCase();
  }
  // UUIDs are case-insensitive; other IDs remain untouched.
  const last = parts.length - 1;
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(parts[last])) parts[last] = parts[last].toLowerCase();
  return parts.join('/');
}

export function canonicalRedirect(req, pathname, search, origin) {
  if (req.method && !['GET', 'HEAD'].includes(req.method)) return null;
  const target = new URL(origin);
  const host = requestHost(req);
  // Never send staging visitors to the production host.
  if (host !== target.host && host !== `www.${target.host}`) return null;
  const original = new URL(req.url ?? '/', origin);
  if (/^\/poslovi\/nalog(?:\/|$)/i.test(original.pathname)
    || /^\/beauty-poslovi\/(?:novi|moji-oglasi|prijave)(?:\/|$)/i.test(original.pathname)) return null;
  const normalized = normalizedPublicPath(original.pathname);
  const isPublic = normalized !== original.pathname || staticPages.some(page => page.path === normalized)
    || /^\/(?:saloni|edukacije|poslovi|beauty-poslovi|proizvodi|shop)(?:\/|$)/.test(normalized)
    || ['/robots.txt', '/sitemap.xml'].includes(normalized);
  if (!isPublic) return null;
  const proto = String(req.headers['x-forwarded-proto'] ?? (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim();
  if (proto !== 'https' || host !== target.host || original.pathname !== pathname) {
    return `${origin}${pathname}${search}`;
  }
  return null;
}