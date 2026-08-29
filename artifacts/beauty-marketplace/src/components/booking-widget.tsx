
import { useEffect, useState, useRef, type RefObject } from "react";
import { addDays, startOfToday } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ChevronRight, Clock, CalendarDays, User as UserIcon, Check, Loader2, Plus, Trash2, X, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getGetCustomerDashboardQueryKey,
  getListMyAppointmentsQueryKey,
  type SalonProfile,
  type CurrentUserResponse,
  type GroupedTreatmentRequest,
  type GroupedAvailabilityCandidate,
  useGetGroupedBookingAvailability,
  useCreateBookingGroup,

} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatDateOnly, formatLocalDateOnly, parseLocalDateOnly } from "@/lib/date-only";
import { trackEvent } from "@/lib/analytics";
import { useAvailabilityViewMode } from "@/hooks/use-availability-view-mode";
import { GroupedAvailabilityView } from "@/components/booking/grouped-availability-view";

export interface BookingWidgetProps {
  salon: SalonProfile;
  user: CurrentUserResponse['user'] | undefined | null;

  // Prop to receive quick-add service from SalonProfile
  selectedService: string | null;
  setSelectedService: (id: string | null) => void;

  onViewAppointments: () => void;

  className?: string;
  onCloseMobile?: () => void;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}

