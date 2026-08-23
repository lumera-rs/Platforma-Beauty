import categoryDefinitions from "./public-category-pages.json";

export type PublicCategoryPage = {
  slug: string;
  path: string;
  apiCategory: string;
  label: string;
  h1: string;
  title: string;
  description: string;
  intro: string;
};

export const PUBLIC_CATEGORY_PAGES: readonly PublicCategoryPage[] = categoryDefinitions;

export function getPublicCategoryPage(slug: string | undefined): PublicCategoryPage | undefined {
  return PUBLIC_CATEGORY_PAGES.find((page) => page.slug === slug);
}

export function getPublicCategoryPath(page: PublicCategoryPage): string {
  return page.path;
}