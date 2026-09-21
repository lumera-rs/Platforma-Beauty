export function publicSalonAddress(salon: {
  address?: string; postalCode?: string | null; city?: string;
  entranceDirections?: string | null; intercom?: string | null;
  floor?: string | null; apartment?: string | null;
  active?: boolean; published?: boolean; hideAddress?: boolean;
}): null | { text: string; href: string; postalAddress: {
  '@type': string; streetAddress: string; postalCode?: string;
  addressLocality?: string; addressCountry: string;
} };