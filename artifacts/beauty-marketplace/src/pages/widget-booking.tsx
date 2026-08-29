import { useRef, useState } from "react";
import { useParams, useSearch } from "wouter";
import {
  useGetWidgetSalon,
  useCreateWidgetBookingGroup,
  useGetGroupedBookingAvailability,
  getGetWidgetSalonQueryKey,
  getApiErrorDetails,
  type GroupedTreatmentRequest,
  type GroupedAvailabilityCandidate,
  type Appointment
} from "@workspace/api-client-react";
import { addDays, startOfToday } from "date-fns";
import { Loader2, Calendar, Clock, ChevronRight, ChevronLeft, CheckCircle2, AlertCircle, Plus, Trash2, Scissors } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateOnly, formatLocalDateOnly, parseLocalDateOnly } from "@/lib/date-only";
import { trackEvent } from "@/lib/analytics";
import { useAvailabilityViewMode } from "@/hooks/use-availability-view-mode";
import { GroupedAvailabilityView } from "@/components/booking/grouped-availability-view";

// Step Enum
type Step = "CART" | "EMPLOYEE" | "DATETIME" | "CONTACT" | "SUCCESS";

export default function WidgetBooking() {
  const { slug } = useParams<{ slug: string }>();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const boja = searchParams.get("boja");

  const { toast } = useToast();

  const {
    data: salon,
    isLoading: isLoadingSalon,
    isError: isErrorSalon,
    refetch: refetchSalon,
  } = useGetWidgetSalon(
    slug ?? "",
    { query: { enabled: !!slug, queryKey: getGetWidgetSalonQueryKey(slug ?? ""), retry: false } }
  );

  // State
  const [step, setStep] = useState<Step>("CART");
  const [cart, setCart] = useState<GroupedTreatmentRequest[]>([]);

  // We use a date range now
  const todayDate = formatLocalDateOnly(startOfToday())!;
  const [fromDate, setFromDate] = useState(todayDate);
  const [toDate, setToDate] = useState(todayDate);
  const [dateError, setDateError] = useState<string | null>(null);
  const [allowMultipleDays, setAllowMultipleDays] = useState(false);
  const [viewMode, setViewMode] = useAvailabilityViewMode();

  const [selectedCandidate, setSelectedCandidate] = useState<GroupedAvailabilityCandidate | null>(null);
  const [completedAppointments, setCompletedAppointments] = useState<Appointment[]>([]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const [contact, setContact] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    note: ""
  });

  const analyticsDimensions = () => ({
    treatment_count: cart.length,
    customer_type: "guest",
    day_choice: allowMultipleDays ? "multi_day" : "same_day",
    booking_surface: "booking_widget",
  });

  const createMutation = useCreateWidgetBookingGroup({
    mutation: {
      onSuccess: (data) => {
        setCompletedAppointments(data.appointments);
        setStep("SUCCESS");
        trackEvent("grouped_booking_completed", analyticsDimensions());
      },
      onError: (err: unknown) => {
        const { message } = getApiErrorDetails(err);
        toast.error("Greška pri zakazivanju", { description: message });
      }
    }
  });

  const availabilityMutation = useGetGroupedBookingAvailability();

  const [availabilityResponse, setAvailabilityResponse] = useState<any>(null);

  const latestRequestRef = useRef(0);

  const refetchAvailability = (mode = viewMode) => {
    const parsedFrom = parseLocalDateOnly(fromDate);
    const parsedTo = parseLocalDateOnly(toDate);
    const today = formatLocalDateOnly(startOfToday())!;
    const maximumTo = parsedFrom ? formatLocalDateOnly(addDays(parsedFrom, 13)) : null;
    if (!parsedFrom || !parsedTo) {
      setDateError("Unesite ispravne datume.");
      setAvailabilityResponse({ candidates: [] });
      setSelectedCandidate(null);
      return;
    }
    if (fromDate < today || toDate < fromDate || (maximumTo && toDate > maximumTo)) {
      setDateError("Izaberite period od danas, najduže 14 dana, bez obrnutog raspona.");
      setAvailabilityResponse({ candidates: [] });
      setSelectedCandidate(null);
      return;
    }
    setDateError(null);
    const currentId = ++latestRequestRef.current;
    availabilityMutation.mutate({
      salonId: salon?.id ?? "",
      data: {
        treatments: cart,
        fromDate,
        toDate,
        allowMultipleDays,
        resultMode: mode,
      }
    }, {
      onSuccess: (data) => {
        if (latestRequestRef.current !== currentId) return;
        setAvailabilityResponse(data);
        const hasCandidates = mode === "calendar"
          ? (data.calendarDays ?? []).some((d: any) => d.candidates.length > 0)
          : (data.candidates ?? []).length > 0;
        trackEvent("booking_availability_result", {
          ...analyticsDimensions(),
          result: hasCandidates ? "success" : "empty",
        });
      },
      onError: () => {
        if (latestRequestRef.current !== currentId) return;
        setAvailabilityResponse({ candidates: [] });
      },
    });
  };

  const handleViewModeChange = (mode: "list" | "calendar") => {
    if (mode === viewMode) return;
    setViewMode(mode);
    if (availabilityResponse) {
      setSelectedCandidate(null);
      refetchAvailability(mode);
    }
  };

  const isLoadingAvailability = availabilityMutation.isPending;
  const isFetchingAvailability = availabilityMutation.isPending;

  // Styling
  const customColor = boja ? `#${boja}` : undefined;
  const styleVars = customColor ? { "--primary": customColor, "--ring": customColor } as React.CSSProperties : {};

  // Helpers
  const resetFlow = () => {
    setStep("CART");
    setCart([]);
    setSelectedCandidate(null);
    setCompletedAppointments([]);
    setFromDate(todayDate);
    setToDate(todayDate);
    setDateError(null);
    setContact({ firstName: "", lastName: "", phone: "", email: "", note: "" });
  };

  const nextStep = (target: Step) => {
    setStep(target);
    scrollAreaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const prevStep = (target: Step) => {
    setStep(target);
    scrollAreaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!salon || !selectedCandidate || cart.length === 0) return;

    createMutation.mutate({
      slug: salon.slug,
      data: {
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email || null,
        note: contact.note || null,
        treatments: selectedCandidate.treatments.map((t, i) => ({
          serviceId: t.serviceId,
          employeeId: t.employeeId,
          date: t.date,
          startTime: t.startTime
        }))
      }
    });
  };

  if (isLoadingSalon) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" style={styleVars}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isErrorSalon || !salon) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" style={styleVars}>
        <div className="text-center p-8">
          <AlertCircle className="mb-4 h-12 w-12 mx-auto text-muted-foreground" />
          <h2 className="mb-2 text-xl font-semibold">Salon nije pronađen</h2>
          <Button onClick={() => refetchSalon()} variant="outline">Pokušaj ponovo</Button>
        </div>
      </div>
    );
  }

  const addToCart = (serviceId: string) => {
    if (cart.length >= 5) {
      toast.error("Maksimalno 5 usluga po terminu");
      return;
    }
    setCart([...cart, { serviceId }]);
  };

  const removeFromCart = (index: number) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  const continueFromCart = () => {
    trackEvent("treatment_cart_continued", analyticsDimensions());
    nextStep("EMPLOYEE");
  };

  const selectCandidate = (candidate: GroupedAvailabilityCandidate) => {
    setSelectedCandidate(candidate);
    trackEvent("booking_candidate_selected", analyticsDimensions());
  };

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground" style={styleVars}>
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center border-b px-4 bg-card shadow-sm sticky top-0 z-10">
        {step !== "CART" && step !== "SUCCESS" && (
          <Button variant="ghost" size="icon" className="-ml-2 mr-2" onClick={() => {
            if (step === "EMPLOYEE") prevStep("CART");
            else if (step === "DATETIME") prevStep("EMPLOYEE");
            else if (step === "CONTACT") prevStep("DATETIME");
          }}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="flex flex-1 flex-col">
          <h1 className="text-sm font-bold leading-tight">{salon.name}</h1>
          <p className="text-xs text-muted-foreground leading-tight truncate">{salon.address}, {salon.city}</p>
        </div>
      </header>

      {/* Progress */}
      <div className="h-1 w-full bg-muted shrink-0">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${step === "CART" ? 25 : step === "EMPLOYEE" ? 50 : step === "DATETIME" ? 75 : step === "CONTACT" ? 90 : 100}%` }}
        />
      </div>

      <ScrollArea className="flex-1" ref={scrollAreaRef}>
        <div className="mx-auto w-full max-w-md p-4 pb-24">

          {step === "CART" && (
            <div className="animate-in slide-in-from-right-4 duration-300">
              <h2 className="mb-4 text-xl font-serif font-bold text-foreground">Izaberite usluge</h2>

              <div className="mb-6 space-y-3">
                {salon.services.map(service => (
                  <Card key={service.id} className="overflow-hidden border shadow-sm transition-all hover:border-primary/40 cursor-pointer" onClick={() => addToCart(service.id)}>
                    <CardContent className="p-3 flex justify-between items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{service.name}</p>
                        <p className="text-xs text-muted-foreground">{service.categoryName} • {service.durationMinutes} min</p>
                      </div>
                      <div className="text-right shrink-0 flex items-center gap-3">
                        <span className="font-bold text-sm text-primary">{service.promoPrice ?? service.price} RSD</span>
                        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full bg-primary/10 text-primary hover:bg-primary/20"><Plus className="w-4 h-4" /></Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {cart.length > 0 && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t shadow-[0_-10px_20px_rgba(0,0,0,0.05)] z-20">
                  <div className="max-w-md mx-auto">
                    <div className="flex items-center justify-between mb-3 text-sm">
                      <span className="font-medium text-muted-foreground">Izabrano usluga: {cart.length}</span>
                      <span className="font-bold text-lg text-primary">
                        {cart.reduce((sum, item) => {
                          const s = salon.services.find(x => x.id === item.serviceId);
                          return sum + (s?.promoPrice ?? s?.price ?? 0);
                        }, 0)} RSD
                      </span>
                    </div>
                    <Button className="w-full h-12 text-base font-bold rounded-xl" onClick={continueFromCart}>
                      Nastavi ({cart.length}) <ChevronRight className="w-5 h-5 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "EMPLOYEE" && (
            <div className="animate-in slide-in-from-right-4 duration-300">
              <h2 className="mb-4 text-xl font-serif font-bold text-foreground">Željeni zaposleni</h2>
              <p className="text-sm text-muted-foreground mb-4">Ukoliko želite, možete izabrati specifičnog zaposlenog za svaku uslugu.</p>

              <div className="space-y-4 mb-6">
                {cart.map((item, index) => {
                  const s = salon.services.find(x => x.id === item.serviceId);
                  const eligibleStaff = salon.employees.filter(e => e.serviceIds.includes(item.serviceId));
                  return (
                    <Card key={index} className="overflow-hidden border shadow-sm">
                      <CardContent className="p-3">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <p className="font-semibold text-sm">{s?.name}</p>
                            <p className="text-xs text-muted-foreground">{s?.durationMinutes} min</p>
                          </div>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10 -mt-1 -mr-1" onClick={() => removeFromCart(index)}><Trash2 className="w-4 h-4" /></Button>
                        </div>

                        <Label className="text-xs mb-1.5 block text-muted-foreground">Izaberite radnika</Label>
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-medium"
                          value={item.employeeId ?? ""}
                          onChange={(e) => {
                            const newCart = [...cart];
                            newCart[index].employeeId = e.target.value === "" ? null : e.target.value;
                            setCart(newCart);
                          }}
                        >
                          <option value="">Bilo ko (prvi dostupan)</option>
                          {eligibleStaff.map(emp => (
                            <option key={emp.id} value={emp.id}>{emp.name}</option>
                          ))}
                        </select>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {cart.length === 0 ? (
                <div className="text-center p-8">
                  <Scissors className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground">Nemate izabranih usluga.</p>
                  <Button variant="outline" className="mt-4" onClick={() => prevStep("CART")}>Vrati se na usluge</Button>
                </div>
              ) : (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t shadow-[0_-10px_20px_rgba(0,0,0,0.05)] z-20">
                  <div className="max-w-md mx-auto">
                    <Button className="w-full h-12 text-base font-bold rounded-xl" onClick={() => nextStep("DATETIME")}>
                      Izaberi vreme <ChevronRight className="w-5 h-5 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "DATETIME" && (
            <div className="animate-in slide-in-from-right-4 duration-300">
              <h2 className="mb-4 text-xl font-serif font-bold text-foreground">Kada želite termin?</h2>

              <div className="mb-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Od</Label>
                    <Input type="date" min={todayDate} value={fromDate} onChange={e => {
                      const value = e.target.value;
                      setFromDate(value);
                      setSelectedCandidate(null);
                      setAvailabilityResponse(null);
                      if (!parseLocalDateOnly(value)) {
                        setDateError("Unesite ispravan početni datum.");
                        return;
                      }
                      setDateError(null);
                      if (!parseLocalDateOnly(toDate) || toDate < value) setToDate(value);
                    }} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Do</Label>
                    <Input
                      type="date"
                      min={parseLocalDateOnly(fromDate) ? fromDate : todayDate}
                      max={parseLocalDateOnly(fromDate) ? formatLocalDateOnly(addDays(parseLocalDateOnly(fromDate)!, 14)) ?? undefined : undefined}
                      value={toDate}
                      onChange={e => {
                        const value = e.target.value;
                        setToDate(value);
                        setSelectedCandidate(null);
                        setAvailabilityResponse(null);
                        setDateError(!parseLocalDateOnly(value) || value < fromDate ? "Krajnji datum mora biti ispravan i posle početnog." : null);
                      }}
                    />
                  </div>
                </div>
                {dateError && <p className="text-sm text-destructive" role="alert">{dateError}</p>}
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={allowMultipleDays}
                    onChange={(event) => { setAllowMultipleDays(event.target.checked); setSelectedCandidate(null); }}
                  />
                  Dozvoli da tretmani budu raspoređeni na više dana
                </label>

                <Button className="w-full" variant="outline" onClick={() => refetchAvailability()} disabled={isFetchingAvailability}>
                  {isFetchingAvailability ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calendar className="w-4 h-4 mr-2" />}
                  Proveri dostupnost
                </Button>
              </div>

              <div className="mt-6 mb-20">
                <GroupedAvailabilityView
                  isLoading={isLoadingAvailability || isFetchingAvailability}
                  viewMode={viewMode}
                  onViewModeChange={handleViewModeChange}
                  availabilityResponse={availabilityResponse}
                  salon={salon}
                  selectedCandidate={selectedCandidate}
                  onSelectCandidate={selectCandidate}
                />
              </div>

              {selectedCandidate && (
                <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t shadow-[0_-10px_20px_rgba(0,0,0,0.05)] z-20">
                  <div className="max-w-md mx-auto">
                    <Button className="w-full h-12 text-base font-bold rounded-xl" onClick={() => nextStep("CONTACT")}>
                      Nastavi <ChevronRight className="w-5 h-5 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "CONTACT" && (
            <div className="animate-in slide-in-from-right-4 duration-300">
              <h2 className="mb-4 text-xl font-serif font-bold text-foreground">Vaši podaci</h2>

              <div className="mb-6 rounded-xl border bg-muted/30 p-4">
                <div className="flex items-center justify-between border-b pb-3 mb-3 text-sm">
                  <span className="text-muted-foreground">Izabrane usluge</span>
                  <span className="font-bold">{cart.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Termin</span>
                  <span className="font-bold text-primary flex items-center">
                    <Clock className="h-3.5 w-3.5 mr-1" />
                    {selectedCandidate && `${formatDateOnly(selectedCandidate.date, "dd.MM.") ?? "Nepoznat datum"} u ${selectedCandidate.startTime}`}
                  </span>
                </div>
              </div>

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
                  <Button type="submit" className="w-full h-12 text-base font-semibold rounded-xl shadow-md" disabled={createMutation.isPending} data-testid="button-submit">
                    {createMutation.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Potvrdi zakazivanje"}
                  </Button>
                </div>
                <p className="text-center text-[11px] text-muted-foreground px-4">
                  Ovo je zahtev za zakazivanje. Salon će ga ubrzo potvrditi.
                </p>
              </form>
            </div>
          )}

          {step === "SUCCESS" && (
            <div className="flex flex-col items-center justify-center text-center animate-in zoom-in-95 duration-500 py-8">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-sm">
                <CheckCircle2 className="h-10 w-10" />
              </div>
              <h2 className="mb-2 text-2xl font-serif font-bold text-foreground">Zahtev je poslat!</h2>
              <p className="mb-4 text-muted-foreground text-sm max-w-[320px]">
                Vaša grupna rezervacija je uspešno zakazana. Dobićete potvrdu od salona u najkraćem roku.
              </p>
              <div className="mb-6 w-full space-y-2 text-left" aria-label="Raspored grupne rezervacije">
                {completedAppointments.map((appointment) => (
                  <div key={appointment.id} className="rounded-xl border bg-background p-3">
                    <p className="font-semibold text-foreground">{appointment.serviceName}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {appointment.date} · {appointment.startTime}–{appointment.endTime}
                    </p>
                    <p className="text-sm text-muted-foreground">Zaposleni: {appointment.employeeName}</p>
                  </div>
                ))}
              </div>
              <Button onClick={resetFlow} variant="outline" className="w-full font-medium rounded-xl h-11" data-testid="button-reset">
                Zakaži još jedan termin
              </Button>
            </div>
          )}

        </div>
      </ScrollArea>
    </div>
  );
}
