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
  GraduationCap
} from "lucide-react";

export type EducationCenterNavLink = {
  href: string;
  label: string;
  guideId?: string;
  icon: LucideIcon;
};

export type EducationCenterNavSection = {
  label: string;
  items: EducationCenterNavLink[];
};

export const educationCenterNavSections: EducationCenterNavSection[] = [
  {
    label: "Pregled",
    items: [
      { href: "/biznis", label: "Pregled", guideId: "edu-dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Edukacije",
    items: [
      { href: "/biznis/edukacije", label: "Katalog edukacija", guideId: "edu-katalog", icon: BookOpen },
      { href: "/biznis/paketi", label: "Paketi", guideId: "edu-paketi", icon: Box },
      { href: "/biznis/predavaci-ucinak", label: "Učinak predavača", guideId: "edu-predavaci", icon: BarChart3 },
    ],
  },
  {
    label: "Operacije",
    items: [
      { href: "/biznis/resursi", label: "Resursi", guideId: "edu-resursi", icon: LayoutGrid },
      { href: "/biznis/zalihe", label: "Zalihe", guideId: "edu-zalihe", icon: Package },
      { href: "/biznis/polaznici", label: "Polaznici", guideId: "edu-polaznici", icon: Users },
      { href: "/biznis/ai-asistent", label: "AI asistent", guideId: "edu-ai", icon: Bot },
    ],
  },
  {
    label: "B2B i Prodaja",
    items: [
      { href: "/biznis/b2b", label: "B2B pogodnosti", guideId: "edu-b2b", icon: DollarSign },
      { href: "/biznis/poslovi", label: "Poslovi", guideId: "edu-poslovi", icon: BriefcaseBusiness },
    ],
  },
  {
    label: "Ostalo",
    items: [
      { href: "/biznis/vodic", label: "Pomoć", icon: HelpCircle },
    ],
  },
];

export const educationCenterNavLinks = educationCenterNavSections.flatMap((section) => section.items);
