import { Link, useLocation, useSearch } from "wouter";
import { Home, Store, Calendar, Heart, User } from "lucide-react";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", path: "/", label: "Početna", icon: Home },
  { href: "/saloni", path: "/saloni", label: "Saloni", icon: Store },
  { href: "/moj-nalog?tab=appointments", path: "/moj-nalog", tab: "appointments", label: "Termini", icon: Calendar },
  { href: "/moj-nalog?tab=favorites", path: "/moj-nalog", tab: "favorites", label: "Favoriti", icon: Heart },
  { href: "/moj-nalog?tab=settings", path: "/moj-nalog", tab: "settings", label: "Profil", icon: User },
];

export function CustomerMobileNav() {
  const { data: userResp } = useGetCurrentUser();
  const user = userResp?.user;
  const [location] = useLocation();
  const search = useSearch();

  // Show only for signed-in customers
  if (!user || user.role !== "CUSTOMER") return null;

  const currentTab = new URLSearchParams(search).get("tab");

  return (
    <>
      {/* Spacer so the fixed nav doesn't cover content at the bottom of the page */}
      <div 
        className="md:hidden w-full shrink-0" 
        style={{ height: 'calc(4rem + env(safe-area-inset-bottom))' }} 
        aria-hidden="true" 
      />
      <nav 
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-primary text-primary-foreground shadow-[0_-8px_30px_rgba(0,0,0,0.12)] border-t border-primary/20"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Mobilna navigacija"
      >
      <div className="flex items-center justify-around h-16 px-1">
        {NAV_ITEMS.map((item) => {
          // If the item specifies a tab, match both path and tab.
          // If we're on /moj-nalog but no tab is in the URL, default to 'appointments' being active.
          const isActive = item.tab 
            ? location === item.path && (currentTab === item.tab || (!currentTab && item.tab === "appointments"))
            : location === item.path;

          return (
            <Link
              key={item.label}
              href={item.href}
              className="group flex flex-col items-center justify-center flex-1 h-full relative focus-visible:outline-none rounded-xl"
              aria-current={isActive ? "page" : undefined}
            >
              <div className="relative flex flex-col items-center justify-center w-full h-full py-1">
                {/* Active Indicator Background */}
                <div 
                  className={cn(
                    "absolute mx-auto rounded-full transition-all duration-300 ease-out",
                    isActive ? "bg-white/15 scale-100 opacity-100" : "bg-white/0 scale-75 opacity-0"
                  )}
                  style={{ width: '48px', height: '32px', top: '2px' }}
                />
                
                <item.icon 
                  className={cn(
                    "relative z-10 h-5 w-5 transition-all duration-300 ease-out mb-1",
                    isActive 
                      ? "text-primary-foreground scale-110 translate-y-0.5" 
                      : "text-primary-foreground/60 group-hover:text-primary-foreground/80 group-active:scale-95"
                  )} 
                  strokeWidth={isActive ? 2.5 : 2} 
                />
                <span 
                  className={cn(
                    "relative z-10 text-[10px] font-medium transition-all duration-300",
                    isActive 
                      ? "text-primary-foreground opacity-100 translate-y-0" 
                      : "text-primary-foreground/60 opacity-80"
                  )}
                >
                  {item.label}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
    </>
  );
}
