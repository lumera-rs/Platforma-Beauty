import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Loader2, LayoutDashboard, Store, Users, Star, CreditCard, MessageSquare, Menu, X, Package, FolderTree, Tags, Truck, Mail, MessageSquareText, PlugZap, FileText, GraduationCap, SlidersHorizontal, BriefcaseBusiness, ListX, Gift, Layers, Bell, Settings2, Image, ListTree, ShieldAlert, Facebook, MailQuestion, AlertCircle, ShoppingBag, Megaphone, TrendingUp } from "lucide-react";

const navLinks = [
  { href: "/admin", label: "Pregled", icon: LayoutDashboard },
  { href: "/admin/saloni", label: "Saloni", icon: Store },
  { href: "/admin/predlosci-usluga", label: "Predlošci usluga", icon: FileText },
  { href: "/admin/korisnici", label: "Korisnici", icon: Users },
  { href: "/admin/poslovi", label: "Oglasi & izveštaji", icon: BriefcaseBusiness },
  { href: "/admin/odbijeni-oglasi", label: "Odbijeni oglasi", icon: ListX },
  { href: "/admin/loyalty", label: "Loyalty Program", icon: Star },
  { href: "/admin/retencija", label: "Pragovi retencije", icon: SlidersHorizontal },
  { href: "/admin/pretplate", label: "Pretplate", icon: CreditCard },
  { href: "/admin/edukacije", label: "Edukacije i escrow", icon: GraduationCap },
  { href: "/admin/preporuke", label: "Preporuke", icon: Gift },
  { href: "/admin/recenzije", label: "Recenzije salona", icon: MessageSquare },
  { href: "/admin/recenzije-proizvoda", label: "Moderacija proizvoda", icon: ShieldAlert },
  { href: "/admin/marketinske-kampanje", label: "Marketinške kampanje", icon: Megaphone },
  { href: "/admin/nivoi-korpe", label: "Nivoi korpe", icon: ShoppingBag },
  { href: "/admin/dobavljaci", label: "Dobavljači", icon: FolderTree },
  { href: "/admin/proizvodi", label: "Proizvodi", icon: Package },
  { href: "/admin/profitabilnost", label: "Profitabilnost", icon: TrendingUp },
  { href: "/admin/katalog/atributi", label: "Katalog atributi", icon: ListTree },
  { href: "/admin/b2c-baneri", label: "B2C Baneri", icon: Image },
  { href: "/admin/bundle-proizvodi", label: "Paketi", icon: Layers },
  { href: "/admin/kuponi", label: "Kuponi", icon: Tags },
  { href: "/admin/lista-cekanja", label: "Lista čekanja", icon: Bell },
  { href: "/admin/podesavanja/prodavnica", label: "Podešavanja prodavnice", icon: Settings2 },
  { href: "/admin/podesavanja-prikaza", label: "B2C Podešavanja", icon: Settings2 },
  { href: "/admin/iskustvo-kupovine", label: "Iskustvo kupovine", icon: Settings2 },
    { href: "/admin/porudzbine", label: "Porudžbine", icon: Package },
  { href: "/admin/b2b-ponude", label: "B2B Ponude", icon: FileText },
  { href: "/admin/reklamacije", label: "Reklamacije (RMA)", icon: AlertCircle },
  { href: "/admin/upiti-za-cenu", label: "Upiti za cenu", icon: MailQuestion },
  { href: "/admin/nagrade-recenzije", label: "Nagrade za recenzije", icon: Star },
  { href: "/admin/drustvene-mreze", label: "Meta (Facebook)", icon: Facebook },
  { href: "/admin/brendovi", label: "Brendovi", icon: Tags },
  { href: "/admin/dostava", label: "Dostava", icon: Truck },
  { href: "/admin/email-marketing", label: "E-mail marketing", icon: Mail },
  { href: "/admin/sms-evidencija", label: "SMS evidencija", icon: MessageSquareText },
  { href: "/admin/integracije", label: "Integracije", icon: PlugZap },
];

const adminFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 forced-colors:focus-visible:outline-[Highlight] forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-offset-2";

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: userResp, isLoading } = useGetCurrentUser();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const closeMobileMenu = useCallback(() => {
    setIsMobileOpen(false);
    requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!isLoading) {
      if (!userResp?.user) {
        setLocation("/prijava");
      } else if (userResp.user.role === 'CUSTOMER') {
        setLocation("/moj-nalog");
      } else if (userResp.user.role !== 'ADMIN' && userResp.user.role !== 'SUPER_ADMIN') {
        setLocation("/");
      }
    }
  }, [userResp, isLoading, setLocation]);

  useEffect(() => {
    if (!isMobileOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileMenu();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = Array.from(
        mobileMenuRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const focusIsOutsideMenu = !mobileMenuRef.current?.contains(document.activeElement);

      if ((event.shiftKey && (document.activeElement === firstElement || focusIsOutsideMenu))
        || (!event.shiftKey && document.activeElement === lastElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeMobileMenu, isMobileOpen]);

  if (isLoading || !userResp?.user) {
    return (
      <BusinessLayout>
        <div className="flex justify-center p-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" data-testid="admin-loading" />
        </div>
      </BusinessLayout>
    );
  }

  const SidebarContent = () => (
    <div className="flex flex-col gap-2">
      {navLinks.map((link) => {
        const Icon = link.icon;
        const isActive = location === link.href || (link.href !== "/admin" && location.startsWith(link.href));
        return (
          <Link key={link.href} href={link.href}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'hover:bg-muted text-muted-foreground hover:text-foreground'
            } ${adminFocusClass}`}
            data-testid={`admin-nav-${link.href.replace('/admin', '').replace('/', '') || 'dashboard'}`}
            onClick={() => setIsMobileOpen(false)}
          >
            <Icon className="w-5 h-5" />
            {link.label}
          </Link>
        )
      })}
    </div>
  );

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        {/* Mobile Header */}
        <div className="md:hidden w-full flex items-center justify-between bg-card p-4 rounded-xl border shadow-sm mb-4">
          <span className="font-serif font-bold text-lg">Admin Panel</span>
          <Button
            ref={mobileMenuButtonRef}
            variant="ghost"
            size="icon"
            onClick={() => isMobileOpen ? closeMobileMenu() : setIsMobileOpen(true)}
            aria-label={isMobileOpen ? "Zatvori meni" : "Otvori meni"}
            aria-expanded={isMobileOpen ? "true" : "false"}
            data-testid="admin-mobile-menu-trigger"
            className={adminFocusClass}
          >
            {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>

        {/* Mobile Nav */}
        {isMobileOpen && (
          <div ref={mobileMenuRef} className="md:hidden w-full bg-card p-4 rounded-xl border shadow-sm mb-4" data-testid="admin-mobile-menu">
            <SidebarContent />
          </div>
        )}

        {/* Desktop Sidebar */}
        <aside className="hidden md:block w-64 shrink-0 bg-card p-4 rounded-xl border shadow-sm">
          <div className="mb-6 px-4">
            <h2 className="font-serif font-bold text-xl tracking-tight text-foreground">Admin Panel</h2>
          </div>
          <SidebarContent />
        </aside>

        {/* Main Content */}
        <div className="flex-1 w-full max-w-full overflow-hidden">
          {children}
        </div>
      </div>
    </BusinessLayout>
  );
}
