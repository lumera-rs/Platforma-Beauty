import { BusinessLayout } from "@/components/business-layout";
import { GuideHelpLink } from "@/components/guide-help-link";
import { Link, useLocation } from "wouter";
import { useGetSalonDashboard, useGetCurrentUser, getGetSalonDashboardQueryKey } from "@workspace/api-client-react";
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Loader2, TrendingUp, Users, Calendar, Clock3, DollarSign, Settings, Bell, Star, GraduationCap, Package, Store, LayoutGrid, HeartHandshake, Zap, Box, BarChart3, Bot, Menu } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function OwnerSidebar({ current }: { current: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const links = [
    { href: "/vlasnik", label: "Dashboard", guideId: "vl-dashboard", icon: <TrendingUp className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/kalendar", label: "Kalendar", guideId: "vl-kalendar", icon: <Calendar className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/usluge", label: "Usluge", guideId: "vl-usluge", icon: <Settings className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/resursi", label: "Resursi", guideId: "vl-resursi", icon: <LayoutGrid className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/profil", label: "Profil salona", guideId: "vl-profil", icon: <Store className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/zaposleni", label: "Zaposleni", guideId: "vl-zaposleni", icon: <Users className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/klijenti", label: "CRM & Retencija", guideId: "vl-klijenti", icon: <HeartHandshake className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/inventar", label: "Zalihe", guideId: "vl-inventar", icon: <Package className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/radno-vreme", label: "Radno vreme", guideId: "vl-radno-vreme", icon: <Clock3 className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/automatizacije", label: "Automatizacije", guideId: "vl-automatizacije", icon: <Zap className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/paketi", label: "Paketi tretmana", guideId: "vl-paketi", icon: <Box className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/performanse", label: "Performanse tima", guideId: "vl-performanse", icon: <BarChart3 className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/ai-asistent", label: "AI Asistent", guideId: "vl-ai", icon: <Bot className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/shop", label: "B2B Oprema", guideId: "vl-shop", icon: <DollarSign className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/porudzbine", label: "Porudžbine", guideId: "vl-porudzbine", icon: <Package className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/obavestenja", label: "Obaveštenja", guideId: "vl-obavestenja", icon: <Bell className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/loyalty", label: "Loyalty Program", guideId: "vl-loyalty", icon: <Star className="w-4 h-4 mr-2" /> },
    { href: "/biznis/edukacije", label: "Edukacije", guideId: "vl-edukacije", icon: <GraduationCap className="w-4 h-4 mr-2" /> },
  ];

  const sidebarContent = (
    <div className="space-y-1">
      {links.map((link) => (
        <div key={link.href} className="flex items-center gap-1">
          <Link
            href={link.href}
            onClick={() => setIsOpen(false)}
            className={`flex min-w-0 flex-1 items-center rounded-lg px-4 py-3 text-sm font-medium transition-colors ${current === link.href ? 'bg-primary text-primary-foreground' : 'text-foreground/80 hover:bg-muted'}`}
          >
            {link.icon} <span className="truncate">{link.label}</span>
          </Link>
          <GuideHelpLink
            sectionId={link.guideId}
            label={link.label}
            onClick={() => setIsOpen(false)}
          />
        </div>
      ))}
    </div>
  );

  const currentLabel = links.find(l => l.href === current)?.label || "Meni";

  return (
    <>
      {/* Mobile Drawer Trigger */}
      <div className="md:hidden w-full mb-4">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full flex justify-between items-center">
              <span>{currentLabel}</span>
              <Menu className="w-4 h-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px] overflow-y-auto">
            <div className="py-4">
              <h2 className="font-bold text-lg mb-4 px-4">Navigacija</h2>
              {sidebarContent}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop Sidebar */}
      <aside
        className="hidden md:block w-64 shrink-0 max-h-[calc(100vh-7rem)] overflow-y-auto overscroll-contain pr-1 custom-scrollbar"
        data-testid="owner-sidebar"
      >
        {sidebarContent}
      </aside>
    </>
  );
}

