import staticPages from './src/lib/static-seo-pages.json' with { type: 'json' };

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