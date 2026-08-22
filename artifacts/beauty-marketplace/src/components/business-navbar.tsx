import { Link, useLocation } from "wouter";
import { LogOut, Menu, X, LayoutDashboard, BookOpen, ChevronDown, ArrowLeft, Bell, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getGetShopCartQueryKey, useGetCurrentUser, useGetShopCart, useListSalonNotifications, useLogout } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { salonNotificationsQueryKey } from "@/lib/salon-notifications";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function BusinessNavbar() {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: userResp } = useGetCurrentUser();
  const logout = useLogout();
  const user = userResp?.user;
  const { data: cart } = useGetShopCart({ query: { enabled: user?.role === "SALON_OWNER", queryKey: getGetShopCartQueryKey() } });
  const notificationsQueryKey = salonNotificationsQueryKey(user?.id);
  const { data: notifications = [] } = useListSalonNotifications({
    query: {
      enabled: user?.role === "SALON_OWNER",
      queryKey: notificationsQueryKey,
      refetchInterval: 5000,
      refetchOnWindowFocus: true,
    },
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [managedSalons, setManagedSalons] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [activeSalonId, setActiveSalonId] = useState<string>("");
  const unreadNotificationCount = notifications.filter((notification) => !notification.readAt).length;

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        setLocation("/");
      }
    });
  };

  useEffect(() => {
    if (user?.role !== "SALON_OWNER") return;
    fetch("/api/salon/managed-salons").then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { activeSalonId: string | null; salons: Array<{ id: string; name: string; slug: string }> };
      setManagedSalons(payload.salons);
      setActiveSalonId(payload.activeSalonId ?? "");
    }).catch(() => undefined);
  }, [user?.role]);

  const switchSalon = async (salonId: string) => {
    const response = await fetch("/api/salon/active-salon", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ salonId }) });
    if (!response.ok) return;
    setActiveSalonId(salonId);
    window.location.assign("/vlasnik");
  };

  const getNavLinks = () => {
    if (!user) {
      return [
        { href: "/za-biznise", label: "Prednosti" },
        { href: "/za-biznise#platforma", label: "Platforma" },
      ];
    }
    
    switch (user.role) {
      case 'SALON_OWNER':
        return [
          { href: "/vlasnik", label: "Dashboard" },
          { href: "/vlasnik/kalendar", label: "Kalendar" },
          { href: "/vlasnik/usluge", label: "Usluge" },
          { href: "/vlasnik/zaposleni", label: "Zaposleni" },
          { href: "/vlasnik/shop", label: "Shop" },
          { href: "/vlasnik/porudzbine", label: "Porudžbine" },
          { href: "/vlasnik/obavestenja", label: "Obaveštenja" },
          { href: "/biznis/edukacije", label: "Edukacije" },
        ];
      case 'SALON_EMPLOYEE':
        return [
          { href: "/zaposleni", label: "Moj portal" },
          { href: "/biznis/edukacije", label: "Edukacije" },
        ];
      case 'EDUCATION_CENTER_OWNER':
        return [
          { href: "/biznis", label: "Dashboard" },
          { href: "/biznis/edukacije", label: "Edukacije" },
        ];
      case 'ADMIN':
      case 'SUPER_ADMIN':
        return [
          { href: "/admin", label: "Admin Panel" },
          { href: "/admin/saloni", label: "Saloni" },
          { href: "/admin/korisnici", label: "Korisnici" },
          { href: "/biznis/edukacije", label: "Edukacije" },
        ];
      default:
        return [];
    }
  };

  const navLinks = getNavLinks();

  return (
    <nav className="sticky top-0 z-50 w-full bg-foreground text-background border-b border-white/10">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/za-biznise" className="flex items-center gap-2 group">
            <span className="font-serif text-2xl font-bold tracking-tight text-white group-hover:text-white/90 transition-colors">
              LUMERA <span className="text-accent text-sm font-sans tracking-normal uppercase ml-1 relative -top-1">Biznis</span>
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link 
                key={link.href} 
                href={link.href}
                className={cn(
                  "text-sm font-medium transition-colors hover:text-accent",
                  location === link.href ? "text-accent" : "text-background/80"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-4">
            <Link href="/" className="text-sm font-medium text-background/60 hover:text-white transition-colors flex items-center gap-1.5 mr-2">
              <ArrowLeft className="w-4 h-4" />
              Nazad na Market
            </Link>

            {user?.role === "SALON_OWNER" && (
              <select aria-label="Aktivni salon" className="hidden lg:block max-w-48 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-sm text-white" value={activeSalonId} onChange={(event) => switchSalon(event.target.value)}>
                {managedSalons.map((salon) => <option className="text-foreground" key={salon.id} value={salon.id}>{salon.name}</option>)}
              </select>
            )}
            {user?.role === "SALON_OWNER" && (
              <Button variant="ghost" size="icon" className="relative text-white hover:bg-white/10 hover:text-white" asChild>
                <Link href="/vlasnik/obavestenja" aria-label={`Obaveštenja${unreadNotificationCount ? `, ${unreadNotificationCount} nepročitano` : ""}`} data-testid="link-notifications">
                  <Bell className="w-5 h-5" />
                  {unreadNotificationCount > 0 && <span data-testid="status-unread-notification-count" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-accent-foreground">{unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}</span>}
                </Link>
              </Button>
            )}

            {user?.role === "SALON_OWNER" && (
              <Button variant="ghost" size="icon" className="relative text-white hover:bg-white/10 hover:text-white" asChild>
                <Link href="/vlasnik/prodavnica/korpa" aria-label="Otvori korpu">
                  <ShoppingCart className="h-5 w-5" />
                  {cart && cart.itemCount > 0 && (
                    <span className="absolute -right-1 -top-1 min-w-5 h-5 rounded-full bg-accent px-1 text-[10px] font-bold leading-5 text-accent-foreground">
                      {cart.itemCount > 99 ? "99+" : cart.itemCount}
                    </span>
                  )}
                </Link>
              </Button>
            )}
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 px-2 text-white hover:bg-white/10 hover:text-white">
                    <div className="h-8 w-8 rounded-full bg-accent/20 flex items-center justify-center text-accent font-serif font-bold">
                      {user.firstName?.[0] || 'U'}{user.lastName?.[0] || ''}
                    </div>
                    <span className="font-medium text-sm hidden lg:inline-block">
                      {user.firstName}
                    </span>
                    <ChevronDown className="h-4 w-4 text-background/60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="p-2 border-b">
                    <p className="font-medium">{user.firstName} {user.lastName}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  
                  {user.role === 'SALON_OWNER' && (
                    <DropdownMenuItem onClick={() => setLocation('/vlasnik')}>
                      <LayoutDashboard className="mr-2 h-4 w-4" />
                      Dashboard
                    </DropdownMenuItem>
                  )}
                  {user.role === 'EDUCATION_CENTER_OWNER' && (
                    <DropdownMenuItem onClick={() => setLocation('/biznis')}>
                      <BookOpen className="mr-2 h-4 w-4" />
                      Centar za edukaciju
                    </DropdownMenuItem>
                  )}
                  
                  <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:bg-destructive/10 cursor-pointer">
                    <LogOut className="mr-2 h-4 w-4" />
                    Odjavi se
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Button variant="ghost" className="text-white hover:bg-white/10 hover:text-white" asChild>
                  <Link href="/poslovna-prijava">Prijavi se</Link>
                </Button>
                <Button className="bg-accent text-accent-foreground hover:bg-accent/90" asChild>
                  <Link href="/poslovna-registracija">Postani partner</Link>
                </Button>
              </>
            )}
          </div>

          <Button 
            variant="ghost" 
            size="icon" 
            className="md:hidden text-white hover:bg-white/10"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label={isMobileMenuOpen ? "Zatvori meni" : "Otvori meni"}
            data-testid="button-mobile-menu"
          >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="md:hidden border-t border-white/10 bg-foreground">
          <div className="container mx-auto px-4 py-4 flex flex-col gap-4">
            <Link 
              href="/"
              className="flex items-center gap-2 text-sm font-medium py-2 text-background/60"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <ArrowLeft className="w-4 h-4" /> Nazad na Market
            </Link>

            <div className="h-px bg-white/10 my-1" />

            {navLinks.map((link) => {
              const isNotificationsLink = link.href === "/vlasnik/obavestenja";
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "block text-sm font-medium py-2",
                    isNotificationsLink && "flex items-center justify-between gap-3",
                    location === link.href ? "text-accent" : "text-background"
                  )}
                  aria-label={isNotificationsLink ? `Obaveštenja${unreadNotificationCount ? `, ${unreadNotificationCount} nepročitano` : ""}` : undefined}
                  data-testid={isNotificationsLink ? "link-notifications-mobile" : undefined}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <span>{link.label}</span>
                  {isNotificationsLink && unreadNotificationCount > 0 && (
                    <span
                      data-testid="status-unread-notification-count-mobile"
                      className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-bold leading-5 text-accent-foreground"
                    >
                      {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                    </span>
                  )}
                </Link>
              );
            })}
            {user?.role === "SALON_OWNER" && (
              <Link
                href="/vlasnik/prodavnica/korpa"
                className="flex items-center justify-between rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-background"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <span className="flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> Korpa</span>
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground">{cart?.itemCount ?? 0}</span>
              </Link>
            )}
            
            <div className="h-px bg-white/10 my-2" />
            
            {user ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-background/60 px-2 py-1">Ulogovani ste kao {user.firstName}</p>
                <button 
                  onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}
                  className="text-left text-red-400 py-2 px-2 text-sm font-medium hover:text-red-300 transition-colors"
                >
                  Odjavi se
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Link 
                  href="/poslovna-prijava" 
                  className="block text-sm font-medium py-2 px-2 text-background"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Prijavi se
                </Link>
                <Link 
                  href="/poslovna-registracija" 
                  className="block text-sm font-medium py-2 px-2 text-accent"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Registracija
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
