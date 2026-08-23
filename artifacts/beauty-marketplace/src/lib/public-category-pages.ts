export type PublicCategoryPage = {
  slug: string;
  apiCategory: string;
  label: string;
  h1: string;
  title: string;
  description: string;
  intro: string;
};

export const PUBLIC_CATEGORY_PAGES: readonly PublicCategoryPage[] = [
  {
    slug: "frizerski-saloni",
    apiCategory: "Frizerski saloni",
    label: "Frizerski saloni",
    h1: "Frizerski saloni u Srbiji",
    title: "Frizerski saloni u Srbiji | LUMERA",
    description: "Pronađite najbolje frizerske salone u Srbiji, pregledajte usluge, ocene i cene i rezervišite termin online.",
    intro: "Istražite proverene frizerske salone za šišanje, feniranje, farbanje i stilizovanje kose.",
  },
  {
    slug: "nokti",
    apiCategory: "Nokti",
    label: "Saloni za nokte",
    h1: "Saloni za nokte u Srbiji",
    title: "Saloni za nokte u Srbiji | LUMERA",
    description: "Pronađite salone za manikir, gel lak i pedikir u Srbiji. Uporedite ocene i cene i rezervišite termin online.",
    intro: "Pronađite stručnjake za manikir, gel lak, izlivanje noktiju i pedikir u vašem gradu.",
  },
  {
    slug: "masaza",
    apiCategory: "Masaža",
    label: "Saloni za masažu",
    h1: "Saloni za masažu u Srbiji",
    title: "Saloni za masažu u Srbiji | LUMERA",
    description: "Otkrijte salone za masažu u Srbiji. Izaberite relaks, terapeutsku ili sportsku masažu i rezervišite termin.",
    intro: "Opustite se uz relaks, terapeutsku, sportsku ili masažu celog tela u proverenom salonu.",
  },
  {
    slug: "nega-lica",
    apiCategory: "Lice",
    label: "Nega lica",
    h1: "Saloni za negu lica u Srbiji",
    title: "Nega lica u Srbiji | LUMERA",
    description: "Pronađite salone za negu lica u Srbiji. Pregledajte tretmane, ocene i cene i zakažite svoj beauty termin.",
    intro: "Istražite hidratantne, anti-age i druge profesionalne tretmane za negu lica.",
  },
];

export function getPublicCategoryPage(slug: string | undefined): PublicCategoryPage | undefined {
  return PUBLIC_CATEGORY_PAGES.find((page) => page.slug === slug);
}

export function getPublicCategoryPath(page: PublicCategoryPage): string {
  return `/saloni/kategorija/${page.slug}`;
}