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

export const NON_SEO_SEARCH_CATEGORIES = [
  "Kozmetički saloni",
  "Depilacija",
  "Wellness",
] as const;

export const HOME_SEARCH_CATEGORIES = [
  ...PUBLIC_CATEGORY_PAGES.map((page) => page.apiCategory),
  ...NON_SEO_SEARCH_CATEGORIES,
].filter((category, index, allCategories) => allCategories.indexOf(category) === index);

export function getPublicCategoryPage(slug: string | undefined): PublicCategoryPage | undefined {
  return PUBLIC_CATEGORY_PAGES.find((page) => page.slug === slug);
}

export function getPublicCategoryPath(page: PublicCategoryPage): string {
  return page.path;
}