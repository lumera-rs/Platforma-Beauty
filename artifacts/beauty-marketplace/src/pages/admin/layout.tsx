import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetCurrentUser, useLogout } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Loader2, LayoutDashboard, Store, Users, Star, CreditCard, MessageSquare, Menu, X, Package, FolderTree, Tags, Truck, Mail, MessageSquareText, PlugZap, FileText, GraduationCap, SlidersHorizontal, BriefcaseBusiness, ListX, Gift, Layers, Bell, Settings2, Image, ListTree, ShieldAlert, Facebook, MailQuestion, AlertCircle, ShoppingBag, Megaphone, TrendingUp, Sparkles, ArrowLeft, BookOpen, LogOut, type LucideIcon } from "lucide-react";
import { ADMIN_NAV_GROUPS, adminNavigationTestId, type AdminNavIconName } from "@/lib/admin-navigation";

const adminNavIcons: Record<AdminNavIconName, LucideIcon> = {
  AlertCircle,
  Bell,
  BriefcaseBusiness,
  CreditCard,
  Facebook,
  FileText,
  FolderTree,
  Gift,
  GraduationCap,
  Image,
  Layers,
  LayoutDashboard,
  ListTree,
  ListX,
  Mail,
  MailQuestion,
  Megaphone,
  MessageSquare,
  MessageSquareText,
  Package,
  PlugZap,
  Settings2,
  ShieldAlert,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  Store,
  Tags,
  TrendingUp,
  Truck,
  Users,
};

const navGroups = ADMIN_NAV_GROUPS.map((group) => ({
  ...group,
  links: group.links.map((link) => ({ ...link, icon: adminNavIcons[link.icon] })),
}));

const adminFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 forced-colors:focus-visible:outline-[Highlight] forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-offset-2";

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: userResp, isLoading } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const logout = useLogout();
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

  useEffect(() => {
    setIsMobileOpen(false);
  }, [location]);

  if (isLoading || !userResp?.user) {
    return (
      <BusinessLayout adminNavigation>
        <div className="flex justify-center p-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" data-testid="admin-loading" />
        </div>
      </BusinessLayout>
    );
  }

  const matchingLinks = navGroups
    .flatMap((group) => group.links)
    .filter((link) => location === link.href || (link.href !== "/admin" && location.startsWith(`${link.href}/`)));
  const activeHref = matchingLinks.sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        setLocation("/");
      },
    });
  };

  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
    <nav aria-label="Admin navigacija" className="flex flex-col gap-6">
      {navGroups.map((group) => {
        const groupIsActive = group.links.some((link) => link.href === activeHref);
        return (
          <section key={group.label} aria-labelledby={`admin-group-${group.label.replaceAll(" ", "-").toLowerCase()}`}>
            <h3
              id={`admin-group-${group.label.replaceAll(" ", "-").toLowerCase()}`}
              className={`mb-2 px-3 text-xs font-bold uppercase tracking-[0.14em] ${groupIsActive ? "text-primary" : "text-muted-foreground"}`}
            >
              {group.label}
            </h3>
            <div className="flex flex-col gap-1">
              {group.links.map((link) => {
                const Icon = link.icon;
                const isActive = link.href === activeHref;
                return (
                  <Link key={link.href} href={link.href}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    } ${adminFocusClass}`}
                    aria-current={isActive ? "page" : undefined}
                    data-testid={adminNavigationTestId(link.href)}
                    onClick={() => setIsMobileOpen(false)}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{link.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      {mobile && (
        <section aria-labelledby="admin-group-brze-akcije" className="border-t pt-5">
          <h3 id="admin-group-brze-akcije" className="mb-2 px-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Brze akcije
          </h3>
          <div className="flex flex-col gap-1">
            <Link href="/biznis/edukacije" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground ${adminFocusClass}`}>
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Katalog edukacija
            </Link>
            <Link href="/" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground ${adminFocusClass}`}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Nazad na Market
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              disabled={logout.isPending}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60 ${adminFocusClass}`}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {logout.isPending ? "Odjavljivanje…" : "Odjavi se"}
            </button>
          </div>
        </section>
      )}
    </nav>
  );

  return (
    <BusinessLayout adminNavigation>
      <div className="container mx-auto flex flex-col items-start gap-5 px-4 py-5 md:flex-row md:gap-8 md:py-8">
        {/* Mobile Header */}
        <div className="md:hidden w-full flex items-center justify-between bg-card p-4 rounded-xl border shadow-sm mb-4">
          <div>
            <span className="block text-xs font-bold uppercase tracking-[0.14em] text-primary">Beauty Partner Hub</span>
            <span className="font-serif font-bold text-lg">Admin panel</span>
          </div>
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
            <SidebarContent mobile />
          </div>
        )}

        {/* Desktop Sidebar */}
        <aside className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] w-72 shrink-0 overflow-y-auto rounded-xl border bg-card p-4 shadow-sm md:block">
          <div className="mb-6 px-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Beauty Partner Hub</p>
            <h2 className="font-serif text-xl font-bold tracking-tight text-foreground">Admin panel</h2>
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
