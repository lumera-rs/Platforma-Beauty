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
  const services = (salon.services ?? []).slice(0, 24);
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
    hasOfferCatalog: services.length ? {
      '@type': 'OfferCatalog', name: 'Usluge',
      itemListElement: services.map((service) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: service.name },
        price: service.promoPrice ?? service.price,
        priceCurrency: (service.promoPrice ?? service.price) != null ? 'RSD' : undefined,
      })),
    } : undefined,
    aggregateRating: salon.reviewCount > 0 && salon.rating > 0 ? {
      // Same presentation precision as salon-profile.tsx; do not recompute
      // the aggregate from the subset of reviews included in the response.
      '@type': 'AggregateRating', ratingValue: Number(salon.rating.toFixed(1)), reviewCount: salon.reviewCount,
    } : undefined,
    review: (salon.reviews ?? []).filter((review) => review.rating > 0).map((review) => ({
      '@type': 'Review', author: review.authorName ? { '@type': 'Person', name: review.authorName } : undefined,
      reviewRating: { '@type': 'Rating', ratingValue: review.rating },
      reviewBody: review.text,
    })),
  };
}