export default function OwnerDashboard() {
  const [location, setLocation] = useLocation();
  const { data: userResp, isLoading: isUserLoading } = useGetCurrentUser();
  const [scope, setScope] = useState<"location" | "all">("location");
  
  useEffect(() => {
    if (!isUserLoading) {
      if (!userResp?.user) setLocation("/prijava");
      else if (userResp.user.role !== 'SALON_OWNER') setLocation("/");
    }
  }, [userResp, isUserLoading, setLocation]);

  const dashboardParams = scope === "all" ? { scope } : undefined;
  const { data: dash, isLoading } = useGetSalonDashboard(
    dashboardParams,
    { query: {
      enabled: !!userResp?.user && userResp.user.role === "SALON_OWNER",
      queryKey: getGetSalonDashboardQueryKey(dashboardParams),
    } },
  );

  if (isUserLoading || isLoading) return <BusinessLayout><div className="flex justify-center p-20"><Loader2 className="w-8 h-8 animate-spin" /></div></BusinessLayout>;
  if (!dash) return null;

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik" />
        
        <div className="flex-1 space-y-6 w-full">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-serif font-bold mb-2">{scope === "all" ? "Pregled poslovanja" : "Dashboard salona"}</h1>
              <p className="text-muted-foreground">
                {scope === "all"
                  ? `Zbirni pregled za svih ${dash.locations.length} ${dash.locations.length === 1 ? "lokaciju" : "lokacija"}`
                  : `${dash.salon.name} - Pregled poslovanja`}
              </p>
            </div>
            <div className="inline-flex w-full rounded-lg border bg-muted/40 p-1 sm:w-auto" aria-label="Opseg dashboarda">
              <Button
                type="button"
                size="sm"
                variant={scope === "location" ? "default" : "ghost"}
                className="flex-1 sm:flex-none"
                aria-pressed={scope === "location"}
                onClick={() => setScope("location")}
              >
                Aktivna lokacija
              </Button>
              <Button
                type="button"
                size="sm"
                variant={scope === "all" ? "default" : "ghost"}
                className="flex-1 sm:flex-none"
                aria-pressed={scope === "all"}
                onClick={() => setScope("all")}
              >
                Sve lokacije
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-2">
                  <p className="text-sm font-medium text-muted-foreground">Prihod (Ovaj mesec)</p>
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                </div>
                <h3 className="text-2xl font-bold">{dash.revenueThisMonth.toLocaleString()} RSD</h3>
                <p className={`text-xs mt-2 font-medium ${dash.revenueChange > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {dash.revenueChange > 0 ? '+' : ''}{dash.revenueChange}% u odnosu na prošli mesec
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-2">
                  <p className="text-sm font-medium text-muted-foreground">Zakazivanja (Ovaj mesec)</p>
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                </div>
                <h3 className="text-2xl font-bold">{dash.bookingsThisMonth}</h3>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-2">
                  <p className="text-sm font-medium text-muted-foreground">Novi klijenti</p>
                  <Users className="w-4 h-4 text-muted-foreground" />
                </div>
                <h3 className="text-2xl font-bold">{dash.newCustomers}</h3>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-2">
                  <p className="text-sm font-medium text-primary">Loyalty za sve lokacije</p>
                  <Star className="w-4 h-4 text-primary" />
                </div>
                <h3 className="text-xl font-bold text-primary">{dash.loyalty.currentTier}</h3>
                <p className="text-xs mt-2 text-primary/80">
                  {dash.loyalty.freeSubscription ? 'Besplatna pretplata aktivna' : `Sledeći nivo: još ${dash.loyalty.amountToNextTier} RSD`}
                </p>
              </CardContent>
            </Card>
          </div>

          {scope === "all" && (
            <Card>
              <CardHeader className="border-b pb-4">
                <CardTitle className="text-lg">Učinak po lokaciji</CardTitle>
              </CardHeader>
              <CardContent className="divide-y p-0">
                {dash.locations.map((salon) => (
                  <div key={salon.id} className="grid gap-3 p-4 text-sm sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:gap-8">
                    <p className="font-semibold">{salon.name}</p>
                    <p><span className="text-muted-foreground">Prihod: </span><strong>{salon.revenueThisMonth.toLocaleString()} RSD</strong></p>
                    <p><span className="text-muted-foreground">Termini: </span><strong>{salon.bookingsThisMonth}</strong></p>
                    <p><span className="text-muted-foreground">Klijenti: </span><strong>{salon.newCustomers}</strong></p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <CardTitle className="text-lg">Današnji termini</CardTitle>
              <Button variant="outline" size="sm" asChild><Link href="/vlasnik/kalendar">Vidi kalendar</Link></Button>
            </CardHeader>
            <CardContent className="p-0">
              {dash.todayAppointments.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">Nema zakazanih termina za danas.</div>
              ) : (
                <div className="divide-y">
                  {dash.todayAppointments.map(appt => (
                    <div key={appt.id} className="p-4 flex items-center justify-between hover:bg-muted/30">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-xl bg-secondary flex flex-col items-center justify-center font-bold text-secondary-foreground">
                          {appt.startTime}
                        </div>
                        <div>
                          <p className="font-bold">{appt.customerName}</p>
                          <p className="text-sm text-muted-foreground">{appt.serviceName} • {appt.employeeName}{scope === "all" ? ` • ${appt.salonName}` : ""}</p>
                        </div>
                      </div>
                      <Badge variant={appt.status === 'confirmed' ? 'default' : 'secondary'}>{appt.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          
        </div>
      </div>
    </BusinessLayout>
  );
}
