import { useState, useRef, useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { addDays, format, startOfMonth, parseISO } from "date-fns";
import { srLatn } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ChevronRight, Clock, MapPin, User as UserIcon, Check, Loader2, Trash2, CheckCircle2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  getGetCustomerDashboardQueryKey,
  getListMyAppointmentsQueryKey,
  type SalonProfile,
  type CurrentUserResponse,
  type GroupedTreatmentRequest,
  type GroupedAvailabilityCandidate,
  type Appointment,
  useGetGroupedBookingAvailability,
  useCreateBookingGroup,
  getApiErrorDetails,
  getApiErrorMessage,
  bookingCommandKey,
  clearBookingCommandKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatDateOnlyInTimeZone, formatLocalDateOnly, parseLocalDateOnly } from "@/lib/date-only";
import { trackEvent } from "@/lib/analytics";
import { useAvailabilityViewMode } from "@/hooks/use-availability-view-mode";
import { GroupedAvailabilityView } from "@/components/booking/grouped-availability-view";

export interface BookingWidgetProps {
  salon: SalonProfile;
  user: CurrentUserResponse['user'] | undefined | null;
  cart: GroupedTreatmentRequest[];
  setCart: Dispatch<SetStateAction<GroupedTreatmentRequest[]>>;

  onViewAppointments: () => void;

  className?: string;
  onCloseMobile?: () => void;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  surface: "desktop" | "mobile";
  serverGeneratedAt?: string;
  quickBookCandidate?: {
    serviceId: string;
    employeeId: string;
    date: string;
    startTime: string;
    surface: "desktop" | "mobile";
  } | null;
  onQuickBookConsumed?: () => void;
  onRequireSignIn?: (candidate: {
    serviceId: string;
    employeeId: string;
    date: string;
    startTime: string;
  }) => void;
}