export function BookingWidget(props: BookingWidgetProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"CART" | "EMPLOYEE" | "DATETIME" | "SUCCESS">("CART");
  const [cart, setCart] = useState<GroupedTreatmentRequest[]>([]);
  const todayDate = formatLocalDateOnly(startOfToday())!;
  const [fromDate, setFromDate] = useState(todayDate);
  const [toDate, setToDate] = useState(todayDate);
  const [dateError, setDateError] = useState<string | null>(null);
  const [allowMultipleDays, setAllowMultipleDays] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<GroupedAvailabilityCandidate | null>(null);
  const analyticsDimensions = () => ({
    treatment_count: cart.length,
    customer_type: props.user ? "authenticated" : "guest",
    day_choice: allowMultipleDays ? "multi_day" : "same_day",
    booking_surface: "salon_profile",
  });

  const { toast } = useToast();

  // Handle external service selection
  useEffect(() => {
    if (props.selectedService) {
      if (cart.length < 5) {
        setCart(prev => [...prev, { serviceId: props.selectedService! }]);
      }
      props.setSelectedService(null);
      setStep("CART");
    }
  }, [props.selectedService]);

  const availabilityMutation = useGetGroupedBookingAvailability();

  const [availabilityResponse, setAvailabilityResponse] = useState<any>(null);

  const [viewMode, setViewMode] = useAvailabilityViewMode();

  const latestRequestRef = useRef(0);

  const refetchAvailability = (mode = viewMode) => {
    const parsedFrom = parseLocalDateOnly(fromDate);
    const parsedTo = parseLocalDateOnly(toDate);
    const maximumTo = parsedFrom ? formatLocalDateOnly(addDays(parsedFrom, 13)) : null;
    if (!parsedFrom || !parsedTo) {
      setDateError("Unesite ispravne datume.");
      setAvailabilityResponse({ candidates: [] });
      setSelectedCandidate(null);
      return;
    }
    if (fromDate < todayDate || toDate < fromDate || (maximumTo && toDate > maximumTo)) {
      setDateError("Izaberite period od danas, najduže 14 dana, bez obrnutog raspona.");
      setAvailabilityResponse({ candidates: [] });
      setSelectedCandidate(null);
      return;
    }
    setDateError(null);
    const currentId = ++latestRequestRef.current;
    availabilityMutation.mutate({
      salonId: props.salon.id,
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

  const createMutation = useCreateBookingGroup({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListMyAppointmentsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetCustomerDashboardQueryKey() });
        setStep("SUCCESS");
        trackEvent("grouped_booking_completed", analyticsDimensions());
      },
      onError: (err: any) => {
        toast.error("Greška pri zakazivanju", { description: "Pokušajte ponovo." });
      }
    }
  });

  const handleBook = () => {
    if (!selectedCandidate) return;
    createMutation.mutate({
      data: {
        salonId: props.salon.id,
        date: selectedCandidate.date,
        treatments: selectedCandidate.treatments.map(t => ({
          serviceId: t.serviceId,
          employeeId: t.employeeId,
          date: t.date,
          startTime: t.startTime
        }))
      }
    });
  };

  const resetFlow = () => {
    setCart([]);
    setSelectedCandidate(null);
    setStep("CART");
  };

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
    setStep("EMPLOYEE");
  };

  const selectCandidate = (candidate: GroupedAvailabilityCandidate) => {
    setSelectedCandidate(candidate);
    trackEvent("booking_candidate_selected", analyticsDimensions());
  };

  return (
    <Card className={`flex flex-col overflow-hidden bg-card border-none sm:border-solid ${props.className || ''}`}>
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar pb-24">
        {step === "CART" && (
          <div className="animate-in fade-in duration-300">
            <h2 className="text-xl font-serif font-bold mb-4">Vaša korpa</h2>
            {cart.length === 0 ? (
              <div className="text-center p-8 bg-muted/20 rounded-xl border border-dashed">
                <p className="text-muted-foreground">Nemate izabranih usluga.</p>
                <p className="text-xs mt-2 text-muted-foreground">Izaberite usluge iz cenovnika levo.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {cart.map((item, index) => {
                  const s = props.salon.services.find(x => x.id === item.serviceId);
                  return (
                    <div key={index} className="flex justify-between items-center p-3 rounded-lg border shadow-sm">
                      <div>
                        <p className="font-semibold text-sm">{s?.name}</p>
                        <p className="text-xs text-muted-foreground">{s?.durationMinutes} min</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-sm text-primary">{s?.promoPrice ?? s?.price} RSD</span>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => removeFromCart(index)}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-6 border-t pt-4">
              <div className="flex justify-between items-center mb-4">
                <span className="font-medium text-muted-foreground">Ukupno ({cart.length})</span>
                <span className="font-bold text-lg text-primary">
                  {cart.reduce((sum, item) => {
                    const s = props.salon.services.find(x => x.id === item.serviceId);
                    return sum + (s?.promoPrice ?? s?.price ?? 0);
                  }, 0)} RSD
                </span>
              </div>
              <Button className="w-full font-bold" size="lg" disabled={cart.length === 0} onClick={continueFromCart}>
                Nastavi <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === "EMPLOYEE" && (
          <div className="animate-in fade-in duration-300">
            <h2 className="text-xl font-serif font-bold mb-4">Izaberite radnika</h2>
            <div className="space-y-4 mb-6">
              {cart.map((item, index) => {
                const s = props.salon.services.find(x => x.id === item.serviceId);
                const eligibleStaff = props.salon.staff.filter(e => e.serviceIds.includes(item.serviceId));
                return (
                  <div key={index} className="p-3 rounded-lg border shadow-sm">
                    <p className="font-semibold text-sm mb-2">{s?.name}</p>
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
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="w-1/3" onClick={() => setStep("CART")}>Nazad</Button>
              <Button className="flex-1 font-bold" onClick={() => setStep("DATETIME")}>Izaberi vreme <ChevronRight className="w-4 h-4 ml-1" /></Button>
            </div>
          </div>
        )}

        {step === "DATETIME" && (
          <div className="animate-in fade-in duration-300">
            <h2 className="text-xl font-serif font-bold mb-4">Datum i vreme</h2>
            <div className="mb-4 space-y-4">
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
                Dozvoli tretmane tokom više dana
              </label>

              <Button className="w-full" variant="outline" onClick={() => refetchAvailability()} disabled={isFetchingAvailability}>
                {isFetchingAvailability ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarDays className="w-4 h-4 mr-2" />}
                Proveri dostupnost
              </Button>
            </div>

            <div className="mt-6">
              <GroupedAvailabilityView
                isLoading={isLoadingAvailability || isFetchingAvailability}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                availabilityResponse={availabilityResponse}
                salon={props.salon}
                selectedCandidate={selectedCandidate}
                onSelectCandidate={selectCandidate}
              />
            </div>

            <div className="flex gap-2 mt-4 pt-4 border-t">
              <Button variant="outline" className="w-1/3" onClick={() => setStep("EMPLOYEE")}>Nazad</Button>
              <Button className="flex-1 font-bold" disabled={!selectedCandidate || createMutation.isPending} onClick={handleBook}>
                {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Zakaži"}
              </Button>
            </div>
          </div>
        )}

        {step === "SUCCESS" && (
          <div className="flex flex-col items-center justify-center text-center animate-in zoom-in-95 duration-500 py-8">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <h2 className="mb-2 text-2xl font-serif font-bold text-foreground">Uspešno zakazano!</h2>
            <p className="mb-8 text-muted-foreground text-sm max-w-[280px]">Vaš termin je u obradi. Dobićete potvrdu uskoro.</p>
            <Button onClick={() => { resetFlow(); props.onViewAppointments(); }} className="w-full font-medium" size="lg">Moji termini</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function MobileBookingTrigger({ salon, cartCount, onOpen }: { salon: SalonProfile, cartCount: number, onOpen: () => void }) {
  return (
    <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] left-4 right-4 z-40 bg-card/95 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-primary/20 p-4 flex items-center justify-between md:bottom-4 md:hidden">
       <div className="flex-1 min-w-0 pr-4">
         <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Vaša rezervacija</p>
         <p className="font-bold text-sm truncate text-foreground">
           {cartCount > 0 ? `Izabrano usluga: ${cartCount}` : "Izaberite uslugu i zakažite"}
         </p>
       </div>
        <div className="text-right shrink-0">
          <Button type="button" onClick={onOpen} className="rounded-xl shadow-md h-9 px-4 font-bold">
            Zakaži
          </Button>
        </div>
    </div>
  );
}

export function MobileBookingDrawer({
  isOpen,
  onClose,
  children,
  scrollContainerRef,
}: {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="flex h-[90dvh] min-h-0 flex-col overflow-visible rounded-t-3xl border-0 p-0 [&>button]:right-4 [&>button]:top-4 [&>button]:z-20">
        <SheetTitle className="sr-only">Zakažite termin</SheetTitle>
        <SheetDescription className="sr-only">Izaberite uslugu, zaposlenog i slobodan termin.</SheetDescription>
        <div className="w-full flex justify-center py-3 bg-background shrink-0" aria-hidden="true">
          <div className="w-12 h-1.5 bg-muted rounded-full" />
        </div>
        <div
          ref={scrollContainerRef}
          data-testid="mobile-booking-scroll-area"
          className="relative min-h-0 flex-1 overflow-y-auto touch-pan-y [overflow-anchor:none] [-webkit-overflow-scrolling:touch]"
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
