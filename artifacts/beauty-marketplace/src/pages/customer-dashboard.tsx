import { Layout } from "@/components/layout";
import { useGetCustomerDashboard, useListMyAppointments, useCancelAppointment, useGetCurrentUser, getGetCustomerDashboardQueryKey, getListMyAppointmentsQueryKey } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, parseISO } from "date-fns";
import { Calendar, Clock, MapPin, Search, Loader2 } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect } from "react";

export default function CustomerDashboard() {
  const [location, setLocation] = useLocation();
  const { data: userResp, isLoading: isUserLoading } = useGetCurrentUser();
  const { toast } = useToast();
  
  useEffect(() => {
    if (!isUserLoading && !userResp?.user) {
      setLocation("/prijava");
    }
  }, [userResp, isUserLoading, setLocation]);

  const { data: dashboard, isLoading: isDashboardLoading, refetch: refetchDash } = useGetCustomerDashboard({ query: { enabled: !!userResp?.user, queryKey: getGetCustomerDashboardQueryKey() }});
  const { data: appointments, isLoading: isApptsLoading, refetch: refetchAppts } = useListMyAppointments(undefined, { query: { enabled: !!userResp?.user, queryKey: getListMyAppointmentsQueryKey(undefined) }});
  
  const cancelMutation = useCancelAppointment();
  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  const activeTab = requestedTab === "favorites" || requestedTab === "settings" ? requestedTab : "appointments";

  const handleCancel = (id: string) => {
    if(confirm("Da li ste sigurni da želite da otkažete termin?")) {
      cancelMutation.mutate(
        { appointmentId: id, data: { reason: "Korisnik otkazao" } },
        {
          onSuccess: () => {
            toast.success("Termin otkazan", { description: "Vaš termin je uspešno otkazan." });
            refetchDash();
            refetchAppts();
          }
        }
      );
    }
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'confirmed': return <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20">Potvrđeno</Badge>;
      case 'pending': return <Badge variant="secondary" className="text-orange-600 bg-orange-100">Na čekanju</Badge>;
      case 'completed': return <Badge variant="outline">Završeno</Badge>;
      case 'cancelled': return <Badge variant="destructive">Otkazano</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  if (isUserLoading || isDashboardLoading) return <Layout><div className="flex justify-center p-20"><Loader2 className="w-8 h-8 animate-spin" /></div></Layout>;
  if (!userResp?.user) return null;

  return (
    <Layout>
      <div className="bg-muted/30 py-8 border-b">
        <div className="container mx-auto px-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">Zdravo, {userResp.user.firstName}</h1>
            <p className="text-muted-foreground mt-1">Upravljajte svojim terminima i sačuvanim salonima</p>
          </div>
          <Button asChild>
            <Link href="/saloni">Novi termin</Link>
          </Button>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        
        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                <Calendar className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Predstojeći termini</p>
                <h3 className="text-2xl font-bold">{dashboard?.upcoming?.length || 0}</h3>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-12 h-12 bg-accent/20 text-accent rounded-full flex items-center justify-center">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Ukupno poseta</p>
                <h3 className="text-2xl font-bold">{dashboard?.visitCount || 0}</h3>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={(tab) => setLocation(`/moj-nalog?tab=${tab}`)} className="w-full">
          <TabsList className="mb-6 border-b rounded-none w-full justify-start bg-transparent p-0 h-auto">
            <TabsTrigger value="appointments" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3">
              Moji Termini
            </TabsTrigger>
            <TabsTrigger value="favorites" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3">
              Omiljeni Saloni ({dashboard?.favoriteCount || 0})
            </TabsTrigger>
            <TabsTrigger value="settings" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3">
              Podešavanja Naloga
            </TabsTrigger>
          </TabsList>

          <TabsContent value="appointments" className="mt-0 space-y-4">
            {isApptsLoading ? (
               Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
            ) : appointments?.length === 0 ? (
              <div className="text-center py-16 border rounded-xl bg-card border-dashed">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                  <Calendar className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-bold mb-2">Nemate zakazane termine</h3>
                <p className="text-muted-foreground mb-6">Pronađite salon i zakažite svoj prvi tretman.</p>
                <Button asChild><Link href="/saloni">Istraži salone</Link></Button>
              </div>
            ) : (
              <div className="space-y-4">
                {appointments?.map(appt => (
                  <Card key={appt.id} className="overflow-hidden">
                    <div className="flex flex-col sm:flex-row">
                      <div className="bg-muted p-4 sm:w-48 flex flex-col items-center justify-center text-center border-b sm:border-b-0 sm:border-r">
                        <span className="text-sm font-semibold uppercase text-muted-foreground">
                          {format(parseISO(appt.date), 'MMM').replace('.', '')}
                        </span>
                        <span className="text-3xl font-serif font-bold text-primary">
                          {format(parseISO(appt.date), 'dd')}
                        </span>
                        <span className="text-sm font-medium mt-1">
                          {appt.startTime}
                        </span>
                      </div>
                      <div className="p-4 sm:p-6 flex-1 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-bold text-lg">{appt.serviceName}</h4>
                            {getStatusBadge(appt.status)}
                          </div>
                          <Link href={`/saloni/${appt.salonId}`} className="text-primary font-medium text-sm hover:underline flex items-center gap-1 mb-2">
                            <MapPin className="w-3.5 h-3.5" /> {appt.salonName}
                          </Link>
                          <div className="text-sm text-muted-foreground flex gap-4">
                            <span>Radnik: {appt.employeeName}</span>
                            <span>{appt.durationMinutes} min</span>
                            <span className="font-semibold text-foreground">{appt.price} RSD</span>
                          </div>
                        </div>
                        {(appt.status === 'pending' || appt.status === 'confirmed') && (
                          <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 border-destructive/20" onClick={() => handleCancel(appt.id)} disabled={cancelMutation.isPending}>
                            Otkaži termin
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="favorites" className="mt-0">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {dashboard?.recentSalons?.map(salon => (
                  <Link key={salon.id} href={`/saloni/${salon.slug}`} className="group block border rounded-xl overflow-hidden bg-card hover:shadow-md transition-all">
                    <div className="h-40 w-full overflow-hidden">
                       <img src={salon.imageUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    </div>
                    <div className="p-4">
                      <h4 className="font-bold text-lg">{salon.name}</h4>
                      <p className="text-sm text-muted-foreground">{salon.city}</p>
                    </div>
                  </Link>
                ))}
                {(!dashboard?.recentSalons || dashboard.recentSalons.length === 0) && (
                   <div className="col-span-full text-center py-12 text-muted-foreground border border-dashed rounded-xl">
                      Nema sačuvanim salona.
                   </div>
                )}
             </div>
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
             <Card>
               <CardHeader>
                 <CardTitle>Podaci o nalogu</CardTitle>
               </CardHeader>
               <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 max-w-md">
                     <div>
                       <p className="text-sm text-muted-foreground mb-1">Ime</p>
                       <p className="font-medium">{userResp.user.firstName}</p>
                     </div>
                     <div>
                       <p className="text-sm text-muted-foreground mb-1">Prezime</p>
                       <p className="font-medium">{userResp.user.lastName}</p>
                     </div>
                     <div className="col-span-2">
                       <p className="text-sm text-muted-foreground mb-1">Email adresa</p>
                       <p className="font-medium">{userResp.user.email}</p>
                     </div>
                     <div className="col-span-2 mt-4 pt-4 border-t">
                        <Button variant="outline">Izmeni lozinku</Button>
                     </div>
                  </div>
               </CardContent>
             </Card>
          </TabsContent>

        </Tabs>
      </div>
    </Layout>
  );
}
