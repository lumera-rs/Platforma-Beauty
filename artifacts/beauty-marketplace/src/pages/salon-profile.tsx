import { BookingWidget, MobileBookingTrigger, MobileBookingDrawer } from "@/components/booking-widget";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useGetSalon, useGetSalonAvailability, useCreateAppointment, useGetCurrentUser, useGetCustomerSalonReview, useUpsertCustomerSalonReview, useDeleteCustomerSalonReview, getGetSalonAvailabilityQueryKey, getGetSalonQueryKey, getGetCustomerSalonReviewQueryKey } from "@workspace/api-client-react";
import { useParams, useLocation, useSearch } from "wouter";
import { MapPin, Star, Clock, Phone, Mail, Check, CalendarDays, Loader2, Heart, ShieldCheck, Flame, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { format, isValid, parseISO } from "date-fns";
import { SalonGallery, MediaItem } from "@/components/salon-gallery";
import { SimpleMap } from "@/components/simple-map";
import { Skeleton } from "@/components/ui/skeleton";
import { SalonFavoriteButton } from "@/components/salon-favorite-button";
import { useBookingDraft } from "@/hooks/use-booking-draft";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function SalonProfile() {
  const { slug } = useParams();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: salon, isLoading, refetch: refetchSalon } = useGetSalon(slug || "", {
    query: {
      queryKey: getGetSalonQueryKey(slug || ""),
      refetchOnMount: "always",
    },
  });
  const { data: userResp } = useGetCurrentUser();
  const user = userResp?.user;
  const { draft, saveDraft, clearDraft } = useBookingDraft(user?.role === "CUSTOMER" ? user.id : undefined);

  const salonData = salon;
  
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [favoriteEmployeeId, setFavoriteEmployeeId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{start: string, end: string, employeeId?: string|null} | null>(null);
  const [bookingStep, setBookingStep] = useState(1);
  const [hasInteractedWithEmployee, setHasInteractedWithEmployee] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [reviewServiceName, setReviewServiceName] = useState("");
  const [showProfilePhoto, setShowProfilePhoto] = useState(false);
  const restoredSelection = useRef<string | null>(null);
  
  const dateStr = format(selectedDate, 'yyyy-MM-dd');
  
  const { data: availability, isLoading: isLoadingAvailability } = useGetSalonAvailability(
    salonData?.id || "",
    { serviceId: selectedService || "", date: dateStr, employeeId: selectedEmployee || undefined },
    { query: { enabled: !!salonData?.id && !!selectedService, queryKey: getGetSalonAvailabilityQueryKey(salonData?.id || "", { serviceId: selectedService || "", date: dateStr, employeeId: selectedEmployee || undefined }) } }
  );

  const createAppointment = useCreateAppointment();
  const upsertReview = useUpsertCustomerSalonReview();
  const deleteCustomerSalonReview = useDeleteCustomerSalonReview();
  const { data: reviewContext, isLoading: isLoadingReviewContext, refetch: refetchReviewContext } = useGetCustomerSalonReview(
    salonData?.id || "",
    {
      query: {
        enabled: user?.role === "CUSTOMER" && !!salonData?.id,
        queryKey: getGetCustomerSalonReviewQueryKey(salonData?.id || ""),
        refetchOnMount: "always",
      },
    },
  );
  const reviewServiceOptions = useMemo(() => [...new Set([
    ...(reviewContext?.eligibleServices ?? []),
    ...(reviewContext?.review ? [reviewContext.review.serviceName] : []),
  ])], [reviewContext]);
  const eligibleStaff = useMemo(() => selectedService ? salonData?.staff.filter((employee) => employee.serviceIds.includes(selectedService)) ?? [] : salonData?.staff ?? [], [salonData?.staff, selectedService]);

  useEffect(() => {
    if (!salonData?.id || user?.role !== "CUSTOMER") return;
    fetch(`/api/customer/favorite-employees/${salonData.id}`, { credentials: "include" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setFavoriteEmployeeId(data?.employeeId ?? null))
      .catch(() => setFavoriteEmployeeId(null));
  }, [salonData?.id, user?.role]);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      void refetchSalon();
      if (user?.role === "CUSTOMER" && salonData?.id) void refetchReviewContext();
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [refetchReviewContext, refetchSalon, salonData?.id, user?.role]);

  useEffect(() => {
    if (selectedEmployee && !eligibleStaff.some((employee) => employee.id === selectedEmployee)) setSelectedEmployee(null);
    if (!selectedEmployee && favoriteEmployeeId && eligibleStaff.some((employee) => employee.id === favoriteEmployeeId)) setSelectedEmployee(favoriteEmployeeId);
  }, [eligibleStaff, favoriteEmployeeId, selectedEmployee]);

  useEffect(() => {
    if (selectedService && bookingStep === 1) setBookingStep(2);
  }, [selectedService]);

  useEffect(() => {
    if (!salonData || user?.role !== "CUSTOMER") return;
    const params = new URLSearchParams(search);
    const requestedServiceId = params.get("serviceId");
    const requestedEmployeeId = params.get("employeeId");
    const matchingDraft = !requestedServiceId && draft?.salonSlug === salonData.slug ? draft : null;
    const serviceId = requestedServiceId ?? matchingDraft?.serviceId;
    const employeeId = requestedEmployeeId ?? matchingDraft?.employeeId ?? null;
    const key = `${salonData.id}:${search}:${matchingDraft?.serviceId ?? ""}:${matchingDraft?.date ?? ""}`;
    if (restoredSelection.current === key || !serviceId || !salonData.services.some((service) => service.id === serviceId)) return;

    const dateValue = matchingDraft ? parseISO(matchingDraft.date) : new Date();
    setSelectedService(serviceId);
    setSelectedEmployee(employeeId && salonData.staff.some((employee) => employee.id === employeeId) ? employeeId : null);
    setSelectedDate(isValid(dateValue) ? dateValue : new Date());
    setSelectedSlot(null);
    setBookingStep(3);
    setHasInteractedWithEmployee(!!employeeId);
    restoredSelection.current = key;
    if (requestedServiceId) {
      window.setTimeout(() => document.getElementById("booking-widget")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  }, [draft, salonData, search, user?.role]);

  useEffect(() => {
    if (!salonData || user?.role !== "CUSTOMER" || !selectedService || isSuccess) return;
    saveDraft({
      salonSlug: salonData.slug,
      salonName: salonData.name,
      serviceId: selectedService,
      employeeId: selectedEmployee,
      date: format(selectedDate, "yyyy-MM-dd"),
    });
  }, [isSuccess, salonData, saveDraft, selectedDate, selectedEmployee, selectedService, user?.role]);

  useEffect(() => {
    if (selectedEmployee) setHasInteractedWithEmployee(true);
  }, [selectedEmployee]);

  const setFavorite = async (employeeId: string) => {
    if (!user) { setLocation("/prijava"); return; }
    const response = await fetch(`/api/customer/favorite-employees/${salonData?.id}`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeId }) });
    if (!response.ok) { toast.error("Omiljeni zaposleni nije sačuvan."); return; }
    setFavoriteEmployeeId(employeeId); setSelectedEmployee(employeeId); toast.success("Omiljeni zaposleni je sačuvan.");
  };

  const handleBook = () => {
    if (!user) {
      toast.error("Prijava obavezna", { description: "Morate biti prijavljeni da biste zakazali termin." });
      setLocation("/prijava");
      return;
    }
    
    if (!salonData || !selectedService || !selectedSlot) return;

    createAppointment.mutate({
      data: {
        salonId: salonData.id,
        serviceId: selectedService,
        date: dateStr,
        startTime: selectedSlot.start,
        employeeId: selectedEmployee ?? undefined
      }
    }, {
      onSuccess: () => {
        clearDraft();
        setIsSuccess(true);
      },
      onError: () => {
        toast.error("Greška", { description: "Došlo je do greške prilikom zakazivanja." });
      }
    });
  };

  const handleSelectService = (serviceId: string) => {
    setSelectedService(serviceId);
    setSelectedSlot(null);
    setBookingStep(2);
    if (window.innerWidth < 1024) {
      setIsMobileDrawerOpen(true);
    } else {
      setTimeout(() => {
        document.getElementById('booking-widget')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  };

  const openReviewDialog = () => {
    const review = reviewContext?.review;
    const selectedService = review?.serviceName ?? reviewContext?.eligibleServices[0] ?? "";
    setReviewRating(review?.rating ?? 5);
    setReviewText(review?.text ?? "");
    setReviewServiceName(selectedService);
    setShowProfilePhoto(review?.showProfilePhoto ?? false);
    setIsReviewDialogOpen(true);
  };

  const saveReview = () => {
    if (!salonData || !reviewServiceName || !reviewText.trim()) return;
    upsertReview.mutate({
      salonId: salonData.id,
      data: { serviceName: reviewServiceName, rating: reviewRating, text: reviewText.trim(), showProfilePhoto },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSalonQueryKey(salonData.slug) });
        queryClient.invalidateQueries({ queryKey: getGetCustomerSalonReviewQueryKey(salonData.id) });
        setIsReviewDialogOpen(false);
        toast.success(reviewContext?.review ? "Recenzija je izmenjena." : "Hvala na recenziji!");
      },
      onError: (error: unknown) => {
        const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? "Recenzija nije sačuvana. Pokušajte ponovo.";
        toast.error("Promena nije sačuvana", { description: message });
      },
    });
  };

  const deleteReview = () => {
    if (!salonData) return;
    deleteCustomerSalonReview.mutate({ salonId: salonData.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSalonQueryKey(salonData.slug) });
        queryClient.invalidateQueries({ queryKey: getGetCustomerSalonReviewQueryKey(salonData.id) });
        setReviewRating(5);
        setReviewText("");
        setReviewServiceName("");
        setShowProfilePhoto(false);
        setIsReviewDialogOpen(false);
        toast.success("Recenzija je obrisana.");
      },
      onError: (error: unknown) => {
        const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? "Recenzija nije obrisana. Pokušajte ponovo.";
        toast.error("Brisanje nije uspelo", { description: message });
      },
    });
  };

  const mediaItems: MediaItem[] = useMemo(() => {
    if (!salonData) return [];
    const items: MediaItem[] = [];
    if (salonData.videoUrl) {
      items.push({ type: 'video', url: salonData.videoUrl });
    }
    if (salonData.imageUrl) {
      items.push({ type: 'image', url: salonData.imageUrl });
    }
    if (salonData.gallery && Array.isArray(salonData.gallery)) {
      salonData.gallery.forEach(url => {
        if (url && url !== salonData.imageUrl) {
           items.push({ type: 'image', url });
        }
      });
    }
    // Fallbacks if completely empty
    if (items.length === 0) {
      items.push({ type: 'image', url: "https://images.unsplash.com/photo-1519014816548-bf5fe059c98b?q=80&w=800" });
    }
    return items;
  }, [salonData]);

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 space-y-8">
          <Skeleton className="h-[360px] w-full rounded-3xl" />
          <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
            <div className="space-y-4">
              <Skeleton className="h-9 w-1/2" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
            <Skeleton className="hidden h-[520px] rounded-2xl lg:block" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!salonData) return <Layout><div className="p-12 text-center">Salon nije pronađen.</div></Layout>;

  return (
    <Layout>
      <div className="w-full bg-background">
        <div className="container mx-auto px-4 py-8 md:py-12">
          {/* Top Section */}
          <div className="flex flex-col lg:flex-row gap-8 lg:gap-12 items-start">
             <div className="w-full lg:w-1/2 xl:w-[55%]">
                <SalonGallery media={mediaItems} salonName={salonData.name} />
             </div>

              <div className="relative w-full lg:w-1/2 xl:w-[45%] flex flex-col justify-center space-y-6 pt-2 lg:pt-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge className="bg-primary/10 text-primary hover:bg-primary/20 border-none px-3 py-1">Salon</Badge>
                  {salonData.featured && <Badge className="bg-amber-100 text-amber-800 border-none px-3 py-1">Istaknuto</Badge>}
                  {salonData.topSalon && <Badge className="bg-rose-100 text-rose-800 border-none px-3 py-1">Top Salon</Badge>}
                  {salonData.instantBooking && <Badge className="bg-emerald-100 text-emerald-800 border-none px-3 py-1">Instant zakazivanje</Badge>}
                </div>

                 <div>
                  <div className="flex flex-wrap items-baseline gap-4 mb-4">
                    <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif font-bold flex items-center gap-2">
                      {salonData.name}
                       {salonData.isVerified && <Badge className="gap-1.5 bg-primary/10 px-2.5 py-1 text-sm text-primary hover:bg-primary/15"><ShieldCheck className="h-4 w-4" />Verifikovan</Badge>}
                    </h1>
                  </div>
                   {user?.role === "CUSTOMER" && (
                     <SalonFavoriteButton salonId={salonData.id} className="absolute right-4 top-4 md:static md:ml-auto" />
                   )}

                  <button
                    type="button"
                    onClick={() => {
                      const reviews = document.getElementById("reviews");
                      if (!reviews) return;
                      window.scrollTo({ top: Math.max(0, reviews.getBoundingClientRect().top + window.scrollY - 88), behavior: "auto" });
                    }}
                    className="flex items-center gap-2 text-lg font-medium hover:text-primary transition-colors group mb-2"
                  >
                    <div className="flex items-center">
                      <Star className="w-6 h-6 fill-accent text-accent" />
                      <span className="ml-1.5 text-xl font-bold">{salonData.rating.toFixed(1)}</span>
                    </div>
                    <span className="text-muted-foreground text-base group-hover:underline decoration-dotted underline-offset-4">
                      ({salonData.reviewCount} recenzija)
                    </span>
                  </button>
                   {salonData.returnClientRate !== null && (
                     <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800">
                       <Heart className="h-4 w-4 fill-emerald-600 text-emerald-600" />
                       {salonData.returnClientRate}% klijenata se vraća
                     </div>
                   )}
                </div>

                <p className="text-muted-foreground text-lg leading-relaxed max-w-xl">
                  {salonData.description}
                </p>

                <div className="flex flex-col gap-3 pt-6 border-t">
                  <div className="flex items-center gap-4 text-foreground font-medium">
                    <div className="w-10 h-10 rounded-full bg-primary/5 flex items-center justify-center shrink-0">
                      <MapPin className="w-5 h-5 text-primary" />
                    </div>
                    <span>{salonData.address}, {salonData.city}</span>
                  </div>
                  <div className="flex items-center gap-4 text-foreground font-medium">
                    <div className="w-10 h-10 rounded-full bg-primary/5 flex items-center justify-center shrink-0">
                      <Phone className="w-5 h-5 text-primary" />
                    </div>
                    <span>{salonData.phone}</span>
                  </div>
                  <div className="flex items-center gap-4 text-foreground font-medium">
                    <div className="w-10 h-10 rounded-full bg-primary/5 flex items-center justify-center shrink-0">
                      <Mail className="w-5 h-5 text-primary" />
                    </div>
                    <span>{salonData.email}</span>
                  </div>
                </div>
             </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 md:py-12 flex flex-col lg:flex-row gap-8 lg:gap-12 relative">
        
        {/* Left Column: Services & Staff */}
        <div className="flex-1 space-y-16">
          
           {salonData.topServices.length > 0 && (
            <section id="popular-services">
              <h2 className="text-2xl font-serif font-bold mb-6 flex items-center gap-2">
                <span className="w-8 h-px bg-primary inline-block"></span>
                <Flame className="w-5 h-5 text-primary" />
                Popularne usluge
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {salonData.topServices.map(service => (
                   <Card key={service.id} className="group hover:border-primary/50 transition-colors flex flex-col shadow-sm hover:shadow-md">
                     <CardContent className="p-5 flex-1 flex flex-col">
                       <div className="flex justify-between items-start mb-3">
                         <h3 className="font-bold text-lg group-hover:text-primary transition-colors pr-2 leading-tight">{service.name}</h3>
                         <Badge variant="secondary" className="bg-primary/5 text-primary border-none shrink-0">
                           {service.bookingCount}+ zakazivanja
                         </Badge>
                       </div>
                       <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{service.description}</p>
                       <div className="flex items-center gap-4 text-sm font-medium mt-auto bg-muted/30 p-2.5 rounded-lg">
                         <span className="flex items-center gap-1.5 text-muted-foreground"><Clock className="w-4 h-4" /> {service.durationMinutes} min</span>
                         <span className="text-foreground ml-auto">
                           {service.promoPrice ? (
                             <div className="flex items-center gap-2">
                               <span className="line-through text-muted-foreground text-xs">{service.price} RSD</span>
                               <span className="text-primary font-bold text-base">{service.promoPrice} RSD</span>
                             </div>
                           ) : <span className="font-bold">{service.price} RSD</span>}
                         </span>
                       </div>
                     </CardContent>
                     <CardFooter className="p-5 pt-0 mt-auto">
                       <Button
                         variant="outline"
                         className="w-full group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-all font-semibold"
                         onClick={() => handleSelectService(service.id)}
                       >
                         Zakaži odmah
                       </Button>
                     </CardFooter>
                   </Card>
                 ))}
              </div>
            </section>
          )}

          <section id="services">
            <h2 className="text-2xl font-serif font-bold mb-6 flex items-center gap-2">
              <span className="w-8 h-px bg-primary inline-block"></span>
              Sve usluge
            </h2>
            <div className="space-y-4">
              {salonData.services?.map(service => (
                <div 
                  key={service.id} 
                  className={`p-5 rounded-xl border transition-all cursor-pointer flex justify-between items-center ${selectedService === service.id ? 'border-primary ring-1 ring-primary shadow-sm bg-primary/5' : 'hover:border-primary/50 hover:bg-muted/10 bg-card'}`}
                   onClick={() => handleSelectService(service.id)}
                >
                  <div className="pr-4">
                    <h4 className="font-bold text-lg">{service.name}</h4>
                    <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed">{service.description}</p>
                    <div className="flex items-center gap-4 mt-3 text-sm font-medium">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><Clock className="w-4 h-4" /> {service.durationMinutes} min</span>
                       <span className="text-foreground">{service.promoPrice ? <><span className="line-through text-muted-foreground mr-2">{service.price} RSD</span><span className="text-primary font-bold">{service.promoPrice} RSD</span></> : <span className="font-semibold">{service.price} RSD</span>}</span>
                    </div>
                    {service.tags?.length ? <div className="mt-3 flex flex-wrap gap-1.5">{service.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-[10px] uppercase font-bold tracking-wider">{tag}</Badge>)}</div> : null}
                    {service.packageTreatments ? <p className="mt-2 text-xs font-medium text-primary bg-primary/10 inline-block px-2 py-1 rounded-md">Paket od {service.packageTreatments} tretmana</p> : null}
                  </div>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${selectedService === service.id ? 'border-primary bg-primary' : 'border-muted-foreground/30'}`}>
                    {selectedService === service.id && <Check className="w-4 h-4 text-primary-foreground" />}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section id="hours">
            <h2 className="text-2xl font-serif font-bold mb-6 flex items-center gap-2"><span className="w-8 h-px bg-primary inline-block"></span>Radno vreme</h2>
            <div className="grid sm:grid-cols-2 gap-3">{salonData.hours.map((hour) => <div key={hour.day} className="rounded-xl border bg-card px-5 py-3.5 flex justify-between items-center text-sm"><span className="font-medium text-foreground">{hour.day}</span><span className={`font-semibold ${hour.closed ? "text-muted-foreground" : "text-primary"}`}>{hour.closed ? "Ne radi" : `${hour.open} – ${hour.close}`}</span></div>)}</div>
          </section>
          
          <section id="staff">
            <h2 className="text-2xl font-serif font-bold mb-6 flex items-center gap-2">
              <span className="w-8 h-px bg-primary inline-block"></span>
              Naš tim
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {eligibleStaff.map(employee => (
                <div 
                  key={employee.id} 
                  className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center gap-4 bg-card ${selectedEmployee === employee.id ? 'border-primary ring-1 ring-primary bg-primary/5 shadow-sm' : 'hover:border-primary/50'}`}
                  onClick={() => setSelectedEmployee(selectedEmployee === employee.id ? null : employee.id)}
                >
                  <img src={employee.avatarUrl || "https://i.pravatar.cc/150"} alt={employee.name} className="w-16 h-16 rounded-full object-cover border-2 border-background shadow-sm" />
                   <div className="min-w-0 flex-1">
                    <h4 className="font-bold">{employee.name}</h4>
                    <p className="text-sm text-muted-foreground">{employee.role}</p>
                     {employee.specialties?.length ? <p className="mt-1.5 text-xs text-muted-foreground truncate">{employee.specialties.join(" · ")}</p> : null}
                     {employee.serviceNames?.length ? <p className="mt-1 text-xs text-primary truncate">{employee.serviceNames.join(", ")}</p> : null}
                  </div>
                   {user?.role === "CUSTOMER" && <button className="p-2 hover:bg-muted rounded-full transition-colors" aria-label={`Omiljeni zaposleni ${employee.name}`} onClick={(event) => { event.stopPropagation(); setFavorite(employee.id).catch(() => toast.error("Omiljeni zaposleni nije sačuvan.")); }}><Heart className={`h-5 w-5 transition-colors ${favoriteEmployeeId === employee.id ? "fill-primary text-primary" : "text-muted-foreground"}`} /></button>}
                </div>
              ))}
            </div>
          </section>

          <section id="reviews">
             <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
               <h2 className="text-2xl font-serif font-bold flex items-center gap-2">
                 <span className="w-8 h-px bg-primary inline-block"></span>
                 Recenzije
               </h2>
               {user?.role === "CUSTOMER" && !isLoadingReviewContext && (reviewContext?.review || reviewContext?.eligibleServices.length) ? (
                 <Button variant={reviewContext.review ? "outline" : "default"} size="sm" onClick={openReviewDialog}>
                   <Star className="mr-2 h-4 w-4" />
                   {reviewContext.review ? "Izmeni recenziju" : "Ostavite recenziju"}
                 </Button>
               ) : null}
             </div>
             <div className="space-y-4">
              {salonData.reviews?.map(review => (
                <div key={review.id} className="p-6 rounded-xl border bg-card shadow-sm">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      {review.avatarUrl ? (
                        <img src={review.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover shadow-sm" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center font-bold text-sm">
                          {review.authorName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <span className="font-bold text-sm block">{review.authorName}</span>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{format(parseISO(review.date), 'dd.MM.yyyy')}</span>
                          {review.verifiedBooking && <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />Proverena poseta</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 bg-muted/50 px-2 py-1 rounded-md">
                      {Array(5).fill(0).map((_, i) => (
                        <Star key={i} className={`w-3.5 h-3.5 ${i < review.rating ? 'fill-accent text-accent' : 'text-muted'}`} />
                      ))}
                    </div>
                  </div>
                  <p className="text-foreground/90 text-sm mb-3 leading-relaxed">"{review.text}"</p>
                  <div className="text-xs text-primary font-medium inline-block bg-primary/5 px-2 py-1 rounded-md">
                    Usluga: {review.serviceName}
                  </div>
                </div>
              ))}
              {(!salonData.reviews || salonData.reviews.length === 0) && (
                <div className="p-8 text-center border rounded-xl bg-muted/20 text-muted-foreground">
                  Još uvek nema recenzija za ovaj salon.
                </div>
              )}
            </div>
          </section>

          <section id="location">
            <h2 className="text-2xl font-serif font-bold mb-6 flex items-center gap-2">
              <span className="w-8 h-px bg-primary inline-block"></span>
              Lokacija
            </h2>
            {salonData.latitude !== null && salonData.longitude !== null ? (
              <div className="h-[350px] overflow-hidden rounded-2xl border shadow-sm md:h-[400px]">
                <SimpleMap markers={[{
                  id: salonData.id,
                  latitude: salonData.latitude,
                  longitude: salonData.longitude,
                  label: salonData.name,
                  active: true,
                }]} />
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed bg-muted/20 p-8 text-center text-muted-foreground">
                Salon još nije dodao tačnu lokaciju na mapi.
              </div>
            )}
          </section>

        </div>

        {/* Right Column: Booking Widget */}
        <aside className="hidden lg:block w-[400px] shrink-0" id="booking-widget">
          <BookingWidget
            salon={salonData}
            user={user}
            eligibleStaff={eligibleStaff}
            selectedService={selectedService}
            setSelectedService={handleSelectService}
            selectedEmployee={selectedEmployee}
            setSelectedEmployee={setSelectedEmployee}
            favoriteEmployeeId={favoriteEmployeeId}
            setFavorite={setFavorite}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            selectedSlot={selectedSlot}
            setSelectedSlot={setSelectedSlot}
            availability={availability}
            isLoadingAvailability={isLoadingAvailability}
            onBook={handleBook}
            isBooking={createAppointment.isPending}
            isSuccess={isSuccess}
            onViewAppointments={() => setLocation("/moj-nalog")}
            step={bookingStep}
            setStep={setBookingStep}
            hasInteractedWithEmployee={hasInteractedWithEmployee}
            setHasInteractedWithEmployee={setHasInteractedWithEmployee}
            className="sticky top-24 h-[calc(100vh-120px)] shadow-2xl border border-primary/10 rounded-2xl"
          />
        </aside>

      </div>

      <Dialog open={isReviewDialogOpen} onOpenChange={setIsReviewDialogOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-h-[85dvh] p-4 sm:max-w-lg sm:p-6">
          <DialogHeader>
            <DialogTitle>{reviewContext?.review ? "Izmenite recenziju" : "Podelite svoje iskustvo"}</DialogTitle>
            <DialogDescription>Recenziju mogu ostaviti samo klijenti sa završenim terminom u ovom salonu.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="review-service">Usluga</Label>
              <Select value={reviewServiceName} onValueChange={setReviewServiceName}>
                <SelectTrigger id="review-service"><SelectValue placeholder="Izaberite uslugu" /></SelectTrigger>
                <SelectContent>
                  {reviewServiceOptions.map((service) => <SelectItem key={service} value={service}>{service}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Ocena</Label>
              <div className="flex gap-1" aria-label={`Ocena: ${reviewRating} od 5`}>
                {Array.from({ length: 5 }, (_, index) => {
                  const rating = index + 1;
                  return (
                    <button key={rating} type="button" onClick={() => setReviewRating(rating)} className="rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${rating} od 5 zvezdica`}>
                      <Star className={`h-7 w-7 ${rating <= reviewRating ? "fill-accent text-accent" : "text-muted"}`} />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="review-text">Vaša recenzija</Label>
              <Textarea id="review-text" value={reviewText} onChange={(event) => setReviewText(event.target.value)} maxLength={1000} rows={5} placeholder="Kako je protekla vaša poseta?" />
              <p className="text-right text-xs text-muted-foreground">{reviewText.length}/1000</p>
            </div>
            <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
              <Checkbox id="review-photo-consent" checked={showProfilePhoto} onCheckedChange={(checked) => setShowProfilePhoto(checked === true)} />
              <div className="space-y-1">
                <Label htmlFor="review-photo-consent" className="cursor-pointer">Prikaži moju profilnu fotografiju uz recenziju</Label>
                <p className="text-sm text-muted-foreground">Podrazumevano je skrivena. Ako ne označite ovu opciju, javno će se prikazivati samo vaši inicijali.</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            {reviewContext?.review ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button className="w-full sm:w-auto" variant="destructive" disabled={upsertReview.isPending || deleteCustomerSalonReview.isPending}>Obriši recenziju</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Obrisati recenziju?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Ova radnja trajno uklanja vašu recenziju i javno prikazanu profilnu fotografiju uz nju.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleteCustomerSalonReview.isPending}>Zadrži recenziju</AlertDialogCancel>
                    <AlertDialogAction asChild>
                      <Button variant="destructive" onClick={deleteReview} disabled={deleteCustomerSalonReview.isPending}>
                        {deleteCustomerSalonReview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Obriši recenziju
                      </Button>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            <Button className="w-full sm:w-auto" variant="outline" onClick={() => setIsReviewDialogOpen(false)} disabled={upsertReview.isPending || deleteCustomerSalonReview.isPending}>Otkaži</Button>
            <Button className="w-full sm:w-auto" onClick={saveReview} disabled={upsertReview.isPending || deleteCustomerSalonReview.isPending || !reviewServiceName || !reviewText.trim()}>
              {upsertReview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sačuvaj recenziju
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mobile Sticky Bar & Drawer */}
      <div className="lg:hidden">
        <MobileBookingTrigger
          salon={salonData}
          selectedService={selectedService}
          selectedSlot={selectedSlot}
          onOpen={() => setIsMobileDrawerOpen(true)}
        />
        <MobileBookingDrawer isOpen={isMobileDrawerOpen} onClose={() => setIsMobileDrawerOpen(false)}>
          <BookingWidget
            salon={salonData}
            user={user}
            eligibleStaff={eligibleStaff}
            selectedService={selectedService}
            setSelectedService={handleSelectService}
            selectedEmployee={selectedEmployee}
            setSelectedEmployee={setSelectedEmployee}
            favoriteEmployeeId={favoriteEmployeeId}
            setFavorite={setFavorite}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            selectedSlot={selectedSlot}
            setSelectedSlot={setSelectedSlot}
            availability={availability}
            isLoadingAvailability={isLoadingAvailability}
            onBook={handleBook}
            isBooking={createAppointment.isPending}
            isSuccess={isSuccess}
            onViewAppointments={() => setLocation("/moj-nalog")}
            step={bookingStep}
            setStep={setBookingStep}
            hasInteractedWithEmployee={hasInteractedWithEmployee}
            setHasInteractedWithEmployee={setHasInteractedWithEmployee}
            className="h-full rounded-none border-0 shadow-none bg-background"
          />
        </MobileBookingDrawer>
      </div>
    </Layout>
  );
}
