import { Link, useLocation } from "wouter";
import { User, LogOut, Menu, X, Scissors, Calendar, LayoutDashboard, ShoppingBag, Award, GraduationCap, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { useGetCurrentUser, useLogout } from "@workspace/api-client-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function Navbar() {
  const [location, setLocation] = useLocation();
  const { data: userResp } = useGetCurrentUser();
  const logout = useLogout();
  const user = userResp?.user;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => setLocation("/")
    });
  };

  const navLinks = [
    { href: "/saloni", label: "Saloni" },
    { href: "/edukacije", label: "Edukacije" },
    { href: "/vlasnik/shop", label: "Oprema (B2B)" },
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
                  {user.role === 'SALON_OWNER' && (
                    <>
                      <DropdownMenuItem onClick={() => setLocation('/vlasnik')}>
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        Dashboard
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setLocation('/vlasnik/kalendar')}>
                        <Calendar className="mr-2 h-4 w-4" />
                        Kalendar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setLocation('/vlasnik/shop')}>
                        <ShoppingBag className="mr-2 h-4 w-4" />
                        Shop
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {user.role === 'CUSTOMER' && (
                    <>
                      <DropdownMenuItem onClick={() => setLocation('/moj-nalog')}>
                        <User className="mr-2 h-4 w-4" />
                        Moj nalog
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {user.role === 'SUPER_ADMIN' && (
                    <>
                      <DropdownMenuItem onClick={() => setLocation('/admin')}>
                        <Award className="mr-2 h-4 w-4" />
                        Admin Panel
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
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
            
            <div className="h-px bg-border my-2" />
            
            {user ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground px-2 py-1">Ulogovani ste kao {user.firstName}</p>
                {user.role === 'SALON_OWNER' && (
                  <Link href="/vlasnik" className="py-2 px-2 text-sm" onClick={() => setIsMobileMenuOpen(false)}>
                    Dashboard
                  </Link>
                )}
                {user.role === 'CUSTOMER' && (
                  <Link href="/moj-nalog" className="py-2 px-2 text-sm" onClick={() => setIsMobileMenuOpen(false)}>
                    Moj nalog
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
