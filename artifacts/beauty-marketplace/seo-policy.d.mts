export function listingPage(search?: string): number;
export function listingCanonical(pathname: string, search?: string): string;
export function publicSiteOrigin(env?: Record<string, string | undefined>): string;
export function requestHost(req: any): string;
export function siteIndexable(req: any, env?: Record<string, string | undefined>): boolean;
export function applySitePolicy(html: string, req: any, env?: Record<string, string | undefined>): string;
export function normalizedPublicPath(pathname: string): string;
export function canonicalRedirect(req: any, pathname: string, search: string, origin: string): string | null;