import {
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Box,
  BriefcaseBusiness,
  Calendar,
  ClipboardCheck,
  Clock3,
  DollarSign,
  GraduationCap,
  HeartHandshake,
  HelpCircle,
  LayoutDashboard,
  LayoutGrid,
  Package,
  Settings,
  Star,
  Store,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type SalonOwnerNavLink = {
  href: string;
  label: string;
  guideId?: string;
  icon: LucideIcon;
};

export type SalonOwnerNavSection = {
  label: "Pregled" | "Lokacija" | "Prodaja" | "Rast" | "Marketplace" | "Ostalo";
  items: SalonOwnerNavLink[];
};

export const salonOwnerNavSections: SalonOwnerNavSection[] = [
  {
    label: "Pregled",
    items: [
      { href: "/vlasnik", label: "Dashboard", guideId: "vl-dashboard", icon: LayoutDashboard },
      { href: "/vlasnik/kalendar", label: "Kalendar", guideId: "vl-kalendar", icon: Calendar },
    ],
  },
  {
    label: "Lokacija",
    items: [
      { href: "/vlasnik/usluge", label: "Usluge", guideId: "vl-usluge", icon: Settings },
      { href: "/vlasnik/resursi", label: "Resursi", guideId: "vl-resursi", icon: LayoutGrid },
      { href: "/vlasnik/profil", label: "Profil lokacije", guideId: "vl-profil", icon: Store },
      { href: "/vlasnik/zaposleni", label: "Zaposleni", guideId: "vl-zaposleni", icon: Users },
      { href: "/vlasnik/radno-vreme", label: "Radno vreme", guideId: "vl-radno-vreme", icon: Clock3 },
      { href: "/vlasnik/inventar", label: "Zalihe", guideId: "vl-inventar", icon: Package },
      { href: "/vlasnik/paketi", label: "Paketi tretmana", guideId: "vl-paketi", icon: Box },
    ],
  },
  {
    label: "Prodaja",
    items: [
      { href: "/vlasnik/porudzbine", label: "Porudžbine", guideId: "vl-porudzbine", icon: Package },
      { href: "/vlasnik/porudzbine-na-cekanju", label: "Odobrenja", guideId: "vl-odobrenja", icon: ClipboardCheck },
      { href: "/vlasnik/shop", label: "B2B Oprema", guideId: "vl-shop", icon: DollarSign },
    ],
  },
  {
    label: "Rast",
    items: [
      { href: "/vlasnik/klijenti", label: "CRM & Retencija", guideId: "vl-klijenti", icon: HeartHandshake },
      { href: "/vlasnik/loyalty", label: "Loyalty Program", guideId: "vl-loyalty", icon: Star },
      { href: "/vlasnik/automatizacije", label: "Automatizacije", guideId: "vl-automatizacije", icon: Zap },
      { href: "/vlasnik/performanse", label: "Performanse tima", guideId: "vl-performanse", icon: BarChart3 },
      { href: "/vlasnik/ai-asistent", label: "AI Asistent", guideId: "vl-ai", icon: Bot },
    ],
  },
  {
    label: "Marketplace",
    items: [
      { href: "/biznis/edukacije", label: "Edukacije", guideId: "vl-edukacije", icon: BookOpen },
      { href: "/vlasnik/edukacije", label: "Prijave zaposlenih", guideId: "vl-prijave-edukacija", icon: GraduationCap },
      { href: "/biznis/poslovi", label: "Poslovi", guideId: "vl-poslovi", icon: BriefcaseBusiness },
    ],
  },
  {
    label: "Ostalo",
    items: [
      { href: "/vlasnik/obavestenja", label: "Obaveštenja", guideId: "vl-obavestenja", icon: Bell },
      { href: "/biznis/vodic", label: "Pomoć", icon: HelpCircle },
    ],
  },
];

export const salonOwnerNavLinks = salonOwnerNavSections.flatMap((section) => section.items);