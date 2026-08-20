import { BookingWidget, MobileBookingTrigger, MobileBookingDrawer } from "@/components/booking-widget";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useGetSalon, useGetSalonAvailability, useCreateAppointment, useGetCurrentUser, getGetSalonAvailabilityQueryKey } from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { MapPin, Star, Clock, Phone, Mail, Check, CalendarDays, Loader2, Heart, ShieldCheck, Flame, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { format, isValid, parseISO } from "date-fns";
import { SalonGallery, MediaItem } from "@/components/salon-gallery";
import { SimpleMap } from "@/components/simple-map";

export default function SalonProfile() {
  const { slug } = useParams();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: salon, isLoading } = useGetSalon(slug || "");
  const { data: userResp } = useGetCurrentUser();
  const user = userResp?.user;

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
  
  const dateStr = format(selectedDate, 'yyyy-MM-dd');
  
  const { data: availability, isLoading: isLoadingAvailability } = useGetSalonAvailability(
    salonData?.id || "",
    { serviceId: selectedService || "", date: dateStr, employeeId: selectedEmployee || undefined },
    { query: { enabled: !!salonData?.id && !!selectedService, queryKey: getGetSalonAvailabilityQueryKey(salonData?.id || "", { serviceId: selectedService || "", date: dateStr, employeeId: selectedEmployee || undefined }) } }
  );

  const createAppointment = useCreateAppointment();
  const eligibleStaff = useMemo(() => selectedService ? salonData?.staff.filter((employee) => employee.serviceIds.includes(selectedService)) ?? [] : salonData?.staff ?? [], [salonData?.staff, selectedService]);

  useEffect(() => {
    if (!salonData?.id || user?.role !== "CUSTOMER") return;
    fetch(`/api/customer/favorite-employees/${salonData.id}`, { credentials: "include" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setFavoriteEmployeeId(data?.employeeId ?? null))
      .catch(() => setFavoriteEmployeeId(null));
  }, [salonData?.id, user?.role]);

  useEffect(() => {
    if (selectedEmployee && !eligibleStaff.some((employee) => employee.id === selectedEmployee)) setSelectedEmployee(null);
    if (!selectedEmployee && favoriteEmployeeId && eligibleStaff.some((employee) => employee.id === favoriteEmployeeId)) setSelectedEmployee(favoriteEmployeeId);
  }, [eligibleStaff, favoriteEmployeeId, selectedEmployee]);

  useEffect(() => {
    if (selectedService && bookingStep === 1) setBookingStep(2);
  }, [selectedService]);

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
        <div className="container mx-auto px-4 py-12 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
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

             <div className="w-full lg:w-1/2 xl:w-[45%] flex flex-col justify-center space-y-6 pt-2 lg:pt-4">
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
            <h2 className="text-2xl font-serif font-bold mb-6 flex items-center gap-2">
              <span className="w-8 h-px bg-primary inline-block"></span>
              Recenzije
            </h2>
            <div className="space-y-4">
              {salonData.reviews?.map(review => (
                <div key={review.id} className="p-6 rounded-xl border bg-card shadow-sm">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                        {review.authorName[0]}
                      </div>
                      <div>
                        <span className="font-bold text-sm block">{review.authorName}</span>
                        <span className="text-xs text-muted-foreground">{format(parseISO(review.date), 'dd.MM.yyyy')}</span>
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
