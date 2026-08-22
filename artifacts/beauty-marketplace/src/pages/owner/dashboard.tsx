import { BusinessLayout } from "@/components/business-layout";
import { Link, useLocation } from "wouter";
import { useGetSalonDashboard, useGetCurrentUser, getGetSalonDashboardQueryKey } from "@workspace/api-client-react";
import { useEffect } from "react";
import { Loader2, TrendingUp, Users, Calendar, DollarSign, Settings, Bell, Star, GraduationCap, Package, Store, LayoutGrid } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function OwnerSidebar({ current }: { current: string }) {
  const links = [
    { href: "/vlasnik", label: "Dashboard", icon: <TrendingUp className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/kalendar", label: "Kalendar", icon: <Calendar className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/usluge", label: "Usluge", icon: <Settings className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/resursi", label: "Resursi", icon: <LayoutGrid className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/profil", label: "Profil salona", icon: <Store className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/zaposleni", label: "Zaposleni", icon: <Users className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/shop", label: "B2B Oprema", icon: <DollarSign className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/porudzbine", label: "Porudžbine", icon: <Package className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/obavestenja", label: "Obaveštenja", icon: <Bell className="w-4 h-4 mr-2" /> },
    { href: "/vlasnik/loyalty", label: "Loyalty Program", icon: <Star className="w-4 h-4 mr-2" /> },
    { href: "/biznis/edukacije", label: "Edukacije", icon: <GraduationCap className="w-4 h-4 mr-2" /> },
  ];

  return (
    <aside className="w-full md:w-64 shrink-0 space-y-1">
      {links.map(l => (
        <Link 
          key={l.href} 
          href={l.href}
          className={`flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-colors ${current === l.href ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground/80'}`}
        >
          {l.icon} {l.label}
        </Link>
      ))}
    </aside>
  );
}

export default function OwnerDashboard() {
  const [location, setLocation] = useLocation();
  const { data: userResp, isLoading: isUserLoading } = useGetCurrentUser();
  
  useEffect(() => {
    if (!isUserLoading) {
      if (!userResp?.user) setLocation("/prijava");
      else if (userResp.user.role !== 'SALON_OWNER') setLocation("/");
    }
  }, [userResp, isUserLoading, setLocation]);

  const { data: dash, isLoading } = useGetSalonDashboard({ query: { enabled: !!userResp?.user && userResp.user.role === 'SALON_OWNER', queryKey: getGetSalonDashboardQueryKey() } });

  if (isUserLoading || isLoading) return <BusinessLayout><div className="flex justify-center p-20"><Loader2 className="w-8 h-8 animate-spin" /></div></BusinessLayout>;
  if (!dash) return null;

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik" />
        
        <div className="flex-1 space-y-6 w-full">
          <div>
            <h1 className="text-3xl font-serif font-bold mb-2">Dashboard salona</h1>
            <p className="text-muted-foreground">{dash.salon.name} - Pregled poslovanja</p>
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
                  <p className="text-sm font-medium text-primary">Loyalty Nivo</p>
                  <Star className="w-4 h-4 text-primary" />
                </div>
                <h3 className="text-xl font-bold text-primary">{dash.loyalty.currentTier}</h3>
                <p className="text-xs mt-2 text-primary/80">
                  {dash.loyalty.freeSubscription ? 'Besplatna pretplata aktivna' : `Sledeći nivo: još ${dash.loyalty.amountToNextTier} RSD`}
                </p>
              </CardContent>
            </Card>
          </div>

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
                          <p className="text-sm text-muted-foreground">{appt.serviceName} • {appt.employeeName}</p>
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
