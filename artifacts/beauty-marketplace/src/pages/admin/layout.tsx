import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Loader2, LayoutDashboard, Store, Users, Star, CreditCard, MessageSquare, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const navLinks = [
  { href: "/admin", label: "Pregled", icon: LayoutDashboard },
  { href: "/admin/saloni", label: "Saloni", icon: Store },
  { href: "/admin/korisnici", label: "Korisnici", icon: Users },
  { href: "/admin/loyalty", label: "Loyalty Program", icon: Star },
  { href: "/admin/pretplate", label: "Pretplate", icon: CreditCard },
  { href: "/admin/recenzije", label: "Recenzije", icon: MessageSquare },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: userResp, isLoading } = useGetCurrentUser();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

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

  if (isLoading || !userResp?.user) {
    return (
      <Layout>
        <div className="flex justify-center p-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" data-testid="admin-loading" />
        </div>
      </Layout>
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
            }`}
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
    <Layout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        {/* Mobile Header */}
        <div className="md:hidden w-full flex items-center justify-between bg-card p-4 rounded-xl border shadow-sm mb-4">
          <span className="font-serif font-bold text-lg">Admin Panel</span>
          <Button variant="ghost" size="icon" onClick={() => setIsMobileOpen(!isMobileOpen)} data-testid="admin-mobile-menu-trigger">
            {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>

        {/* Mobile Nav */}
        {isMobileOpen && (
          <div className="md:hidden w-full bg-card p-4 rounded-xl border shadow-sm mb-4">
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
    </Layout>
  );
}
