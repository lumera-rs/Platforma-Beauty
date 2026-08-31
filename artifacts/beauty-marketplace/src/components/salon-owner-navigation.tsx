import { useQueryClient } from "@tanstack/react-query";
import { useLogout } from "@workspace/api-client-react";
import { LogOut, ShoppingCart } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { GuideHelpLink } from "@/components/guide-help-link";
import { cn } from "@/lib/utils";
import { OwnerLocationWizard } from "@/components/owner-location-wizard";
import { salonOwnerNavSections, type SalonOwnerNavLink } from "@/lib/salon-owner-navigation";

type SalonOwnerNavigationProps = {
  variant?: "light" | "dark";
  onNavigate?: () => void;
  unreadNotificationCount?: number;
  managedSalons?: Array<{ id: string; name: string }>;
  activeSalonId?: string;
  isSwitchingSalon?: boolean;
  onSwitchSalon?: (salonId: string) => void;
  cartItemCount?: number;
  showNotifications?: boolean;
};

function isLinkActive(location: string, link: SalonOwnerNavLink) {
  if (link.href === "/vlasnik") return location === link.href;
  return location === link.href || location.startsWith(`${link.href}/`);
}

export function SalonOwnerNavigation({
  variant = "light",
  onNavigate,
  unreadNotificationCount = 0,
  managedSalons = [],
  activeSalonId = "",
  isSwitchingSalon = false,
  onSwitchSalon,
  cartItemCount = 0,
  showNotifications = true,
}: SalonOwnerNavigationProps) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const dark = variant === "dark";
  const [loadedLocations, setLoadedLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [loadedActiveLocationId, setLoadedActiveLocationId] = useState("");
  const [switchingLocation, setSwitchingLocation] = useState(false);
  // The desktop sidebar is rendered independently from the business header.
  // Hydrating here keeps its selector identical to the header/mobile selector.
  useEffect(() => {
    if (managedSalons.length || onSwitchSalon) return;
    let cancelled = false;
    void fetch("/api/salon/managed-salons", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Lokacije nisu dostupne.");
        return response.json() as Promise<{ activeSalonId: string | null; salons: Array<{ id: string; name: string }> }>;
      })
      .then((payload) => {
        if (!cancelled) {
          setLoadedLocations(payload.salons);
          setLoadedActiveLocationId(payload.activeSalonId ?? "");
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [managedSalons.length, onSwitchSalon]);

  const locations = managedSalons.length ? managedSalons : loadedLocations;
  const navigationSections = showNotifications
    ? salonOwnerNavSections
    : salonOwnerNavSections.map((section) => ({
      ...section,
      items: section.items.filter((item) => item.href !== "/vlasnik/obavestenja"),
    }));
  const selectedLocationId = activeSalonId || loadedActiveLocationId;
  const isChangingLocation = isSwitchingSalon || switchingLocation;
  const switchLocation = async (salonId: string) => {
    if (onSwitchSalon) {
      onSwitchSalon(salonId);
      return;
    }
    if (!salonId || salonId === selectedLocationId || switchingLocation) return;
    setSwitchingLocation(true);
    try {
      const response = await fetch("/api/salon/active-salon", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ salonId }),
      });
      if (!response.ok) throw new Error("Promena aktivne lokacije nije uspela.");
      setLoadedActiveLocationId(salonId);
      await queryClient.cancelQueries();
      queryClient.clear();
      // Preserve filters, deep links, and anchor state after the scope change.
      window.location.assign(window.location.pathname + window.location.search + window.location.hash);
    } catch {
      setSwitchingLocation(false);
    }
  };

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        onNavigate?.();
        setLocation("/");
      },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="salon-owner-navigation">
      {(locations.length > 1 || onSwitchSalon) && (
        <div className={cn("shrink-0 space-y-3 border-b p-3", dark ? "border-white/10" : "border-border")}>
          {locations.length > 1 ? (
            <div className="space-y-1.5">
              <label
                htmlFor="owner-active-location"
                className={cn("text-xs font-semibold", dark ? "text-background/70" : "text-muted-foreground")}
              >
                Aktivna lokacija
              </label>
              <select
                id="owner-active-location"
                aria-label="Aktivna lokacija"
                disabled={isChangingLocation}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-sm disabled:cursor-wait disabled:opacity-70",
                  dark ? "border-white/20 bg-white/10 text-white" : "bg-background text-foreground",
                )}
                value={selectedLocationId}
                onChange={(event) => { void switchLocation(event.target.value); }}
                data-testid="owner-location-select"
              >
                {locations.map((salon) => (
                  <option className="text-foreground" key={salon.id} value={salon.id}>{salon.name}</option>
                ))}
              </select>
            </div>
          ) : null}
          <OwnerLocationWizard triggerLabel="Dodaj lokaciju" triggerClassName="w-full justify-start" />
          <Link
            href="/vlasnik/prodavnica/korpa"
            onClick={onNavigate}
            className={cn(
              "flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              dark ? "text-background/85 hover:bg-white/8 hover:text-background" : "text-foreground/80 hover:bg-muted",
            )}
            aria-label={`Otvori korpu${cartItemCount ? `, ${cartItemCount} stavki` : ""}`}
            data-testid="owner-mobile-cart-link"
          >
            <ShoppingCart className="mr-2.5 h-4 w-4" />
            <span>Korpa</span>
            {cartItemCount > 0 ? (
              <span className="ml-auto min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-bold leading-5 text-accent-foreground" data-testid="owner-mobile-cart-count">
                {cartItemCount > 99 ? "99+" : cartItemCount}
              </span>
            ) : null}
          </Link>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3 custom-scrollbar">
        {navigationSections.map((section) => {
          const sectionActive = section.items.some((link) => isLinkActive(location, link));
          return (
            <section key={section.label} className="mb-5 last:mb-1">
              <h2
                className={cn(
                  "mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.16em]",
                  dark
                    ? sectionActive ? "text-accent" : "text-background/45"
                    : sectionActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                {section.label}
              </h2>
              <div className="space-y-0.5">
                {section.items.map((link) => {
                  const active = isLinkActive(location, link);
                  const notifications = link.href === "/vlasnik/obavestenja";
                  return (
                    <div key={link.href} className="flex items-center gap-1">
                      <Link
                        href={link.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        aria-label={notifications ? `Obaveštenja${unreadNotificationCount ? `, ${unreadNotificationCount} nepročitano` : ""}` : undefined}
                        data-testid={notifications && dark ? "link-notifications-mobile" : undefined}
                        className={cn(
                          "flex min-w-0 flex-1 items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                          dark
                            ? active ? "bg-white/12 text-accent" : "text-background/85 hover:bg-white/8 hover:text-background"
                            : active ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted",
                        )}
                      >
                        <link.icon className="mr-2.5 h-4 w-4 shrink-0" />
                        <span className="truncate">{link.label}</span>
                        {notifications && unreadNotificationCount > 0 ? (
                          <span
                            className="ml-auto min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-bold leading-5 text-accent-foreground"
                            data-testid={dark ? "status-unread-notification-count-mobile" : undefined}
                          >
                            {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                          </span>
                        ) : null}
                      </Link>
                      {link.guideId ? (
                        <GuideHelpLink
                          sectionId={link.guideId}
                          label={link.label}
                          onClick={onNavigate}
                          className={dark ? "text-background/65 hover:bg-white/10 hover:text-accent focus-visible:ring-white" : undefined}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className={cn("shrink-0 border-t p-2", dark ? "border-white/10 bg-foreground" : "bg-background")}>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "w-full justify-start px-3 text-destructive",
            dark ? "hover:bg-red-500/10 hover:text-red-300" : "hover:bg-destructive/10 hover:text-destructive",
          )}
          onClick={handleLogout}
          disabled={logout.isPending}
          data-testid="owner-navigation-logout"
        >
          <LogOut className="mr-2.5 h-4 w-4" />
          {logout.isPending ? "Odjavljivanje…" : "Odjavi se"}
        </Button>
      </div>
    </div>
  );
}