// Consume only the public profile DTO. No coordinates or contact fields.
export function publicSalonAddress(salon) {
  if (salon.active === false || salon.published === false || salon.hideAddress === true) return null;
  if (typeof salon.address !== 'string' || !salon.address.trim()) return null;
  const locality = [salon.postalCode, salon.city].filter((value) => typeof value === 'string' && value.trim()).join(' ');
  const text = [salon.address, locality].filter(Boolean).join(', ');
  return {
    text,
    href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([text, 'Serbia'].join(', '))}`,
    postalAddress: {
      '@type': 'PostalAddress',
      streetAddress: salon.address,
      postalCode: salon.postalCode || undefined,
      addressLocality: salon.city || undefined,
      addressCountry: 'RS',
    },
  };
}