export const cityLocatives: Readonly<Record<string, string>>;
export function cityLocative(city?: string | null): string | null;
export function cityPhrase(city?: string | null): string;
export function publicSalonCategories(salon: { services?: { category?: string | null }[] }): string[];
export function categoryListingHref(category: string): string;
export function publicImageAlt(input?: { name?: string | null; category?: string | null; city?: string | null; description?: string | null }): string;