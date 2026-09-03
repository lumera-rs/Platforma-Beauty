export const ADMIN_NAV_GROUPS = [
  {
    label: "Osnovno",
    links: [
      { href: "/admin", label: "Pregled", icon: "LayoutDashboard" },
      { href: "/admin/saloni", label: "Saloni", icon: "Store" },
      { href: "/admin/korisnici", label: "Korisnici", icon: "Users" },
      { href: "/admin/predlosci-usluga", label: "Predlošci usluga", icon: "FileText" },
    ],
  },
  {
    label: "Edukacije i programi",
    links: [
      { href: "/admin/edukacije", label: "Edukacije, isticanje i obračun", icon: "GraduationCap" },
      { href: "/admin/education-b2b-popusti", label: "B2B popusti za edukacije", icon: "CreditCard" },
      { href: "/admin/loyalty", label: "Loyalty program", icon: "Star" },
      { href: "/admin/retencija", label: "Pragovi retencije", icon: "SlidersHorizontal" },
      { href: "/admin/pretplate", label: "Pretplate", icon: "CreditCard" },
      { href: "/admin/preporuke", label: "Preporuke", icon: "Gift" },
    ],
  },
  {
    label: "Katalog i prodavnica",
    links: [
      { href: "/admin/dobavljaci", label: "Dobavljači", icon: "FolderTree" },
      { href: "/admin/proizvodi", label: "Proizvodi", icon: "Package" },
      { href: "/admin/bundle-proizvodi", label: "Paketi", icon: "Layers" },
      { href: "/admin/brendovi", label: "Brendovi", icon: "Tags" },
      { href: "/admin/katalog/atributi", label: "Katalog atributi", icon: "ListTree" },
      { href: "/admin/nivoi-korpe", label: "Nivoi korpe", icon: "ShoppingBag" },
      { href: "/admin/kuponi", label: "Kuponi", icon: "Tags" },
      { href: "/admin/lista-cekanja", label: "Lista čekanja", icon: "Bell" },
      { href: "/admin/profitabilnost", label: "Profitabilnost", icon: "TrendingUp" },
    ],
  },
  {
    label: "Porudžbine i podrška",
    links: [
      { href: "/admin/porudzbine", label: "Porudžbine", icon: "Package" },
      { href: "/admin/b2b-ponude", label: "B2B ponude", icon: "FileText" },
      { href: "/admin/reklamacije", label: "Reklamacije (RMA)", icon: "AlertCircle" },
      { href: "/admin/upiti-za-cenu", label: "Upiti za cenu", icon: "MailQuestion" },
      { href: "/admin/recenzije", label: "Recenzije salona", icon: "MessageSquare" },
      { href: "/admin/recenzije-proizvoda", label: "Moderacija proizvoda", icon: "ShieldAlert" },
      { href: "/admin/nagrade-recenzije", label: "Nagrade za recenzije", icon: "Star" },
    ],
  },
  {
    label: "Marketing i sadržaj",
    links: [
      { href: "/admin/poslovi", label: "Oglasi i izveštaji", icon: "BriefcaseBusiness" },
      { href: "/admin/odbijeni-oglasi", label: "Odbijeni oglasi", icon: "ListX" },
      { href: "/admin/marketinske-kampanje", label: "Marketinške kampanje", icon: "Megaphone" },
      { href: "/admin/b2c-baneri", label: "B2C baneri", icon: "Image" },
      { href: "/admin/nega-posle-tretmana", label: "Nega posle tretmana", icon: "Sparkles" },
      { href: "/admin/nega-posle-tretmana/statistika", label: "Statistika nege", icon: "TrendingUp" },
      { href: "/admin/drustvene-mreze", label: "Meta (Facebook)", icon: "Facebook" },
      { href: "/admin/email-marketing", label: "E-mail marketing", icon: "Mail" },
      { href: "/admin/sms-evidencija", label: "SMS evidencija", icon: "MessageSquareText" },
    ],
  },
  {
    label: "Podešavanja",
    links: [
      { href: "/admin/podesavanja/prodavnica", label: "Podešavanja prodavnice", icon: "Settings2" },
      { href: "/admin/podesavanja-prikaza", label: "B2C podešavanja", icon: "Settings2" },
      { href: "/admin/iskustvo-kupovine", label: "Iskustvo kupovine", icon: "Settings2" },
      { href: "/admin/dostava", label: "Dostava", icon: "Truck" },
      { href: "/admin/integracije", label: "Integracije", icon: "PlugZap" },
    ],
  },
] as const;

export type AdminNavIconName = (typeof ADMIN_NAV_GROUPS)[number]["links"][number]["icon"];

export const ADMIN_PROTECTED_DETAIL_ROUTE_FIXTURES = [
  "/admin/profil",
  "/admin/saloni/00000000-0000-4000-8000-000000000001",
  "/admin/dobavljaci/00000000-0000-4000-8000-000000000002",
  "/admin/porudzbine/00000000-0000-4000-8000-000000000003",
  "/admin/edukacije/centri/00000000-0000-4000-8000-000000000004",
  "/admin/poslovi/pregled/00000000-0000-4000-8000-000000000005",
] as const;

export function adminNavigationTestId(href: string): string {
  return `admin-nav-${href.replace("/admin", "").replaceAll("/", "-").replace(/^-/, "") || "dashboard"}`;
}