import { Layout } from "@/components/layout";
import { OptimizedImage } from "@/components/optimized-image";
import {
  getGetAuthSignInMethodsQueryKey,
  getGetAppointmentSalonContactQueryKey,
  getGetCustomerDashboardQueryKey,
  getListFavoritesQueryKey,
  getListMyAppointmentsQueryKey,
  useCancelAppointment,
  useDisconnectAuthSignInMethod,
  useGetAuthSignInMethods,
  useGetCustomerDashboard,
  useGetCurrentUser,
  useGetAppointmentSalonContact,
  useListFavorites,
  useListMyAppointments,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format, parseISO } from "date-fns";
import { Calendar, Clock, MapPin, Loader2, KeyRound, Link2, Link2Off, ShieldCheck, Heart, RotateCcw, Sparkles, GraduationCap } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SalonFavoriteButton } from "@/components/salon-favorite-button";
import { useBookingDraft } from "@/hooks/use-booking-draft";
import { DiscoveryCarousel } from "@/components/discovery-carousel";
import { EducationPurchases } from "@/components/education-purchases";

const appointmentStatusesWithSalonContact = new Set(["pending", "confirmed", "completed"]);

export default function CustomerDashboard() {
  const [location, setLocation] = useLocation();
  const { data: userResp, isLoading: isUserLoading } = useGetCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [providerToDisconnect, setProviderToDisconnect] = useState<"google" | "facebook" | null>(null);
  const [appointmentToCancel, setAppointmentToCancel] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [contactAppointmentId, setContactAppointmentId] = useState<string | null>(null);
  
  useEffect(() => {
    if (!isUserLoading && !userResp?.user) {
      setLocation("/prijava");
    }
  }, [userResp, isUserLoading, setLocation]);

  const { data: dashboard, isLoading: isDashboardLoading, refetch: refetchDash } = useGetCustomerDashboard({ query: { enabled: !!userResp?.user, queryKey: getGetCustomerDashboardQueryKey() }});
  const { data: appointments, isLoading: isApptsLoading, refetch: refetchAppts } = useListMyAppointments(undefined, { query: { enabled: !!userResp?.user, queryKey: getListMyAppointmentsQueryKey(undefined) }});
  const { data: signInMethods, isLoading: isSignInMethodsLoading, refetch: refetchSignInMethods } = useGetAuthSignInMethods({
    query: { enabled: !!userResp?.user, queryKey: getGetAuthSignInMethodsQueryKey() },
  });
  const { data: favorites, isLoading: isFavoritesLoading } = useListFavorites({
    query: { enabled: userResp?.user?.role === "CUSTOMER", queryKey: getListFavoritesQueryKey() },
  });
  const { data: salonContact, isFetching: isSalonContactLoading, error: salonContactError } = useGetAppointmentSalonContact(
    contactAppointmentId ?? "",
    {
      query: {
        enabled: Boolean(contactAppointmentId),
        queryKey: getGetAppointmentSalonContactQueryKey(contactAppointmentId ?? ""),
      },
    },
  );
  const { draft } = useBookingDraft(userResp?.user?.role === "CUSTOMER" ? userResp.user.id : undefined);
  
  const cancelMutation = useCancelAppointment();
  const disconnectMutation = useDisconnectAuthSignInMethod();
  // Wouter navigation can update its location before the browser search string
  // is observed by a render, so accept the query from either source.
  const requestedTab = new URLSearchParams(location.includes("?") ? location.slice(location.indexOf("?")) : window.location.search).get("tab");
  const activeTab = requestedTab === "favorites" || requestedTab === "settings" || requestedTab === "education" ? requestedTab : "appointments";

  useEffect(() => {
    const search = location.includes("?") ? location.slice(location.indexOf("?")) : window.location.search;
    const params = new URLSearchParams(search);
    const oauthStatus = params.get("oauth");
    const oauthError = params.get("oauth_error");
    if (!oauthStatus && !oauthError) return;

    if (oauthStatus === "linked") {
      const provider = params.get("provider") === "facebook" ? "Facebook" : "Google";
      void refetchSignInMethods();
      toast.success(`${provider} prijava je povezana.`, { description: "Novi način prijave je dodat na vaš LUMERA nalog." });
    } else if (oauthError) {
      toast.error("Povezivanje nije uspelo", { description: oauthError });
    }

    window.history.replaceState(null, "", `${window.location.pathname}?tab=settings`);
  }, [location, refetchSignInMethods, toast]);

  const handleCancel = (id: string) => {
    cancelMutation.mutate(
      { appointmentId: id, data: { reason: "Korisnik otkazao" } },
      {
        onSuccess: () => {
          toast.success("Termin otkazan", { description: "Vaš termin je uspešno otkazan." });
          setAppointmentToCancel(null);
          setContactAppointmentId((current) => current === id ? null : current);
          queryClient.removeQueries({ queryKey: getGetAppointmentSalonContactQueryKey(id) });
          refetchDash();
          refetchAppts();
        },
        onError: () => toast.error("Termin nije otkazan", { description: "Osvežite listu i pokušajte ponovo." }),
      },
    );
  };

  const disconnectProvider = () => {
    if (!providerToDisconnect) return;
    disconnectMutation.mutate(
      { provider: providerToDisconnect },
      {
        onSuccess: (updatedMethods) => {
          queryClient.setQueryData(getGetAuthSignInMethodsQueryKey(), updatedMethods);
          toast.success(`${providerToDisconnect === "google" ? "Google" : "Facebook"} prijava je odvojena.`);
          setProviderToDisconnect(null);
        },
        onError: (error: unknown) => {
          const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error
            ?? "Način prijave nije odvojen. Pokušajte ponovo.";
          toast.error("Promena nije sačuvana", { description: message });
        },
      },
    );
  };
  const connectProvider = (provider: "google" | "facebook") => {
    window.location.assign(`/api/auth/oauth/${provider}/start?flow=link`);
  };
  const requestPhoneCode = async () => {
    setPhoneBusy(true);
    const response = await fetch("/api/auth/phone-verification/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone }) });
    const body = await response.json(); setPhoneBusy(false);
    if (!response.ok) { toast.error(body.error ?? "Kod nije poslat"); return; }
    if (body.developmentCode) setPhoneCode(body.developmentCode);
    toast.success("Kod je poslat", { description: body.developmentCode ? "Lokalni kod je upisan." : "Proverite SMS poruku." });
  };
  const confirmPhone = async () => {
    setPhoneBusy(true);
    const response = await fetch("/api/auth/phone-verification/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, code: phoneCode }) });
    const body = await response.json(); setPhoneBusy(false);
    if (!response.ok) { toast.error(body.error ?? "Broj nije potvrđen"); return; }
    toast.success("Telefon je potvrđen i istorija termina je povezana.");
    queryClient.invalidateQueries({ queryKey: getListMyAppointmentsQueryKey(undefined) });
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

  if (isUserLoading || isDashboardLoading) {
    return (
      <Layout>
        <div className="container mx-auto space-y-8 px-4 py-10">
          <div className="flex items-center justify-between"><Skeleton className="h-10 w-56" /><Skeleton className="h-10 w-32" /></div>
          <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Layout>
    );
  }
  if (!userResp?.user) return null;
  const today = new Date().toISOString().slice(0, 10);
  const rebookUrl = (appointment: NonNullable<typeof appointments>[number]) =>
    `/saloni/${appointment.salonSlug}?serviceId=${encodeURIComponent(appointment.serviceId)}${appointment.employeeId ? `&employeeId=${encodeURIComponent(appointment.employeeId)}` : ""}`;

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
          {draft && (
            <Card className="mb-8 border-primary/20 bg-primary/[0.03]">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-primary/10 p-2 text-primary"><Clock className="h-5 w-5" /></div>
                  <div>
                    <p className="font-semibold">Nastavite zakazivanje</p>
                    <p className="text-sm text-muted-foreground">Sačuvali smo izbor za salon {draft.salonName}.</p>
                  </div>
                </div>
                <Button asChild><Link href={`/saloni/${draft.salonSlug}?serviceId=${encodeURIComponent(draft.serviceId)}${draft.employeeId ? `&employeeId=${encodeURIComponent(draft.employeeId)}` : ""}`}>Nastavi</Link></Button>
              </CardContent>
            </Card>
          )}
        
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
        {dashboard?.recommendations?.length ? (
          <section className="mb-8">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-primary"><Sparkles className="h-4 w-4" /><span className="text-xs font-bold uppercase tracking-[0.16em]">Za vas</span></div>
                <h2 className="mt-1 font-serif text-2xl font-bold">Preporučeno za vas</h2>
                <p className="text-sm text-muted-foreground">Na osnovu prethodnih zakazivanja.</p>
              </div>
              <Button variant="ghost" asChild><Link href="/saloni">Pogledajte sve</Link></Button>
            </div>
            <DiscoveryCarousel ariaLabel="Preporučeni saloni za vas">
              {dashboard.recommendations.map((salon) => (
                <div key={salon.id} className="group relative h-full overflow-hidden rounded-xl border bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                  <Link href={`/saloni/${salon.slug}`} className="block">
                    <OptimizedImage src={salon.imageUrl} alt={salon.name} width={400} height={144} className="h-36 w-full object-cover transition-transform duration-500 group-hover:scale-105" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" />
                    <div className="p-4"><p className="font-semibold">{salon.name}</p><p className="mt-1 text-sm text-muted-foreground">{salon.city} · {salon.popularServices[0] ?? "Beauty usluge"}</p></div>
                  </Link>
                  <SalonFavoriteButton salonId={salon.id} className="absolute right-3 top-3" />
                </div>
              ))}
            </DiscoveryCarousel>
          </section>
        ) : null}

        <Tabs value={activeTab} onValueChange={(tab) => setLocation(`/moj-nalog?tab=${tab}`)} className="w-full">
          <TabsList className="mb-6 border-b rounded-none w-full justify-start bg-transparent p-0 h-auto">
            <TabsTrigger value="appointments" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3">
              Moji Termini
            </TabsTrigger>
            <TabsTrigger value="favorites" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3">
              Omiljeni Saloni ({dashboard?.favoriteCount || 0})
            </TabsTrigger>
            <TabsTrigger value="education" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3">
              <GraduationCap className="mr-2 h-4 w-4" />Moje edukacije
            </TabsTrigger>
            <TabsTrigger value="settings" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3">
              Podešavanja Naloga
            </TabsTrigger>
          </TabsList>

          <TabsContent value="appointments" className="mt-0 space-y-4">
            {isApptsLoading ? (
               Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
            ) : appointments?.length === 0 ? (
              <Empty className="border bg-card py-14">
                <EmptyHeader><EmptyMedia variant="icon"><Calendar /></EmptyMedia><EmptyTitle>Nemate zakazane termine</EmptyTitle><EmptyDescription>Pronađite salon i zakažite svoj prvi tretman.</EmptyDescription></EmptyHeader>
                <EmptyContent><Button asChild><Link href="/saloni">Istraži salone</Link></Button></EmptyContent>
              </Empty>
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
                          <Link href={`/saloni/${appt.salonSlug}`} className="text-primary font-medium text-sm hover:underline flex items-center gap-1 mb-2">
                            <MapPin className="w-3.5 h-3.5" /> {appt.salonName}
                          </Link>
                          <div className="text-sm text-muted-foreground flex gap-4">
                            <span>Radnik: {appt.employeeName}</span>
                            <span>{appt.durationMinutes} min</span>
                            <span className="font-semibold text-foreground">{appt.price} RSD</span>
                          </div>
                          {contactAppointmentId === appt.id && appointmentStatusesWithSalonContact.has(appt.status) && (
                            <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">
                              {isSalonContactLoading ? (
                                <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Učitavanje privatnih podataka…</span>
                              ) : salonContact ? (
                                <>
                                  <p className="font-semibold">Kontakt i lokacija salona</p>
                                  <p className="mt-1">{salonContact.address}, {salonContact.postalCode ? `${salonContact.postalCode} ` : ""}{salonContact.city}</p>
                                  <p>{salonContact.phone} · {salonContact.email}</p>
                                </>
                              ) : (
                                <p className="text-destructive">{salonContactError ? "Privatni podaci nisu dostupni za ovaj termin." : "Privatni podaci nisu dostupni."}</p>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {appointmentStatusesWithSalonContact.has(appt.status) && (
                            <Button variant="outline" size="sm" onClick={() => setContactAppointmentId((current) => current === appt.id ? null : appt.id)}>
                              <MapPin className="mr-2 h-3.5 w-3.5" />{contactAppointmentId === appt.id ? "Sakrij kontakt" : "Kontakt i adresa"}
                            </Button>
                          )}
                          {appt.date < today && (
                            <Button variant="outline" size="sm" asChild>
                              <Link href={rebookUrl(appt)}><RotateCcw className="mr-2 h-3.5 w-3.5" />Zakaži ponovo</Link>
                            </Button>
                          )}
                          {(appt.status === 'pending' || appt.status === 'confirmed') && (
                            <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 border-destructive/20" onClick={() => setAppointmentToCancel(appt.id)} disabled={cancelMutation.isPending}>
                              Otkaži termin
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="favorites" className="mt-0">
              {isFavoritesLoading ? <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-56" /><Skeleton className="h-56" /><Skeleton className="h-56" /></div> : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {favorites?.map(salon => (
                    <div key={salon.id} className="group relative overflow-hidden rounded-xl border bg-card transition-all hover:shadow-md">
                      <Link href={`/saloni/${salon.slug}`} className="block">
                        <div className="h-40 w-full overflow-hidden"><OptimizedImage src={salon.imageUrl} alt={salon.name} width={400} height={160} className="h-full w-full object-cover transition-transform group-hover:scale-105" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" /></div>
                        <div className="p-4"><h4 className="font-bold text-lg">{salon.name}</h4><p className="text-sm text-muted-foreground">{salon.city}</p></div>
                      </Link>
                      <SalonFavoriteButton salonId={salon.id} className="absolute right-3 top-3" />
                    </div>
                  ))}
                  {(!favorites || favorites.length === 0) && (
                    <Empty className="col-span-full border bg-card py-14"><EmptyHeader><EmptyMedia variant="icon"><Heart /></EmptyMedia><EmptyTitle>Još nemate omiljene salone</EmptyTitle><EmptyDescription>Sačuvajte salon da biste mu se brzo vratili kada poželite novi termin.</EmptyDescription></EmptyHeader><EmptyContent><Button asChild><Link href="/saloni">Istraži salone</Link></Button></EmptyContent></Empty>
                  )}
                </div>
              )}
          </TabsContent>
          <TabsContent value="education" className="mt-0">
            <EducationPurchases />
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
             <div className="space-y-6">
             <Card>
               <CardHeader><CardTitle>Potvrdite telefon i povežite CRM istoriju</CardTitle><CardDescription>Važi i za Google/Facebook prijavu. Istorija gosta se dodaje tek nakon SMS potvrde broja.</CardDescription></CardHeader>
               <CardContent className="flex flex-wrap gap-2">
                 <Input className="max-w-[210px]" placeholder="+381 64 123 4567" value={phone} onChange={(event) => setPhone(event.target.value)} />
                 <Button variant="outline" disabled={phoneBusy} onClick={requestPhoneCode}>Pošalji kod</Button>
                 <Input className="w-32" placeholder="SMS kod" value={phoneCode} onChange={(event) => setPhoneCode(event.target.value)} />
                 <Button disabled={phoneBusy} onClick={confirmPhone}>Potvrdi broj</Button>
               </CardContent>
             </Card>
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
                  </div>
               </CardContent>
             </Card>
             <Card>
               <CardHeader>
                 <div className="flex items-center gap-3">
                   <div className="rounded-full bg-primary/10 p-2 text-primary"><ShieldCheck className="h-5 w-5" /></div>
                   <div>
                     <CardTitle>Načini prijave</CardTitle>
                     <CardDescription>Pregledajte i upravljajte prijavama povezanim sa LUMERA nalogom.</CardDescription>
                   </div>
                 </div>
               </CardHeader>
               <CardContent className="space-y-4">
                 <div className="rounded-lg border border-primary/15 bg-primary/5 p-4 text-sm text-muted-foreground">
                   Sačuvajte najmanje jedan način prijave. Google ili Facebook možete odvojiti samo kada je dostupna prijava e-mailom i lozinkom ili je povezan drugi provajder.
                 </div>
                 <div className="rounded-lg border p-4">
                   <div className="flex items-center justify-between gap-4">
                     <div className="flex items-center gap-3">
                       <div className="rounded-full bg-muted p-2"><KeyRound className="h-4 w-4" /></div>
                       <div>
                         <p className="font-medium">E-mail i lozinka</p>
                         <p className="text-sm text-muted-foreground">Prijava sa {userResp.user.email}</p>
                       </div>
                     </div>
                     <Badge variant={signInMethods?.passwordAvailable ? "default" : "secondary"}>
                       {isSignInMethodsLoading ? "Provera…" : signInMethods?.passwordAvailable ? "Dostupno" : "Nije podešeno"}
                     </Badge>
                   </div>
                 </div>

                 {isSignInMethodsLoading ? (
                   <div className="space-y-3">
                     <Skeleton className="h-20 w-full" />
                     <Skeleton className="h-20 w-full" />
                   </div>
                 ) : signInMethods?.providers.length ? (
                   <div className="space-y-3">
                     {signInMethods.providers.map((method) => {
                       const providerName = method.provider === "google" ? "Google" : "Facebook";
                       return (
                         <div key={method.provider} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                           <div>
                             <p className="font-medium">{providerName}</p>
                             <p className="text-sm text-muted-foreground">Povezano sa {method.email}</p>
                           </div>
                           <Button
                             variant="outline"
                             size="sm"
                             className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                             onClick={() => setProviderToDisconnect(method.provider)}
                             disabled={!method.canDisconnect || disconnectMutation.isPending}
                             title={method.canDisconnect ? `Odvoji ${providerName} prijavu` : "Dodajte drugi način prijave pre odvajanja"}
                           >
                             <Link2Off className="mr-2 h-4 w-4" />
                             Odvoji
                           </Button>
                         </div>
                       );
                     })}
                   </div>
                 ) : (
                   <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                     Google i Facebook još nisu povezani sa ovim nalogom.
                   </div>
                 )}
                  {!isSignInMethodsLoading && signInMethods && (
                    <div className="flex flex-col gap-4 rounded-lg border border-primary/20 bg-primary/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium">Dodajte rezervnu prijavu</p>
                        <p className="text-sm text-muted-foreground">Povežite Google ili Facebook da biste imali dodatni način pristupa nalogu.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(["google", "facebook"] as const)
                          .filter((provider) => !signInMethods.providers.some((method) => method.provider === provider))
                          .map((provider) => {
                            const providerName = provider === "google" ? "Google" : "Facebook";
                            return (
                              <Button key={provider} variant="outline" size="sm" onClick={() => connectProvider(provider)}>
                                <Link2 className="mr-2 h-4 w-4" />
                                Poveži {providerName}
                              </Button>
                            );
                          })}
                        {!(["google", "facebook"] as const).some((provider) => !signInMethods.providers.some((method) => method.provider === provider)) && (
                          <span className="self-center text-sm text-muted-foreground">Oba provajdera su već povezana.</span>
                        )}
                      </div>
                    </div>
                  )}
               </CardContent>
             </Card>
             </div>
          </TabsContent>

        </Tabs>
      </div>
      <AlertDialog open={appointmentToCancel !== null} onOpenChange={(open) => !open && setAppointmentToCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Otkazati termin?</AlertDialogTitle><AlertDialogDescription>Termin će biti otkazan, a salon će dobiti obaveštenje. Ovu radnju ne možete vratiti.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>Zadrži termin</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={cancelMutation.isPending} onClick={(event) => { event.preventDefault(); if (appointmentToCancel) handleCancel(appointmentToCancel); }}>
              {cancelMutation.isPending ? "Otkazivanje…" : "Otkaži termin"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={providerToDisconnect !== null} onOpenChange={(open) => !open && setProviderToDisconnect(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Odvojiti {providerToDisconnect === "google" ? "Google" : "Facebook"} prijavu?</AlertDialogTitle>
            <AlertDialogDescription>
              Posle odvajanja više nećete moći da se prijavite ovim načinom. Preostali načini prijave ostaju povezani sa vašim LUMERA nalogom.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectMutation.isPending}>Otkaži</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                disconnectProvider();
              }}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? "Odvajanje…" : "Odvoji prijavu"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
