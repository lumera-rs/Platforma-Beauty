import { publicSalonAddress } from './public-salon-address.mjs';
// Schema values come only from the public DTO and the accompanying visible SSR
// content. Do not pass private database records to these helpers.
export function compactSchema(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return undefined;
  if (Array.isArray(value)) {
    const items = value.map(compactSchema).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([key]) => key !== 'sameAs')
      .map(([key, item]) => [key, compactSchema(item)])
      .filter(([, item]) => item !== undefined);
    return entries.some(([key]) => !key.startsWith('@') || key === '@graph' || key === '@id') ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

export function schemaImage(origin, value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value, origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

const days = ['Ponedeljak', 'Utorak', 'Sreda', 'Četvrtak', 'Petak', 'Subota', 'Nedelja'];
const schemaDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function salonStructuredData(salon, origin, pathname, description) {
  if (!salon.name || !publicSalonAddress(salon)?.postalAddress.addressLocality) return null;
  const services = salon.services ?? [];
  const prices = services.map((service) => service.promoPrice ?? service.price)
    .filter((price) => typeof price === 'number' && Number.isFinite(price) && price >= 0);
  const priceRange = prices.length ? `${Math.min(...prices)}–${Math.max(...prices)} RSD` : undefined;
  const hours = (salon.hours ?? []).flatMap((hour) => {
    const index = days.indexOf(hour.day);
    if (index < 0 || hour.closed || !/^\d{2}:\d{2}$/.test(hour.open) || !/^\d{2}:\d{2}$/.test(hour.close)) return [];
    return [{ '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${schemaDays[index]}`, opens: hour.open, closes: hour.close }];
  });
  return {
    '@context': 'https://schema.org',
    '@type': 'HealthAndBeautyBusiness',
    name: salon.name, description, url: `${origin}${pathname}`,
    image: schemaImage(origin, salon.imageUrl ?? salon.gallery?.[0]),
    // Telephone and coordinates remain private; only street/locality are public.
    address: publicSalonAddress(salon)?.postalAddress ?? (salon.city ? { '@type': 'PostalAddress', addressLocality: salon.city } : undefined),
    openingHoursSpecification: hours,
    priceRange,
    hasOfferCatalog: prices.length ? {
      '@type': 'OfferCatalog', name: 'Usluge',
       itemListElement: services.filter(service => validPrice(service.promoPrice ?? service.price)).map((service) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: service.name },
        price: service.promoPrice ?? service.price,
        priceCurrency: (service.promoPrice ?? service.price) != null ? 'RSD' : undefined,
      })),
    } : undefined,
    aggregateRating: Number.isInteger(salon.reviewCount) && salon.reviewCount > 0 && Number.isFinite(salon.rating) && salon.rating > 0 && salon.rating <= 5 ? {
      // Same presentation precision as salon-profile.tsx; do not recompute
      // the aggregate from the subset of reviews included in the response.
      '@type': 'AggregateRating', ratingValue: Number(salon.rating.toFixed(1)), reviewCount: salon.reviewCount,
    } : undefined,
     review: publicReviews(salon).filter((review) => Number.isFinite(review.rating) && review.rating > 0 && review.rating <= 5 && typeof review.authorName === 'string' && review.authorName.trim()).map((review) => ({
      '@type': 'Review', author: review.authorName ? { '@type': 'Person', name: review.authorName } : undefined,
      reviewRating: { '@type': 'Rating', ratingValue: review.rating },
      reviewBody: review.text,
       datePublished: validDate(review.date),
    })),
  };
}

export function validPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10) ? value : undefined;
}
export function publicJobDate(job) {
  return validDate(job.publishedAt ?? job.createdAt);
}
export function publicReviews(salon) {
  return [...(salon.reviews ?? [])].sort((a, b) => (Date.parse(validDate(b.date) ?? '') || 0) - (Date.parse(validDate(a.date) ?? '') || 0)).slice(0, 5);
}
export function breadcrumbStructuredData(origin, crumbs = []) {
  return { '@type': 'BreadcrumbList', itemListElement: (crumbs[0]?.pathname === '/' ? crumbs : [{ name: 'Početna', pathname: '/' }, ...crumbs]).map((crumb, index) => ({ '@type': 'ListItem', position: index + 1, name: crumb.name, item: new URL(crumb.pathname, origin).href })) };
}
export function buildPageStructuredData(type, data, { origin, canonical, description, breadcrumbs } = {}) {
  const url = new URL(canonical || '/', origin).href;
  let schema;
  if (type === 'home') schema = {
    '@graph': [
      { '@type': 'Organization', '@id': `${origin}/#organization`, name: 'LUMERA', url: `${origin}/` },
      { '@type': 'WebSite', '@id': `${origin}/#website`, name: 'LUMERA', url: `${origin}/`,
        description: data.description ?? description, publisher: { '@id': `${origin}/#organization` },
        potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${origin}/saloni?category={search_term_string}` }, 'query-input': 'required name=search_term_string' } },
    ],
  };
  if (type === 'list') schema = {
    '@type': 'ItemList', name: data.name,
    itemListElement: (data.items ?? []).map((item, index) => ({
      '@type': 'ListItem', position: index + 1, name: item.name,
      url: item.pathname ? new URL(item.pathname, origin).href : undefined,
    })),
  };
  if (type === 'static') return compactSchema({
    '@context': 'https://schema.org',
    '@graph': [breadcrumbStructuredData(origin, breadcrumbs ?? [{ name: data.name, pathname: canonical }])],
  });
  if (type === 'salon') schema = salonStructuredData(data, origin, new URL(url).pathname, description ?? data.description ?? data.shortDescription);
  if (type === 'course' && data.title && data.description && data.publisher) schema = {
    '@type': 'Course', name: data.title, description: data.description,
    provider: { '@type': 'Organization', name: data.publisher }, image: schemaImage(origin, data.imageUrl),
  };
  if (type === 'job') {
    if (data.type !== 'job' || data.intent !== 'offering') schema = { '@type': 'WebPage', name: data.title, description: data.description, url };
    else if (data.title?.trim() && data.description?.trim() && data.authorDisplayName?.trim() && data.city?.trim() && publicJobDate(data)) schema = {
      '@type': 'JobPosting', title: data.title, description: data.description, datePosted: publicJobDate(data),
      hiringOrganization: { '@type': 'Organization', name: data.authorDisplayName },
      jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: data.city, addressRegion: data.region, addressCountry: 'RS' } }, url,
    };
  }
  if (type === 'product' || type === 'bundle') {
    const price = data.discountPrice ?? data.price;
    // Bundle pages currently display no product image. Never manufacture one.
    if (type === 'product' && data.name && schemaImage(origin, data.imageUrl) && validPrice(price)) schema = {
      '@type': 'Product', name: data.name, description: data.description, image: schemaImage(origin, data.imageUrl),
      brand: data.brand ? { '@type': 'Brand', name: data.brand } : undefined, category: data.category,
      offers: { '@type': 'Offer', price, priceCurrency: 'RSD', url },
    };
  }
  if (type === 'center' || type === 'instructor') schema = {
    '@type': type === 'center' ? 'EducationalOrganization' : 'Person', name: data.name,
    description: type === 'center' ? data.description : data.biography,
    image: schemaImage(origin, type === 'center' ? data.imageUrl : data.photoUrl), url,
  };
  return compactSchema(breadcrumbs?.length
    ? { '@context': 'https://schema.org', '@graph': [schema, breadcrumbStructuredData(origin, breadcrumbs)] }
    : schema ? { '@context': 'https://schema.org', ...schema } : null) ?? null;
}