export function BookingWidget(props: BookingWidgetProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"CART" | "EMPLOYEE" | "DATETIME" | "QUICK_CONFIRM" | "SUCCESS">("CART");
  const [quickFlowCart, setQuickFlowCart] = useState<GroupedTreatmentRequest[] | null>(null);
  const cart = quickFlowCart ?? props.cart;
  const setCart: Dispatch<SetStateAction<GroupedTreatmentRequest[]>> = (next) => {
    if (quickFlowCart !== null) {
      setQuickFlowCart((current) => {
        const active = current ?? [];
        return typeof next === "function" ? next(active) : next;
      });
      return;
    }
    props.setCart(next);
  };

  const todayDate = formatDateOnlyInTimeZone(props.serverGeneratedAt);
  const initialToday = todayDate ? parseLocalDateOnly(todayDate) : null;
  const defaultToDate = initialToday ? formatLocalDateOnly(addDays(initialToday, 13))! : "";

  const [fromDate, setFromDate] = useState(todayDate ?? "");
  const [toDate, setToDate] = useState(defaultToDate);
  const [currentMonth, setCurrentMonth] = useState<Date>(() =>
    startOfMonth(initialToday ?? new Date()));
  const initializedTodayRef = useRef<string | null>(null);

  useEffect(() => {
    if (!todayDate || initializedTodayRef.current === todayDate) return;
    const previousToday = initializedTodayRef.current;
    const parsedToday = parseLocalDateOnly(todayDate);
    if (!parsedToday) return;
    setFromDate((current) => !current || current === previousToday ? todayDate : current);
    setToDate((current) => !current || (previousToday && current === formatLocalDateOnly(addDays(parseLocalDateOnly(previousToday)!, 13)))
      ? formatLocalDateOnly(addDays(parsedToday, 13))!
      : current);
    setCurrentMonth((current) => previousToday ? current : startOfMonth(parsedToday));
    initializedTodayRef.current = todayDate;
  }, [todayDate]);

  const [allowMultipleDays, setAllowMultipleDays] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<GroupedAvailabilityCandidate | null>(null);
  const [completedAppointments, setCompletedAppointments] = useState<Appointment[]>([]);

  const analyticsDimensions = () => ({
    treatment_count: cart.length,
    customer_type: props.user ? "authenticated" : "guest",
    day_choice: allowMultipleDays ? "multi_day" : "same_day",
    booking_surface: "salon_profile",
  });

  const { toast } = useToast();
  const availabilityMutation = useGetGroupedBookingAvailability();
  const [availabilityResponse, setAvailabilityResponse] = useState<any>(null);
  const [viewMode, setViewMode] = useAvailabilityViewMode();
  const latestRequestRef = useRef(0);

  useEffect(() => {
    const quick = props.quickBookCandidate;
    if (!quick || quick.surface !== props.surface) return;

    const currentId = ++latestRequestRef.current;
    availabilityMutation.mutate({
      salonId: props.salon.id,
      data: {
        treatments: [{ serviceId: quick.serviceId, employeeId: quick.employeeId }],
        fromDate: quick.date,
        toDate: quick.date,
        allowMultipleDays: false,
        resultMode: "list",
      },
    }, {
      onSuccess: (data) => {
        if (latestRequestRef.current !== currentId) return;
        const candidate = (data.candidates ?? []).find((item) =>
          item.date === quick.date
          && item.startTime === quick.startTime
          && item.treatments.length === 1
          && item.treatments[0]?.serviceId === quick.serviceId
          && item.treatments[0]?.employeeId === quick.employeeId
          && item.treatments[0]?.date === quick.date
          && item.treatments[0]?.startTime === quick.startTime
        );
        props.onQuickBookConsumed?.();
        if (candidate) {
          setQuickFlowCart([{ serviceId: quick.serviceId, employeeId: quick.employeeId }]);
          setSelectedCandidate(candidate);
          setStep("QUICK_CONFIRM");
          return;
        }

        setQuickFlowCart([{ serviceId: quick.serviceId, employeeId: quick.employeeId }]);
        setFromDate(quick.date);
        setToDate(formatLocalDateOnly(addDays(parseLocalDateOnly(quick.date)!, 13))!);
        setAvailabilityResponse(null);
        setSelectedCandidate(null);
        setStep("DATETIME");
        toast.error("Termin više nije dostupan", {
          description: "Prikazaćemo vam nove slobodne termine za istu uslugu.",
        });
      },
      onError: () => {
        if (latestRequestRef.current !== currentId) return;
        props.onQuickBookConsumed?.();
        setQuickFlowCart([{ serviceId: quick.serviceId, employeeId: quick.employeeId }]);
        setFromDate(quick.date);
        setToDate(formatLocalDateOnly(addDays(parseLocalDateOnly(quick.date)!, 13))!);
        setAvailabilityResponse(null);
        setSelectedCandidate(null);
        setStep("DATETIME");
        toast.error("Termin nije moguće proveriti", {
          description: "Izaberite jedan od trenutno dostupnih termina.",
        });
      },
    });
  // Candidate identity is intentionally the trigger; callbacks are owned by the page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.quickBookCandidate]);

  const mergeCalendarDay = (current: any, next: any) => {
    const days = new Map<string, any>();
    for (const day of current?.calendarDays ?? []) days.set(day.date, day);
    for (const day of next?.calendarDays ?? []) days.set(day.date, day);
    return { ...next, candidates: [], calendarDays: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  };

  const refetchAvailability = (mode = viewMode, multipleDays = allowMultipleDays) => {
    if (!todayDate) return;
    const parsedFrom = parseLocalDateOnly(fromDate);
    const parsedTo = parseLocalDateOnly(toDate);
    if (!parsedFrom || !parsedTo) {
      setAvailabilityResponse({ candidates: [] });
      setSelectedCandidate(null);
      return;
    }

    const requestedToDate = mode === "calendar" && !multipleDays ? fromDate : toDate;
    const currentId = ++latestRequestRef.current;
    availabilityMutation.mutate({
      salonId: props.salon.id,
      data: {
        treatments: cart,
        fromDate,
        toDate: requestedToDate,
        allowMultipleDays: multipleDays,
        resultMode: mode,
      }
    }, {
      onSuccess: (data) => {
        if (latestRequestRef.current !== currentId) return;
        setAvailabilityResponse((current: any) =>
          mode === "calendar" && !multipleDays ? mergeCalendarDay(current, data) : data);
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
      refetchAvailability(mode, allowMultipleDays);
    }
  };

  useEffect(() => {
    if (step === "DATETIME" && todayDate && !availabilityResponse && !availabilityMutation.isPending) {
      refetchAvailability();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, todayDate]);

  const isLoadingAvailability = availabilityMutation.isPending;
  const isFetchingAvailability = availabilityMutation.isPending;

  const createMutation = useCreateBookingGroup({
    mutation: {
      onSuccess: (data, variables) => {
        clearBookingCommandKey("/api/booking-groups", variables.data);
        void queryClient.invalidateQueries({ queryKey: getListMyAppointmentsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetCustomerDashboardQueryKey() });
        setCompletedAppointments(data.appointments);
        setStep("SUCCESS");
        trackEvent("grouped_booking_completed", analyticsDimensions());
      },
      onError: (err: any) => {
        const { status } = getApiErrorDetails(err);
        const message = getApiErrorMessage(err, "Zakazivanje trenutno nije moguće.");
        if (status === 401) {
          const treatment = selectedCandidate?.treatments[0];
          toast.error("Prijava je istekla", {
            description: "Prijavite se ponovo da biste nastavili zakazivanje.",
          });
          if (treatment?.employeeId) {
            props.onRequireSignIn?.({
              serviceId: treatment.serviceId,
              employeeId: treatment.employeeId,
              date: treatment.date,
              startTime: treatment.startTime,
            });
          }
          return;
        }
        if (status === 409) {
          const conflictedTreatment = selectedCandidate?.treatments[0];
          if (step === "QUICK_CONFIRM" && conflictedTreatment) {
            setQuickFlowCart([{
              serviceId: conflictedTreatment.serviceId,
              employeeId: conflictedTreatment.employeeId,
            }]);
            setFromDate(conflictedTreatment.date);
            setToDate(formatLocalDateOnly(addDays(parseLocalDateOnly(conflictedTreatment.date)!, 13))!);
            setAvailabilityResponse(null);
            setSelectedCandidate(null);
            setStep("DATETIME");
            toast.error("Termin više nije slobodan", {
              description: "Osvežili smo dostupne rasporede. Izaberite drugi.",
            });
            return;
          }
          setSelectedCandidate(null);
          refetchAvailability();
          toast.error("Termin više nije slobodan", {
            description: "Osvežili smo dostupne rasporede. Izaberite drugi.",
          });
          return;
        }
        if (status === 400 || status === 422) {
          toast.error("Podaci za zakazivanje nisu ispravni", { description: message });
          return;
        }
        if (status === 403) {
          toast.error("Zakazivanje nije dostupno", { description: message });
          return;
        }
        toast.error("Zakazivanje nije uspelo", { description: message });
      }
    }
  });

  const handleBook = () => {
    if (!selectedCandidate) return;
    if (!props.user) {
      const treatment = selectedCandidate.treatments[0];
      if (treatment?.employeeId) {
        props.onRequireSignIn?.({
          serviceId: treatment.serviceId,
          employeeId: treatment.employeeId,
          date: treatment.date,
          startTime: treatment.startTime,
        });
      }
      return;
    }
    if (props.user.role !== "CUSTOMER") {
      toast.error("Zakazivanje nije dostupno", {
        description: "Za zakazivanje termina koristite klijentski nalog.",
      });
      return;
    }
    const data = {
      salonId: props.salon.id,
      date: selectedCandidate.date,
      treatments: selectedCandidate.treatments.map(t => ({
        serviceId: t.serviceId,
        employeeId: t.employeeId,
        date: t.date,
        startTime: t.startTime
      }))
    };
    createMutation.mutate({
      data,
      // Same key customFetch's own retry-safe fallback would have picked for
      // this exact payload -- kept explicit now that the header is required.
      headers: { "Idempotency-Key": bookingCommandKey("/api/booking-groups", data) },
    });
  };

  const resetFlow = () => {
    if (quickFlowCart !== null) {
      setQuickFlowCart(null);
    } else {
      props.setCart([]);
    }
    setSelectedCandidate(null);
    setCompletedAppointments([]);
    setStep("CART");
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

  const STEPS = [
    { id: "CART", label: "USLUGA", num: 1 },
    { id: "EMPLOYEE", label: "ZAPOSLENI", num: 2 },
    { id: "DATETIME", label: "TERMIN", num: 3 },
    { id: "SUCCESS", label: "POTVRDA", num: 4 },
  ];
  const currentStepIndex = STEPS.findIndex(s => s.id === step);

  const ProgressIndicator = () => (
    <div className="flex items-start justify-between mb-8" data-testid="booking-progress">
      {STEPS.map((s, idx) => {
        const isCompleted = idx < currentStepIndex;
        const isCurrent = idx === currentStepIndex;
        const isLast = idx === STEPS.length - 1;
        return (
          <div key={s.id} className={`flex ${isLast ? 'flex-none' : 'flex-1'} items-center`}>
            <div className="flex flex-col items-center gap-2 relative">
              <div aria-current={isCurrent ? "step" : undefined} aria-label={`Korak ${s.num}: ${s.label}`} className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 z-10 ${
                isCurrent ? "bg-primary text-primary-foreground shadow-md ring-4 ring-primary/10" :
                isCompleted ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground border-2 border-transparent"
              }`}>
                {isCompleted ? <Check className="w-4 h-4" /> : s.num}
              </div>
              <span className={`absolute top-10 text-[9px] font-bold tracking-wider uppercase whitespace-nowrap transition-colors ${isCurrent ? "text-primary" : "text-muted-foreground"}`}>
                {s.label}
              </span>
            </div>
            {!isLast && (
              <div className="flex-1 h-[2px] mx-2 -mt-6">
                <div className={`h-full transition-all duration-500 rounded-full ${isCompleted ? 'bg-primary' : 'bg-muted'}`} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const ContextCard = () => {
    const totalMins = cart.reduce((sum, item) => sum + (props.salon.services.find(s => s.id === item.serviceId)?.durationMinutes ?? 0), 0);
    const totalPrice = cart.reduce((sum, item) => {
      const s = props.salon.services.find(x => x.id === item.serviceId);
      return sum + (s?.promoPrice ?? s?.price ?? 0);
    }, 0);

    return (
      <div className="bg-secondary/30 border border-secondary/50 p-4 rounded-2xl flex items-center gap-4 mb-6 shadow-sm">
        <Avatar className="w-14 h-14 border border-background shadow-sm">
          <AvatarImage src={props.salon.imageUrl} className="object-cover" />
          <AvatarFallback>{props.salon.name.charAt(0)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h3 className="font-serif font-bold text-base truncate text-foreground">{props.salon.name}</h3>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
            <MapPin className="w-3 h-3 shrink-0"/> {[props.salon.municipality, props.salon.city].filter(Boolean).join(", ")}
          </p>
          <div className="flex flex-wrap gap-1 mt-2">
             {cart.map((item, i) => {
                const s = props.salon.services.find(x => x.id === item.serviceId);
                const emp = item.employeeId ? props.salon.staff.find(e => e.id === item.employeeId) : null;
                return (
                  <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0 bg-background/80 hover:bg-background">
                    {s?.name} · {emp?.name ?? "Bilo koji zaposleni"}
                  </Badge>
                );
             })}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-primary">{totalPrice} RSD</p>
          <p className="text-xs text-muted-foreground mt-0.5">{totalMins} min</p>
        </div>
      </div>
    );
  };

  return (
    <Card className={`flex flex-col h-full bg-card border-none sm:border-solid sm:rounded-3xl shadow-none sm:shadow-xl ${props.className || ''}`}>
      <div className="flex-1 overflow-y-auto custom-scrollbar relative">
        <div className="p-4 sm:p-6 pb-24 min-h-full flex flex-col">
          {step !== "QUICK_CONFIRM" && <ProgressIndicator />}

          {step === "QUICK_CONFIRM" && selectedCandidate && (() => {
            const treatment = selectedCandidate.treatments[0]!;
            const service = props.salon.services.find((item) => item.id === treatment.serviceId);
            const employee = props.salon.staff.find((item) => item.id === treatment.employeeId);
            return (
              <div data-testid="quick-book-confirmation" className="flex min-w-0 flex-1 flex-col animate-in fade-in zoom-in-95 duration-300">
                <div className="mb-6">
                  <Badge className="mb-3">Brzo zakazivanje</Badge>
                  <h2 className="text-2xl font-serif font-bold text-foreground">Potvrdite termin</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Proverili smo da je prikazani termin još uvek slobodan.</p>
                </div>
                <div className="min-w-0 space-y-4 rounded-2xl border bg-secondary/20 p-4 sm:p-5">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Usluga</p>
                    <p className="mt-1 break-words font-serif text-lg font-bold">{service?.name}</p>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Zaposleni</p>
                      <p className="mt-1 break-words font-semibold">{employee?.name}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Termin</p>
                      <p className="mt-1 font-semibold">{format(parseISO(treatment.date), "dd. MMMM yyyy.", { locale: srLatn })}</p>
                      <p className="text-primary font-bold">{treatment.startTime}–{treatment.endTime}</p>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <span className="text-sm text-muted-foreground"><Clock className="mr-1 inline h-4 w-4" />{service?.durationMinutes} min</span>
                    <span className="text-xl font-bold text-primary">{service?.promoPrice ?? service?.price} RSD</span>
                  </div>
                </div>
                <div className="mt-auto flex min-w-0 flex-col-reverse gap-3 pt-8 sm:flex-row">
                  <Button
                    type="button"
                    variant="secondary"
                    className="sm:w-1/3"
                    onClick={() => {
                      setQuickFlowCart([{ serviceId: treatment.serviceId, employeeId: treatment.employeeId }]);
                      setFromDate(treatment.date);
                      setToDate(formatLocalDateOnly(addDays(parseLocalDateOnly(treatment.date)!, 13))!);
                      setAvailabilityResponse(null);
                      setSelectedCandidate(null);
                      setStep("DATETIME");
                    }}
                  >
                    Izaberi drugi termin
                  </Button>
                  <Button
                    type="button"
                    data-testid="quick-book-submit"
                    className="min-w-0 flex-1 font-bold shadow-md"
                    disabled={createMutation.isPending}
                    onClick={handleBook}
                  >
                    {createMutation.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    {props.user ? "Potvrdi zakazivanje" : "Prijavite se za potvrdu"}
                  </Button>
                </div>
              </div>
            );
          })()}

          {step === "CART" && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-400">
              {cart.length > 0 && ContextCard()}
              <h2 className="text-xl font-serif font-bold mb-4 text-foreground">Vaša rezervacija</h2>
              {cart.length === 0 ? (
                <div className="text-center p-8 bg-muted/20 rounded-2xl border border-dashed my-6">
                  <p className="text-muted-foreground font-medium">Nemate izabranih usluga.</p>
                  <p className="text-xs mt-2 text-muted-foreground">Izaberite usluge iz cenovnika levo.</p>
                </div>
              ) : (
                <div className="space-y-3 mb-6" role="list" aria-label="Izabrani tretmani">
                  {cart.map((item, index) => {
                    const s = props.salon.services.find(x => x.id === item.serviceId);
                    return (
                      <div key={index} role="listitem" data-testid={`booking-cart-item-${index}`} className="flex justify-between items-center p-4 rounded-2xl border bg-card shadow-sm hover:shadow-md transition-shadow">
                        <div>
                          <p className="font-serif font-bold text-sm text-foreground">{s?.name}</p>
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Clock className="w-3 h-3"/> {s?.durationMinutes} min</p>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-bold text-sm text-primary">{s?.promoPrice ?? s?.price} RSD</span>
                          <Button aria-label={`Ukloni ${s?.name ?? "uslugu"} iz izabranih tretmana`} size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive rounded-full" onClick={() => removeFromCart(index)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-8 border-t pt-6 sticky bottom-0 bg-card z-10 pb-4">
                <div className="flex justify-between items-end mb-5 px-1">
                  <span className="font-bold text-sm text-muted-foreground">Ukupno ({cart.length})</span>
                  <span className="font-serif font-bold text-2xl text-primary">
                    {cart.reduce((sum, item) => {
                      const s = props.salon.services.find(x => x.id === item.serviceId);
                      return sum + (s?.promoPrice ?? s?.price ?? 0);
                    }, 0)} <span className="text-base font-sans">RSD</span>
                  </span>
                </div>
                <Button className="w-full font-bold shadow-md" size="lg" disabled={cart.length === 0} onClick={continueFromCart}>
                  Nastavi na izbor zaposlenog <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {step === "EMPLOYEE" && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-400">
              {ContextCard()}
              <h2 className="text-xl font-serif font-bold mb-4 text-foreground">Izaberite radnika</h2>

              <div className="space-y-6 mb-6">
                {cart.map((item, index) => {
                  const s = props.salon.services.find(x => x.id === item.serviceId);
                  const eligibleStaff = props.salon.staff.filter(e => e.serviceIds.includes(item.serviceId));
                  return (
                    <div key={index} className="bg-card rounded-2xl border p-4 mb-4 shadow-sm">
                      <h4 className="font-serif font-bold text-base mb-3 text-foreground">{s?.name}</h4>
                      <div className="flex overflow-x-auto pb-2 -mx-4 px-4 custom-scrollbar gap-3 snap-x">
                        <button
                          data-testid={`booking-employee-any-${index}`}
                          aria-label={`${s?.name}: bilo koji zaposleni`}
                          aria-pressed={!item.employeeId}
                          onClick={() => {
                            setCart(cart.map((cartItem, cartIndex) => (
                              cartIndex === index ? { ...cartItem, employeeId: null } : cartItem
                            )));
                          }}
                          className={`snap-start shrink-0 w-[100px] flex flex-col items-center gap-3 p-3 rounded-xl border transition-all duration-200 ${!item.employeeId ? 'border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm' : 'border-border hover:border-primary/30 bg-background'}`}
                        >
                          <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${!item.employeeId ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                            <UserIcon className="w-6 h-6" />
                          </div>
                          <span className="text-xs font-bold text-center">Bilo ko</span>
                        </button>

                        {eligibleStaff.map(emp => (
                          <button
                            key={emp.id}
                            data-testid={`booking-employee-${index}-${emp.id}`}
                            aria-label={`${s?.name}: ${emp.name}`}
                            aria-pressed={item.employeeId === emp.id}
                            onClick={() => {
                                setCart(cart.map((cartItem, cartIndex) => (
                                  cartIndex === index ? { ...cartItem, employeeId: emp.id } : cartItem
                                )));
                            }}
                            className={`snap-start shrink-0 w-[100px] flex flex-col items-center gap-3 p-3 rounded-xl border transition-all duration-200 ${item.employeeId === emp.id ? 'border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm' : 'border-border hover:border-primary/30 bg-background'}`}
                          >
                            <Avatar className="w-14 h-14 border-2 border-background shadow-sm">
                              <AvatarFallback className="bg-secondary text-secondary-foreground font-bold">
                                {emp.name.split(/\s+/).map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-xs font-bold text-center truncate w-full" title={emp.name}>{emp.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3 mt-8 pt-6 border-t sticky bottom-0 bg-card z-10 pb-4">
                <Button variant="secondary" className="w-1/3 font-medium" onClick={() => setStep("CART")}>Nazad</Button>
                <Button className="flex-1 font-bold shadow-md" onClick={() => setStep("DATETIME")}>Izaberi vreme <ChevronRight className="w-4 h-4 ml-1" /></Button>
              </div>
            </div>
          )}

          {step === "DATETIME" && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-400">
              {ContextCard()}

              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-serif font-bold text-foreground">Datum i vreme</h2>
              </div>

              <div className="bg-secondary/20 p-3.5 rounded-xl border border-secondary mb-6 flex justify-between items-center">
                <div>
                  <Label htmlFor="allow-multiday" className="font-bold text-sm cursor-pointer">Grupisanje u više dana</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Dozvoli usluge različitim danima</p>
                </div>
                <Switch
                  data-testid="booking-multiday-toggle"
                  id="allow-multiday"
                  checked={allowMultipleDays}
                  onCheckedChange={(checked) => {
                    setAllowMultipleDays(checked);
                    setSelectedCandidate(null);
                    setTimeout(() => refetchAvailability(viewMode, checked), 0);
                  }}
                />
              </div>

              <GroupedAvailabilityView
                isLoading={isLoadingAvailability || isFetchingAvailability}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                availabilityResponse={availabilityResponse}
                salon={props.salon}
                selectedCandidate={selectedCandidate}
                onSelectCandidate={selectCandidate}
                currentMonth={currentMonth}
                onMonthChange={setCurrentMonth}
                todayDate={todayDate ?? undefined}
                fromDate={fromDate}
                toDate={toDate}
                onDateSelect={(dateStr) => {
                  const parsed = parseLocalDateOnly(dateStr);
                  if (!parsed) return;
                  const newToDate = formatLocalDateOnly(addDays(parsed, 13))!;
                  const requestToDate = viewMode === "calendar" && !allowMultipleDays ? dateStr : newToDate;
                  setFromDate(dateStr);
                  setToDate(newToDate);
                  setSelectedCandidate(null);

                  // Call mutate directly to use latest date immediately
                  const currentId = ++latestRequestRef.current;
                  availabilityMutation.mutate({
                    salonId: props.salon.id,
                    data: {
                      treatments: cart,
                      fromDate: dateStr,
                      toDate: requestToDate,
                      allowMultipleDays,
                      resultMode: viewMode,
                    }
                  }, {
                    onSuccess: (data) => {
                      if (latestRequestRef.current !== currentId) return;
                      setAvailabilityResponse((current: any) =>
                        viewMode === "calendar" && !allowMultipleDays ? mergeCalendarDay(current, data) : data);
                    },
                    onError: () => {
                      if (latestRequestRef.current !== currentId) return;
                      setAvailabilityResponse({ candidates: [] });
                    }
                  });
                }}
              />

              <div className="flex gap-3 mt-8 pt-6 border-t bg-card sticky bottom-0 z-10 pb-4">
                <Button
                  variant="secondary"
                  className="w-1/3 font-medium"
                  onClick={() => {
                    if (quickFlowCart !== null) {
                      setQuickFlowCart(null);
                      setAvailabilityResponse(null);
                      setSelectedCandidate(null);
                      setStep("CART");
                      return;
                    }
                    setStep("EMPLOYEE");
                  }}
                >
                  {quickFlowCart !== null ? "Izabrani tretmani" : "Nazad"}
                </Button>
                <Button className="flex-1 font-bold shadow-md" disabled={!selectedCandidate || createMutation.isPending} onClick={handleBook}>
                  {createMutation.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : "Zakaži"}
                </Button>
              </div>
            </div>
          )}

          {step === "SUCCESS" && (
            <div className="flex flex-col items-center justify-center text-center animate-in zoom-in-95 duration-500 py-12 flex-1">
              {cart.length > 0 && ContextCard()}
              <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CheckCircle2 className="h-12 w-12" />
              </div>
              <h2 className="mb-3 text-3xl font-serif font-bold text-foreground">Termin potvrđen</h2>
              <p className="mb-8 text-muted-foreground text-sm max-w-[320px]">Vaša grupna rezervacija je uspešno kreirana. Dobićete SMS potvrdu uskoro.</p>
              <div className="mb-8 w-full space-y-3 text-left">
                {completedAppointments.map((appointment) => (
                  <div key={appointment.id} className="rounded-2xl border bg-card p-4 shadow-sm">
                    <p className="font-serif font-bold text-foreground text-base mb-1">{appointment.serviceName}</p>
                    <p className="text-sm font-medium text-primary bg-primary/5 inline-flex px-2 py-0.5 rounded-md mb-2">
                      {format(parseISO(appointment.date), "dd. MMMM yyyy.", { locale: srLatn })} · {appointment.startTime}–{appointment.endTime}
                    </p>
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t text-xs text-muted-foreground">
                      <UserIcon className="w-3.5 h-3.5" />
                      <span>Zaposleni: <strong className="text-foreground">{appointment.employeeName}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
              <Button onClick={() => { resetFlow(); props.onViewAppointments(); }} className="w-full font-bold shadow-md" size="lg">Moji termini</Button>
            </div>
          )}
        </div>
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
           {cartCount > 0 ? `Izabrani tretmani: ${cartCount}` : "Izaberite uslugu i zakažite"}
         </p>
       </div>
        <div className="text-right shrink-0">
          <Button type="button" onClick={onOpen} disabled={cartCount === 0} className="rounded-xl shadow-md h-9 px-4 font-bold">
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