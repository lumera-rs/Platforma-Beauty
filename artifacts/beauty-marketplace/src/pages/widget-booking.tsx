import { useState, useMemo } from "react";
import { useParams, useSearch } from "wouter";
import {
  useGetWidgetSalon,
  useGetWidgetAvailability,
  useCreateWidgetAppointment,
  getGetWidgetSalonQueryKey,
  getGetWidgetAvailabilityQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format, addDays, isSameDay, parseISO, startOfToday } from "date-fns";
import { srLatn } from "date-fns/locale";
import { Loader2, Calendar, Clock, User, ChevronRight, ChevronLeft, MapPin, CheckCircle2, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

// Step Enum
type Step = "SERVICE" | "EMPLOYEE" | "DATETIME" | "CONTACT" | "SUCCESS";

export default function WidgetBooking() {
  const { slug } = useParams<{ slug: string }>();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const boja = searchParams.get("boja");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: salon, isLoading: isLoadingSalon, isError: isErrorSalon, error: salonError } = useGetWidgetSalon(
    slug ?? "", 
    { query: { enabled: !!slug, queryKey: getGetWidgetSalonQueryKey(slug ?? "") } }
  );

  // State
  const [step, setStep] = useState<Step>("SERVICE");
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null); // null means "Bilo ko" (Any)
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [startTime, setStartTime] = useState<string | null>(null);
  const [finalSlotEmployeeId, setFinalSlotEmployeeId] = useState<string | null>(null);
  
  const [contact, setContact] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    note: ""
  });

  const createMutation = useCreateWidgetAppointment({
    mutation: {
      onSuccess: () => {
        setStep("SUCCESS");
        // Invalidate slots to ensure next user sees fresh data
        queryClient.invalidateQueries({ queryKey: getGetWidgetAvailabilityQueryKey(slug ?? "", { serviceId: serviceId!, date: format(selectedDate, 'yyyy-MM-dd') }) });
      },
      onError: (err: any) => {
        const status = err?.response?.status;
        if (status === 409) {
          toast.error("Termin je upravo zauzet", { description: "Molimo izaberite drugo vreme." });
          queryClient.invalidateQueries({ queryKey: getGetWidgetAvailabilityQueryKey(slug ?? "", { serviceId: serviceId!, date: format(selectedDate, 'yyyy-MM-dd') }) });
          setStep("DATETIME");
          setStartTime(null);
        } else if (status === 429) {
          toast.error("Previše zahteva", { description: "Pokušajte ponovo za koji minut." });
        } else {
          toast.error("Greška", { description: "Nije moguće zakazati termin. Pokušajte ponovo." });
        }
      }
    }
  });

  // Derived state
  const selectedService = useMemo(() => salon?.services.find(s => s.id === serviceId), [salon, serviceId]);
  const availableEmployees = useMemo(() => {
    if (!salon || !serviceId) return [];
    return salon.employees.filter(e => e.serviceIds.includes(serviceId));
  }, [salon, serviceId]);

  // Availability Query
  const dateStr = format(selectedDate, 'yyyy-MM-dd');
  const { data: slots, isLoading: isLoadingSlots } = useGetWidgetAvailability(
    slug ?? "",
    { serviceId: serviceId!, date: dateStr, employeeId: employeeId || undefined },
    { 
      query: { 
        enabled: !!slug && !!serviceId && step === "DATETIME", 
        queryKey: getGetWidgetAvailabilityQueryKey(slug ?? "", { serviceId: serviceId!, date: dateStr, employeeId: employeeId || undefined }) 
      } 
    }
  );

  // Group services by category
  const servicesByCategory = useMemo(() => {
    if (!salon) return {};
    return salon.services.reduce((acc, service) => {
      const cat = service.categoryName || "Ostalo";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(service);
      return acc;
    }, {} as Record<string, typeof salon.services>);
  }, [salon]);

  // Generate 7 days for the date picker
  const upcomingDays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => addDays(startOfToday(), i));
  }, []);

  // Handlers
  const handleServiceSelect = (id: string) => {
    setServiceId(id);
    setEmployeeId(null);
    setStartTime(null);
    setStep("EMPLOYEE");
  };

  const handleEmployeeSelect = (id: string | null) => {
    setEmployeeId(id);
    setStartTime(null);
    setStep("DATETIME");
  };

  const handleSlotSelect = (time: string, empId: string) => {
    setStartTime(time);
    setFinalSlotEmployeeId(empId);
    setStep("CONTACT");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || !serviceId || !startTime) return;
    createMutation.mutate({
      slug,
      data: {
        serviceId,
        employeeId: finalSlotEmployeeId || employeeId || null,
        date: format(selectedDate, 'yyyy-MM-dd'),
        startTime,
        firstName: contact.firstName.trim(),
        lastName: contact.lastName.trim(),
        phone: contact.phone.trim(),
        email: contact.email.trim() || null,
        note: contact.note.trim() || null
      }
    });
  };

  const resetFlow = () => {
    setStep("SERVICE");
    setServiceId(null);
    setEmployeeId(null);
    setStartTime(null);
    setContact({ firstName: "", lastName: "", phone: "", email: "", note: "" });
  };

  // Convert hex to HSL for CSS variable
  const cssVars = useMemo(() => {
    if (!boja) return {};
    let hex = boja.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
    if (hex.length !== 6) return {};
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { 
      '--primary': `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`,
      '--ring': `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
    } as React.CSSProperties;
  }, [boja]);

  if (isErrorSalon) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background p-4 text-center" style={cssVars}>
        <AlertCircle className="mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="mb-2 text-xl font-semibold">Salon nije pronađen</h2>
        <p className="text-sm text-muted-foreground">Proverite da li je link ispravan.</p>
      </div>
    );
  }

  if (isLoadingSalon || !salon) {
    return (
      <div className="flex h-screen flex-col bg-background p-4" style={cssVars}>
        <Skeleton className="mb-6 h-8 w-3/4" />
        <Skeleton className="mb-4 h-24 w-full" />
        <Skeleton className="mb-4 h-24 w-full" />
        <Skeleton className="mb-4 h-24 w-full" />
      </div>
    );
  }

  return (
    <div 
      className="flex h-[100dvh] w-full flex-col bg-background text-foreground antialiased selection:bg-primary/20 overflow-hidden" 
      style={cssVars}
      data-testid="page-widget-booking"
    >
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b bg-card/50 px-4 py-3 backdrop-blur-md">
        <div className="flex flex-col">
          <span className="text-sm font-medium tracking-tight truncate">{salon.name}</span>
          <span className="flex items-center text-[11px] text-muted-foreground"><MapPin className="mr-1 h-3 w-3" />{salon.city}</span>
        </div>
        {step !== "SERVICE" && step !== "SUCCESS" && (
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => {
            if (step === "EMPLOYEE") setStep("SERVICE");
            if (step === "DATETIME") setStep("EMPLOYEE");
            if (step === "CONTACT") setStep("DATETIME");
          }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
      </header>

      {/* Progress */}
      {step !== "SUCCESS" && (
        <div className="h-1 w-full bg-muted">
          <div 
            className="h-full bg-primary transition-all duration-300 ease-out" 
            style={{ width: `${step === 'SERVICE' ? 25 : step === 'EMPLOYEE' ? 50 : step === 'DATETIME' ? 75 : 100}%` }} 
          />
        </div>
      )}

      {/* Body */}
      <ScrollArea className="flex-1 bg-muted/10 px-4 py-4">
        <div className="mx-auto w-full max-w-md pb-8">
          
          {/* STEP 1: SERVICE */}
          {step === "SERVICE" && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h2 className="mb-4 text-lg font-serif font-bold">Izaberite uslugu</h2>
              <div className="space-y-6">
                {Object.entries(servicesByCategory).map(([category, services]) => (
                  <div key={category}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category}</h3>
                    <div className="space-y-2">
                      {services.map(svc => (
                        <Card 
                          key={svc.id} 
                          className="cursor-pointer transition-colors hover:border-primary/50" 
                          onClick={() => handleServiceSelect(svc.id)}
                          data-testid={`service-select-${svc.id}`}
                        >
                          <CardContent className="flex items-center justify-between p-3">
                            <div className="flex flex-col">
                              <span className="font-medium">{svc.name}</span>
                              <span className="text-xs text-muted-foreground">{svc.durationMinutes} min</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col items-end">
                                {svc.promoPrice ? (
                                  <>
                                    <span className="text-xs text-muted-foreground line-through">{svc.price} RSD</span>
                                    <span className="font-semibold text-primary">{svc.promoPrice} RSD</span>
                                  </>
                                ) : (
                                  <span className="font-semibold">{svc.price} RSD</span>
                                )}
                              </div>
                              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-50" />
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2: EMPLOYEE */}
          {step === "EMPLOYEE" && selectedService && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="mb-6 rounded-lg bg-card p-3 shadow-sm border">
                <span className="block text-[10px] uppercase text-muted-foreground">Odabrana usluga</span>
                <span className="font-medium">{selectedService.name}</span>
              </div>
              <h2 className="mb-4 text-lg font-serif font-bold">Izaberite zaposlenog</h2>
              <div className="space-y-2">
                <Card 
                  className="cursor-pointer transition-colors hover:border-primary/50" 
                  onClick={() => handleEmployeeSelect(null)}
                  data-testid="employee-select-any"
                >
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <User className="h-5 w-5" />
                      </div>
                      <span className="font-medium">Bilo ko</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-50" />
                  </CardContent>
                </Card>
                {availableEmployees.map(emp => (
                  <Card 
                    key={emp.id} 
                    className="cursor-pointer transition-colors hover:border-primary/50" 
                    onClick={() => handleEmployeeSelect(emp.id)}
                    data-testid={`employee-select-${emp.id}`}
                  >
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          {emp.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-medium">{emp.name}</span>
                          {emp.role && <span className="text-xs text-muted-foreground">{emp.role}</span>}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-50" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* STEP 3: DATETIME */}
          {step === "DATETIME" && selectedService && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h2 className="mb-4 text-lg font-serif font-bold">Kada želite termin?</h2>
              
              {/* Date strip */}
              <div className="mb-6 -mx-4 flex overflow-x-auto px-4 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex gap-2">
                  {upcomingDays.map(date => {
                    const isSelected = isSameDay(date, selectedDate);
                    return (
                      <button
                        key={date.toISOString()}
                        onClick={() => setSelectedDate(date)}
                        className={`flex flex-col items-center justify-center rounded-xl border p-2 min-w-[4rem] transition-colors ${
                          isSelected 
                            ? 'bg-primary border-primary text-primary-foreground shadow-md' 
                            : 'bg-card hover:bg-muted'
                        }`}
                      >
                        <span className={`text-[10px] uppercase ${isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                          {format(date, 'eee', { locale: srLatn })}
                        </span>
                        <span className="text-lg font-bold">{format(date, 'd')}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Slots */}
              <div>
                <h3 className="mb-3 text-sm font-medium">Slobodni termini</h3>
                {isLoadingSlots ? (
                  <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                ) : !slots || slots.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-8 text-center bg-card">
                    <Calendar className="mx-auto mb-2 h-8 w-8 text-muted-foreground opacity-20" />
                    <p className="text-sm font-medium">Nema slobodnih termina</p>
                    <p className="text-xs text-muted-foreground mt-1">Izaberite drugi datum ili zaposlenog.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {slots.map((slot, idx) => (
                      <button
                        key={`${slot.start}-${slot.employeeId}-${idx}`}
                        onClick={() => handleSlotSelect(slot.start, slot.employeeId)}
                        data-testid={`slot-${slot.start}`}
                        className="rounded-lg border bg-card py-2 text-center text-sm font-medium transition-colors hover:border-primary hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                      >
                        {slot.start}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 4: CONTACT */}
          {step === "CONTACT" && selectedService && startTime && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="mb-6 rounded-lg bg-card p-4 shadow-sm border space-y-2">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-xs font-medium text-muted-foreground">Usluga</span>
                  <span className="text-sm font-semibold">{selectedService.name}</span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs font-medium text-muted-foreground">Vreme</span>
                  <span className="text-sm font-semibold text-primary flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> 
                    {format(selectedDate, 'dd. MM. yyyy.', { locale: srLatn })} u {startTime}
                  </span>
                </div>
              </div>

              <h2 className="mb-4 text-lg font-serif font-bold">Vaši podaci</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName" className="text-xs">Ime *</Label>
                    <Input id="firstName" required value={contact.firstName} onChange={e => setContact({...contact, firstName: e.target.value})} data-testid="input-firstname" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName" className="text-xs">Prezime *</Label>
                    <Input id="lastName" required value={contact.lastName} onChange={e => setContact({...contact, lastName: e.target.value})} data-testid="input-lastname" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-xs">Telefon *</Label>
                  <Input id="phone" type="tel" required placeholder="06x xxx xxxx" value={contact.phone} onChange={e => setContact({...contact, phone: e.target.value})} data-testid="input-phone" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs">Email (opciono)</Label>
                  <Input id="email" type="email" value={contact.email} onChange={e => setContact({...contact, email: e.target.value})} data-testid="input-email" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="note" className="text-xs">Napomena (opciono)</Label>
                  <Input id="note" value={contact.note} onChange={e => setContact({...contact, note: e.target.value})} data-testid="input-note" />
                </div>

                <div className="pt-2">
                  <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={createMutation.isPending} data-testid="button-submit">
                    {createMutation.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Potvrdi zakazivanje"}
                  </Button>
                </div>
                <p className="text-center text-[11px] text-muted-foreground px-4">
                  Ovo je zahtev za zakazivanje. Salon će ga ubrzo potvrditi.
                </p>
              </form>
            </div>
          )}

          {/* STEP 5: SUCCESS */}
          {step === "SUCCESS" && (
            <div className="flex flex-col items-center justify-center text-center animate-in zoom-in-95 duration-500 py-8">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-10 w-10" />
              </div>
              <h2 className="mb-2 text-2xl font-serif font-bold text-foreground">Zahtev je poslat!</h2>
              <p className="mb-8 text-muted-foreground text-sm max-w-[280px]">
                Vaš termin je u obradi. Dobićete potvrdu od salona <strong>{salon.name}</strong> u najkraćem roku.
              </p>
              <Button onClick={resetFlow} variant="outline" className="w-full font-medium" data-testid="button-reset">
                Zakaži još jedan termin
              </Button>
            </div>
          )}

        </div>
      </ScrollArea>
    </div>
  );
}
