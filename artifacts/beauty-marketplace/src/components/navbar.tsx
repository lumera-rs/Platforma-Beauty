import { Link, useLocation } from "wouter";
import { User, LogOut, Menu, X, Calendar, LayoutDashboard, Award, ChevronDown, Heart, Settings, BriefcaseBusiness, ShoppingBag } from "lucide-react";
import { Button } from "./ui/button";
import { getGetRetailCartSummaryQueryKey, useGetCurrentUser, useGetRetailCartSummary, useLogout } from "@workspace/api-client-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { homeForRole } from "@/lib/role-routing";

export function Navbar() {
  const [location, setLocation] = useLocation();
  const { data: userResp } = useGetCurrentUser();
  const logout = useLogout();
  const user = userResp?.user;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { data: cartSummary } = useGetRetailCartSummary({
    query: { queryKey: getGetRetailCartSummaryQueryKey(), staleTime: Infinity, refetchOnWindowFocus: false, retry: false },
  });
  const cartItemCount = cartSummary?.itemCount ?? 0;

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => setLocation("/")
    });
  };

  const navLinks = [
    { href: "/saloni", label: "Saloni" },
    { href: "/proizvodi", label: "Proizvodi" },
    { href: "/inspiracija", label: "Inspiracija" },
    { href: "/recnik", label: "Rečnik" },
  ];

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-serif text-2xl font-bold tracking-tight text-primary">
              LUMERA
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link 
                key={link.href} 
                href={link.href}
                className={cn(
                  "text-sm font-medium transition-colors hover:text-primary",
                  location === link.href ? "text-primary" : "text-muted-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-4">
            <Link href="/za-biznise" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
              <BriefcaseBusiness className="h-3.5 w-3.5" />
              Za salone i biznise
            </Link>
            <Button variant="ghost" size="icon" className="relative" asChild>
              <Link href="/korpa" aria-label={`Korpa${cartItemCount && cartItemCount > 0 ? `, ${cartItemCount} stavki` : ""}`} data-testid="link-cart">
                <ShoppingBag className="h-5 w-5" />
                {cartItemCount > 0 && (
                  <span data-testid="status-cart-count" className="absolute -right-1 -top-1 min-w-5 h-5 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-5 text-accent-foreground">
                    {cartItemCount > 99 ? "99+" : cartItemCount}
                  </span>
                )}
              </Link>
            </Button>
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 px-2">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-serif">
                      {user.firstName[0]}{user.lastName[0]}
                    </div>
                    <span className="font-medium text-sm hidden lg:inline-block">
                      {user.firstName}
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="p-2 border-b">
                    <p className="font-medium">{user.firstName} {user.lastName}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  {user.role === 'CUSTOMER' && (
                    <>
                      <DropdownMenuItem onClick={() => setLocation('/moj-nalog?tab=appointments')}>
                        <Calendar className="mr-2 h-4 w-4" />
                        Moji termini
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setLocation('/moj-nalog?tab=favorites')}>
                        <Heart className="mr-2 h-4 w-4" />
                        Omiljeni saloni
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setLocation('/moj-nalog?tab=settings')}>
                        <Settings className="mr-2 h-4 w-4" />
                        Profil
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {(user.role === 'SALON_OWNER' || user.role === 'EDUCATION_CENTER_OWNER' || user.role === 'INSTRUCTOR' || user.role === 'SALON_EMPLOYEE') && (
                    <>
                      <DropdownMenuItem onClick={() => setLocation(homeForRole(user.role))}>
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        Poslovni portal
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' ? (
                    <>
                      <DropdownMenuItem onClick={() => setLocation('/admin')}>
                        <Award className="mr-2 h-4 w-4" />
                        Admin Panel
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:bg-destructive/10">
                    <LogOut className="mr-2 h-4 w-4" />
                    Odjavi se
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Button variant="ghost" asChild>
                  <Link href="/prijava">Prijavi se</Link>
                </Button>
                <Button asChild>
                  <Link href="/prijava?tab=register">Registracija</Link>
                </Button>
              </>
            )}
          </div>

          <Button 
            variant="ghost" 
            size="icon" 
            className="md:hidden"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t bg-background">
          <div className="container mx-auto px-4 py-4 flex flex-col gap-4">
            {navLinks.map((link) => (
              <Link 
                key={link.href} 
                href={link.href}
                className={cn(
                  "block text-sm font-medium py-2",
                  location === link.href ? "text-primary" : "text-foreground"
                )}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <Link href="/za-biznise" className="flex items-center gap-2 py-2 text-sm text-muted-foreground" onClick={() => setIsMobileMenuOpen(false)}>
              <BriefcaseBusiness className="h-4 w-4" />
              Za salone i biznise
            </Link>
            <Link href="/korpa" className="flex items-center gap-2 py-2 text-sm text-muted-foreground" onClick={() => setIsMobileMenuOpen(false)} data-testid="link-mobile-cart">
              <ShoppingBag className="h-4 w-4" />
              Korpa
              {cartItemCount > 0 && (
                <span data-testid="status-mobile-cart-count" className="min-w-5 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-5 text-accent-foreground">
                  {cartItemCount > 99 ? "99+" : cartItemCount}
                </span>
              )}
            </Link>
            
            <div className="h-px bg-border my-2" />
            
            {user ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground px-2 py-1">Ulogovani ste kao {user.firstName}</p>
                {user.role === 'CUSTOMER' && (
                  <>
                    <Link href="/moj-nalog?tab=appointments" className="py-2 px-2 text-sm" onClick={() => setIsMobileMenuOpen(false)}>Moji termini</Link>
                    <Link href="/moj-nalog?tab=favorites" className="py-2 px-2 text-sm" onClick={() => setIsMobileMenuOpen(false)}>Omiljeni saloni</Link>
                    <Link href="/moj-nalog?tab=settings" className="py-2 px-2 text-sm" onClick={() => setIsMobileMenuOpen(false)}>Profil</Link>
                  </>
                )}
                {(user.role === 'SALON_OWNER' || user.role === 'EDUCATION_CENTER_OWNER' || user.role === 'INSTRUCTOR' || user.role === 'SALON_EMPLOYEE') && (
                  <Link href={homeForRole(user.role)} className="py-2 px-2 text-sm" onClick={() => setIsMobileMenuOpen(false)}>
                    Poslovni portal
                  </Link>
                )}
                {(user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') && (
                  <Link href="/admin" className="py-2 px-2 text-sm" onClick={() => setIsMobileMenuOpen(false)}>
                    Admin Panel
                  </Link>
                )}
                <button 
                  onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}
                  className="text-left text-destructive py-2 px-2 text-sm font-medium"
                >
                  Odjavi se
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Link 
                  href="/prijava" 
                  className="block text-sm font-medium py-2 px-2"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Prijavi se
                </Link>
                <Link 
                  href="/prijava?tab=register" 
                  className="block text-sm font-medium py-2 px-2 text-primary"
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
