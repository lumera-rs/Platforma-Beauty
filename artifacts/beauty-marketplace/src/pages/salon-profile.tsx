import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useGetSalon, useGetSalonAvailability, useCreateAppointment, useGetCurrentUser, getGetSalonAvailabilityQueryKey } from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { MapPin, Star, Clock, Phone, Mail, Check, CalendarDays, User as UserIcon, Loader2 } from "lucide-react";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { srLatn } from "date-fns/locale";

export default function SalonProfile() {
  const { slug } = useParams();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: salon, isLoading } = useGetSalon(slug || "");
  const { data: userResp } = useGetCurrentUser();
  const user = userResp?.user;
  
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{start: string, end: string, employeeId?: string|null} | null>(null);
  
  const dateStr = format(selectedDate, 'yyyy-MM-dd');
  
  const { data: availability, isLoading: isLoadingAvailability } = useGetSalonAvailability(
    salon?.id || "", 
    { serviceId: selectedService || "", date: dateStr, employeeId: selectedEmployee || undefined },
    { query: { enabled: !!salon?.id && !!selectedService, queryKey: getGetSalonAvailabilityQueryKey(salon?.id || "", { serviceId: selectedService || "", date: dateStr, employeeId: selectedEmployee || undefined }) } }
  );

  const createAppointment = useCreateAppointment();

  const handleBook = () => {
    if (!user) {
      toast.error("Prijava obavezna", { description: "Morate biti prijavljeni da biste zakazali termin." });
      setLocation("/prijava");
      return;
    }
    
    if (!salon || !selectedService || !selectedSlot) return;

    createAppointment.mutate({
      data: {
        salonId: salon.id,
        serviceId: selectedService,
        date: dateStr,
        startTime: selectedSlot.start,
        employeeId: selectedSlot.employeeId
      }
    }, {
      onSuccess: () => {
        toast.success("Uspešno!", { description: "Vaš termin je uspešno zakazan." });
        setLocation("/moj-nalog");
      },
      onError: () => {
        toast.error("Greška", { description: "Došlo je do greške prilikom zakazivanja." });
      }
    });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!salon) return <Layout><div className="p-12 text-center">Salon nije pronađen.</div></Layout>;

  return (
    <Layout>
      {/* Header / Gallery */}
      <div className="w-full bg-foreground text-background">
        <div className="container mx-auto px-4 py-12 md:py-16 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Badge className="bg-primary/20 text-primary border-none hover:bg-primary/30">Salon</Badge>
              {salon.featured && <Badge className="bg-white/15 text-white border-white/20">Istaknuto</Badge>}
              {salon.topSalon && <Badge className="bg-amber-300/20 text-amber-200 border-amber-200/20">Top Salon</Badge>}
              {salon.instantBooking && <Badge className="bg-emerald-300/20 text-emerald-100 border-emerald-200/20">Instant zakazivanje</Badge>}
              <div className="flex items-center gap-1 text-accent font-medium text-sm">
                <Star className="w-4 h-4 fill-current" /> {salon.rating.toFixed(1)} ({salon.reviewCount} recenzija)
              </div>
            </div>
            <h1 className="text-4xl md:text-6xl font-serif font-bold mb-4">{salon.name}</h1>
            <p className="text-background/80 text-lg mb-6 leading-relaxed max-w-xl">
              {salon.description}
            </p>
            <div className="flex flex-col gap-2 text-sm text-background/90 font-medium">
              <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" /> {salon.address}, {salon.city}</div>
              <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-primary" /> {salon.phone}</div>
              <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-primary" /> {salon.email}</div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2 h-[300px] md:h-[400px] rounded-2xl overflow-hidden">
            <img src={salon.imageUrl} alt={salon.name} className="w-full h-full object-cover" />
            <div className="grid grid-rows-2 gap-2">
              <img src={salon.gallery?.[0] || "https://images.unsplash.com/photo-1519014816548-bf5fe059c98b?q=80&w=800"} className="w-full h-full object-cover" />
              <img src={salon.gallery?.[1] || "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?q=80&w=800"} className="w-full h-full object-cover" />
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 flex flex-col lg:flex-row gap-8">
        
        {/* Left Column: Services & Staff */}
        <div className="flex-1 space-y-12">
          
          <section id="services">
            <h2 className="text-2xl font-serif font-bold mb-6 flex items-center gap-2">
              <span className="w-8 h-px bg-primary inline-block"></span>
              Usluge
            </h2>
            <div className="space-y-4">
              {salon.services?.map(service => (
                <div 
                  key={service.id} 
                  className={`p-4 rounded-xl border transition-all cursor-pointer flex justify-between items-center ${selectedService === service.id ? 'border-primary ring-1 ring-primary shadow-sm bg-primary/5' : 'hover:border-primary/50 hover:bg-muted/30'}`}
                  onClick={() => { setSelectedService(service.id); setSelectedSlot(null); }}
                >
                  <div>
                    <h4 className="font-bold text-lg">{service.name}</h4>
                    <p className="text-muted-foreground text-sm mt-1">{service.description}</p>
                    <div className="flex items-center gap-4 mt-3 text-sm font-medium">
                      <span className="flex items-center gap-1 text-muted-foreground"><Clock className="w-4 h-4" /> {service.durationMinutes} min</span>
                       <span className="text-foreground">{service.promoPrice ? <><span className="line-through text-muted-foreground mr-2">{service.price} RSD</span><span className="text-primary font-bold">{service.promoPrice} RSD</span></> : `${service.price} RSD`}</span>
                    </div>
                    {service.tags?.length ? <div className="mt-2 flex flex-wrap gap-1">{service.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>)}</div> : null}
                    {service.packageTreatments ? <p className="mt-2 text-xs font-medium text-primary">Paket od {service.packageTreatments} tretmana</p> : null}
                  </div>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${selectedService === service.id ? 'border-primary bg-primary' : 'border-muted-foreground/30'}`}>
                    {selectedService === service.id && <Check className="w-4 h-4 text-primary-foreground" />}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section id="hours">
            <h2 className="text-2xl font-serif font-bold mb-6 flex items-center gap-2"><span className="w-8 h-px bg-primary inline-block"></span>Radno vreme</h2>
            <div className="grid sm:grid-cols-2 gap-2">{salon.hours.map((hour) => <div key={hour.day} className="rounded-lg border px-4 py-3 flex justify-between text-sm"><span className="font-medium">{hour.day}</span><span className={hour.closed ? "text-muted-foreground" : "text-primary"}>{hour.closed ? "Ne radi" : `${hour.open} – ${hour.close}`}</span></div>)}</div>
          </section>
          
          <section id="staff">
            <h2 className="text-2xl font-serif font-bold mb-6 flex items-center gap-2">
              <span className="w-8 h-px bg-primary inline-block"></span>
              Naš tim
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {salon.staff?.map(employee => (
                <div 
                  key={employee.id} 
                  className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center gap-4 ${selectedEmployee === employee.id ? 'border-primary ring-1 ring-primary bg-primary/5' : 'hover:border-primary/50'}`}
                  onClick={() => setSelectedEmployee(selectedEmployee === employee.id ? null : employee.id)}
                >
                  <img src={employee.avatarUrl || "https://i.pravatar.cc/150"} alt={employee.name} className="w-16 h-16 rounded-full object-cover border" />
                  <div>
                    <h4 className="font-bold">{employee.name}</h4>
                    <p className="text-sm text-muted-foreground">{employee.role}</p>
                  </div>
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
              {salon.reviews?.map(review => (
                <div key={review.id} className="p-5 rounded-xl border bg-card">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                        {review.authorName[0]}
                      </div>
                      <span className="font-medium text-sm">{review.authorName}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {Array(5).fill(0).map((_, i) => (
                        <Star key={i} className={`w-3.5 h-3.5 ${i < review.rating ? 'fill-accent text-accent' : 'text-muted'}`} />
                      ))}
                    </div>
                  </div>
                  <p className="text-foreground/80 text-sm mb-2 italic">"{review.text}"</p>
                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <span>{review.serviceName}</span>
                    <span>{format(parseISO(review.date), 'dd.MM.yyyy')}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>

        {/* Right Column: Booking Widget */}
        <aside className="w-full lg:w-[400px] shrink-0">
          <div className="sticky top-24">
            <Card className="border-primary/20 shadow-lg">
              <CardHeader className="bg-primary/5 border-b pb-4 rounded-t-xl">
                <CardTitle className="font-serif text-xl flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-primary" />
                  Zakažite termin
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                
                {!selectedService ? (
                  <div className="text-center py-8 text-muted-foreground flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                      <Check className="w-6 h-6 text-muted-foreground/50" />
                    </div>
                    <p>Prvo izaberite uslugu sa liste</p>
                  </div>
                ) : (
                  <>
                    <div className="bg-secondary/30 p-3 rounded-lg border border-secondary text-sm">
                      <div className="font-bold">{salon.services.find(s => s.id === selectedService)?.name}</div>
                      <div className="text-muted-foreground mt-1 flex justify-between">
                        <span>{salon.services.find(s => s.id === selectedService)?.durationMinutes} min</span>
                        <span className="font-medium text-foreground">{salon.services.find(s => s.id === selectedService)?.price} RSD</span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold">Izaberite datum</h4>
                      <input 
                        type="date" 
                        value={dateStr}
                        min={format(new Date(), 'yyyy-MM-dd')}
                        onChange={(e) => { setSelectedDate(new Date(e.target.value)); setSelectedSlot(null); }}
                        className="w-full border rounded-md p-2 text-sm bg-background"
                      />
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        Slobodni termini {isLoadingAvailability && <Loader2 className="w-3 h-3 animate-spin" />}
                      </h4>
                      
                      {!isLoadingAvailability && (!availability || availability.length === 0) ? (
                        <div className="text-sm text-red-500 bg-red-50 p-3 rounded-md">
                          Nema slobodnih termina za ovaj datum.
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-2 max-h-[200px] overflow-y-auto pr-2 pb-2">
                          {availability?.map((slot, i) => (
                            <button
                              key={i}
                              onClick={() => setSelectedSlot(slot)}
                              className={`py-2 px-1 text-sm rounded-md border font-medium transition-all ${
                                selectedSlot?.start === slot.start && selectedSlot?.employeeId === slot.employeeId
                                  ? 'bg-primary text-primary-foreground border-primary' 
                                  : 'hover:border-primary/50'
                              }`}
                            >
                              {slot.start}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

              </CardContent>
              <CardFooter className="p-6 pt-0 border-t bg-muted/10 rounded-b-xl flex-col items-stretch gap-3">
                {selectedSlot && (
                  <div className="text-sm bg-primary/10 p-3 rounded-md mb-2">
                    Termin: <span className="font-bold">{format(selectedDate, 'dd.MM.yyyy')}</span> u <span className="font-bold">{selectedSlot.start}</span>
                  </div>
                )}
                <Button 
                  className="w-full h-12 text-base shadow-sm" 
                  disabled={!selectedService || !selectedSlot || createAppointment.isPending}
                  onClick={handleBook}
                >
                  {createAppointment.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Potvrdi rezervaciju
                </Button>
              </CardFooter>
            </Card>
          </div>
        </aside>

      </div>
    </Layout>
  );
}
