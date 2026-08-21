import { useRef, useMemo, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format, isBefore, startOfDay } from "date-fns";
import { srLatn } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { 
  ChevronRight, Clock, CalendarDays, 
  User as UserIcon, Check, Loader2,
  MapPin, AlertCircle, Heart, X
} from "lucide-react";
import type { SalonProfile, TimeSlot, CurrentUserResponse, Employee } from "@workspace/api-client-react";

export interface BookingWidgetProps {
  salon: SalonProfile;
  user: CurrentUserResponse['user'] | undefined | null;
  eligibleStaff: Employee[];
  selectedService: string | null;
  setSelectedService: (id: string | null) => void;
  selectedEmployee: string | null;
  setSelectedEmployee: (id: string | null) => void;
  isAnyEmployeeSelected: boolean;
  favoriteEmployeeId: string | null;
  setFavorite: (id: string) => Promise<void>;
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  selectedSlot: TimeSlot | null;
  setSelectedSlot: (slot: TimeSlot | null) => void;
  availability: TimeSlot[] | undefined;
  isLoadingAvailability: boolean;
  onBook: () => void;
  isBooking: boolean;
  isSuccess: boolean;
  bookingStatus?: "pending" | "confirmed";
  onViewAppointments: () => void;
  
  step: number;
  setStep: (step: number) => void;
  hasInteractedWithEmployee: boolean;
  setHasInteractedWithEmployee: (val: boolean) => void;
  
  className?: string;
  onCloseMobile?: () => void;
}

export function BookingWidget(props: BookingWidgetProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dateAvailability, setDateAvailability] = useState<Record<string, boolean>>({});

  const service = props.salon.services.find(s => s.id === props.selectedService);
  const employee = props.salon.staff.find(e => e.id === props.selectedEmployee);

  const slotsJutro = useMemo(() => props.availability?.filter(s => parseInt(s.start.split(':')[0], 10) < 12) || [], [props.availability]);
  const slotsPopodne = useMemo(() => props.availability?.filter(s => { const h = parseInt(s.start.split(':')[0], 10); return h >= 12 && h < 17; }) || [], [props.availability]);
  const slotsVece = useMemo(() => props.availability?.filter(s => parseInt(s.start.split(':')[0], 10) >= 17) || [], [props.availability]);
  const today = startOfDay(new Date());
  const dayKey = (date: Date) => format(date, "yyyy-MM-dd");

  useEffect(() => {
    setDateAvailability({});
  }, [props.selectedEmployee, props.selectedService]);

  useEffect(() => {
    if (!props.selectedService || props.isLoadingAvailability || !props.availability) return;
    const key = dayKey(props.selectedDate);
    const hasAvailability = props.availability.length > 0;
    setDateAvailability((current) => current[key] === hasAvailability ? current : { ...current, [key]: hasAvailability });
  }, [props.availability, props.isLoadingAvailability, props.selectedDate, props.selectedService]);

  if (props.isSuccess) {
    const isConfirmed = props.bookingStatus === "confirmed";
    return (
      <Card className={`flex flex-col overflow-hidden bg-card items-center justify-center p-8 text-center space-y-6 ${props.className || ''}`}>
        <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", bounce: 0.5 }}>
          <div className="w-24 h-24 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow-2xl">
            <Check className="w-12 h-12" />
          </div>
        </motion.div>
        <div>
          <motion.h3 initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="text-3xl font-serif font-bold text-foreground mb-2">
            {isConfirmed ? "Termin potvrđen" : "Zahtev za termin je poslat"}
          </motion.h3>
          <motion.p initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="text-muted-foreground text-lg">
            {isConfirmed ? "Vidimo se u salonu!" : "Salon će uskoro potvrditi vaš termin."}
          </motion.p>
        </div>
        <div className="w-full rounded-2xl border border-primary/15 bg-primary/5 p-4 text-left text-sm">
          <p><span className="text-muted-foreground">Usluga:</span> <span className="font-bold">{service?.name}</span></p>
          <p className="mt-2"><span className="text-muted-foreground">Termin:</span> <span className="font-bold">{format(props.selectedDate, "dd.MM.yyyy")} u {props.selectedSlot?.start}</span></p>
        </div>
        <Button type="button" className="w-full rounded-xl" onClick={props.onViewAppointments}>Pregledaj moje termine</Button>
      </Card>
    );
  }

  const steps = [
    { id: 1, label: "Usluga" },
    { id: 2, label: "Zaposleni" },
    { id: 3, label: "Termin" },
    { id: 4, label: "Potvrda" }
  ];

  const SlotBtn = ({ slot }: { slot: TimeSlot }) => {
    const isSelected = props.selectedSlot?.start === slot.start && props.selectedSlot?.employeeId === slot.employeeId;
    return (
      <button
        type="button"
        data-testid={`time-slot-${slot.start}`}
        aria-label={`Izaberi termin u ${slot.start}`}
        onClick={() => { props.setSelectedSlot(slot); props.setStep(4); }}
        className={`py-3 px-1 rounded-xl text-sm font-bold transition-all border outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
          isSelected
            ? 'bg-primary text-primary-foreground border-primary shadow-md scale-[1.02] ring-2 ring-primary/20'
            : 'bg-background hover:border-primary/40 hover:bg-primary/5 text-foreground shadow-sm'
        }`}
      >
        {slot.start}
      </button>
    );
  };

  return (
    <Card className={`flex flex-col overflow-hidden bg-card ${props.className || ''}`}>
      {/* Header */}
      <div className="bg-primary/5 p-4 border-b flex flex-col gap-3 relative shrink-0">
        {props.onCloseMobile && (
          <button onClick={props.onCloseMobile} className="absolute top-4 right-4 p-2 text-muted-foreground hover:bg-muted rounded-full transition-colors lg:hidden">
            <X className="w-5 h-5" />
          </button>
        )}
        <div className="flex items-center gap-3 pr-8">
          <img src={props.salon.imageUrl} alt={props.salon.name} className="w-12 h-12 rounded-full object-cover shadow-sm border-2 border-background shrink-0" />
          <div className="min-w-0">
            <h3 className="font-serif font-bold text-lg leading-tight truncate text-foreground">{props.salon.name}</h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{props.salon.city}</span>
            </p>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-1.5 min-h-[24px]">
          {service && <Badge variant="secondary" className="bg-background shadow-sm text-foreground border-primary/20 text-xs px-2 py-0.5">{service.name}</Badge>}
          {props.hasInteractedWithEmployee && <Badge variant="secondary" className="bg-background shadow-sm text-foreground border-primary/20 text-xs px-2 py-0.5">{props.isAnyEmployeeSelected ? 'Bilo koji zaposleni' : employee ? employee.name : 'Bilo koji zaposleni'}</Badge>}
          {props.selectedSlot && <Badge variant="secondary" className="bg-primary shadow-sm text-primary-foreground border-transparent text-xs px-2 py-0.5">{format(props.selectedDate, 'dd.MM.')} u {props.selectedSlot.start}</Badge>}
        </div>
        {service && (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-background/80 p-2.5 text-xs shadow-sm">
            <span className="flex items-center gap-1 text-muted-foreground"><Clock className="h-3.5 w-3.5" />{service.durationMinutes} min</span>
            <span className="text-right font-bold text-foreground">{service.promoPrice ?? service.price} RSD</span>
          </div>
        )}
      </div>

      {/* Steps Indicator */}
      <div className="px-4 pt-3 pb-6 border-b bg-background shrink-0 shadow-sm z-10">
         <div className="flex items-center justify-between relative max-w-[280px] mx-auto">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-0.5 bg-muted z-0"></div>
            <div className="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 bg-primary z-0 transition-all duration-300" style={{ width: `${((props.step - 1) / (steps.length - 1)) * 100}%` }}></div>
            {steps.map((s) => {
               const isActive = s.id === props.step;
               const isPast = s.id < props.step;
               const canClick = s.id === 1 || 
                               (s.id === 2 && !!service) || 
                               (s.id === 3 && !!service && props.hasInteractedWithEmployee) || 
                               (s.id === 4 && !!service && props.hasInteractedWithEmployee && !!props.selectedSlot);
               
               return (
                  <button type="button" aria-current={isActive ? "step" : undefined} aria-label={`Korak ${s.id}: ${s.label}`} key={s.id} onClick={() => canClick && props.setStep(s.id)} className={`relative z-10 flex flex-col items-center gap-1 bg-background px-1 ${!canClick ? 'cursor-not-allowed opacity-40' : ''}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${isActive ? 'bg-primary text-primary-foreground shadow-sm ring-4 ring-primary/20' : isPast ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                       {isPast ? <Check className="w-3.5 h-3.5" /> : s.id}
                    </div>
                    <span className={`text-[9px] uppercase tracking-wider font-bold absolute -bottom-5 whitespace-nowrap transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>{s.label}</span>
                 </button>
               )
            })}
         </div>
      </div>

      {/* Content Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar relative bg-card/50">
        <div className={props.step === 3 ? "p-3 sm:p-5" : "p-5"}>
          <AnimatePresence mode="wait">
            <motion.div
              key={props.step}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {props.step === 1 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-primary mb-4 flex items-center gap-2">
                    <span className="w-4 h-px bg-primary inline-block"></span>
                    Izaberite uslugu
                  </h4>
                  {props.salon.services.map(s => (
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          props.setSelectedService(s.id);
                          props.setSelectedSlot(null);
                          props.setStep(2);
                        }
                      }}
                      key={s.id} 
                      onClick={() => {
                        props.setSelectedService(s.id);
                        props.setSelectedSlot(null);
                        props.setStep(2);
                      }}
                      className={`p-4 rounded-xl border transition-all cursor-pointer group shadow-sm ${
                        props.selectedService === s.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-card hover:border-primary/40 hover:shadow-md'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-4">
                        <div>
                          <h5 className="font-bold text-foreground leading-tight">{s.name}</h5>
                          <div className="flex items-center gap-3 mt-2 text-xs font-medium text-muted-foreground">
                             <span className="flex items-center gap-1 bg-muted/50 px-2 py-1 rounded-md"><Clock className="w-3.5 h-3.5"/>{s.durationMinutes} min</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {s.promoPrice ? (
                            <div className="flex flex-col items-end">
                              <span className="line-through text-muted-foreground text-[10px]">{s.price} RSD</span>
                              <span className="font-bold text-primary text-sm">{s.promoPrice} RSD</span>
                            </div>
                          ) : (
                            <span className="font-bold text-foreground text-sm">{s.price} RSD</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {props.step === 2 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-primary mb-4 flex items-center gap-2">
                    <span className="w-4 h-px bg-primary inline-block"></span>
                    Izaberite zaposlenog
                  </h4>
                  
                  <div
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        props.setHasInteractedWithEmployee(true);
                        props.setSelectedEmployee(null);
                        props.setSelectedSlot(null);
                        props.setStep(3);
                      }
                    }}
                    onClick={() => {
                      props.setHasInteractedWithEmployee(true);
                      props.setSelectedEmployee(null);
                      props.setSelectedSlot(null);
                      props.setStep(3);
                    }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center gap-4 shadow-sm ${
                      props.isAnyEmployeeSelected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-card hover:border-primary/40'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                      <UserIcon className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h5 className="font-bold text-foreground">Bilo koji zaposleni</h5>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">Sistem bira slobodnog člana tima.</p>
                    </div>
                  </div>

                  {props.eligibleStaff.map(e => (
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          props.setHasInteractedWithEmployee(true);
                          props.setSelectedEmployee(e.id);
                          props.setSelectedSlot(null);
                          props.setStep(3);
                        }
                      }}
                      key={e.id} 
                      onClick={() => {
                        props.setHasInteractedWithEmployee(true);
                        props.setSelectedEmployee(e.id);
                        props.setSelectedSlot(null);
                        props.setStep(3);
                      }}
                      className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between shadow-sm ${
                        props.selectedEmployee === e.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-card hover:border-primary/40'
                      }`}
                    >
                      <div className="flex items-center gap-4 min-w-0 pr-2">
                        <img src={e.avatarUrl || "https://i.pravatar.cc/150"} alt={e.name} className="w-12 h-12 rounded-full object-cover shadow-sm border border-border shrink-0" />
                        <div className="min-w-0">
                          <h5 className="font-bold text-foreground flex items-center gap-2 truncate">
                            {e.name}
                            {e.id === props.favoriteEmployeeId && <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-primary/10 text-primary border-none">Omiljeni</Badge>}
                          </h5>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{e.role}</p>
                        </div>
                      </div>
                      {props.user?.role === "CUSTOMER" && (
                        <button 
                          type="button"
                          aria-label={`Dodaj ${e.name} u omiljene`}
                          onClick={(ev) => { ev.stopPropagation(); props.setFavorite(e.id); }}
                          className="p-2 -mr-2 hover:bg-background rounded-full transition-colors shrink-0"
                          title="Dodaj u omiljene"
                        >
                          <Heart className={`w-5 h-5 transition-colors ${props.favoriteEmployeeId === e.id ? 'fill-primary text-primary' : 'text-muted-foreground'}`} />
                        </button>
                      )}
                    </div>
                  ))}
                  {props.eligibleStaff.length === 0 && (
                    <div className="p-4 bg-amber-50 text-amber-800 rounded-xl border border-amber-200 text-sm font-medium">
                      Trenutno nema zaposlenog dodeljenog ovoj usluzi.
                    </div>
                  )}
                </div>
              )}

              {props.step === 3 && (
                <div className="flex flex-col gap-0 bg-card rounded-2xl border shadow-sm overflow-hidden">
                  {/* Calendar Section */}
                  <div className="p-3 sm:p-6 border-b bg-muted/5 flex flex-col relative z-0">
                    <h4 className="text-sm font-bold tracking-tight text-foreground mb-4 flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-primary/20 flex items-center justify-center">
                         <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                      </span>
                      Izaberite datum
                    </h4>
                    <div className="flex-1 flex justify-center">
                      <Calendar 
                        mode="single"
                        data-testid="booking-calendar"
                        locale={srLatn}
                        selected={props.selectedDate}
                        onSelect={(date) => {
                          if (date) {
                            props.setSelectedDate(date);
                            props.setSelectedSlot(null);
                          }
                        }}
                        fromDate={today}
                        modifiers={{
                          available: (date) => dateAvailability[dayKey(date)] === true,
                          unavailable: (date) => dateAvailability[dayKey(date)] === false,
                        }}
                        modifiersClassNames={{
                          available: "relative after:absolute after:bottom-1.5 after:left-1/2 after:-translate-x-1/2 after:w-1.5 after:h-1.5 after:bg-emerald-500 after:rounded-full font-bold",
                          unavailable: "opacity-45 cursor-not-allowed bg-muted/50",
                        }}
                        className="p-1.5 min-[390px]:p-3"
                        classNames={{
                          root: "w-full max-w-[340px] [--cell-size:2.25rem] min-[360px]:[--cell-size:2.5rem] min-[390px]:[--cell-size:2.75rem]",
                          month_caption: "h-[--cell-size] text-sm font-bold tracking-tight",
                          button_previous: "h-[--cell-size] w-[--cell-size] rounded-xl border border-transparent text-primary hover:border-primary/20 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary",
                          button_next: "h-[--cell-size] w-[--cell-size] rounded-xl border border-transparent text-primary hover:border-primary/20 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary",
                          weekday: "flex-1 select-none rounded-md text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                          day: "group/day relative aspect-square h-full w-full select-none p-0 text-center",
                          day_button: "h-[--cell-size] min-h-[--cell-size] rounded-xl text-sm font-semibold transition-all hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                          today: "border-2 border-primary text-primary font-bold bg-primary/5",
                          outside: "text-muted-foreground/30 opacity-40 pointer-events-none",
                          disabled: "cursor-not-allowed text-muted-foreground/45 opacity-55",
                        }}
                        disabled={(date) => isBefore(startOfDay(date), today) || dateAvailability[dayKey(date)] === false}
                      />
                    </div>

                    <div className="flex items-center justify-center gap-4 mt-6 text-[10px] sm:text-[11px] text-muted-foreground font-medium flex-wrap">
                      <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500"></div>Dostupno</div>
                      <div className="flex items-center gap-1.5"><div className="w-4 h-4 border-2 border-primary bg-primary/5 rounded-md"></div>Danas</div>
                      <div className="flex items-center gap-1.5"><div className="w-4 h-px bg-muted-foreground/40"></div>Nema termina</div>
                    </div>
                  </div>

                  {/* Slots Section */}
                  <div className="p-3 sm:p-6 flex-1 relative flex flex-col z-0">
                    <AnimatePresence>
                      {props.isLoadingAvailability && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 z-10 bg-card/50 backdrop-blur-[2px] flex items-center justify-center"
                        >
                          <div className="bg-background border shadow-lg rounded-xl px-5 py-3 flex items-center gap-3">
                            <Loader2 className="w-5 h-5 animate-spin text-primary" />
                            <span className="text-sm font-bold">Učitavanje termina...</span>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="flex items-center justify-between mb-6">
                      <h4 className="text-sm font-bold tracking-tight text-foreground flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-primary/20 flex items-center justify-center">
                           <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                        </span>
                        Slobodni termini
                      </h4>
                      <span className="text-xs font-semibold text-primary capitalize bg-primary/10 px-2.5 py-1 rounded-md">
                        {format(props.selectedDate, 'EEEE, dd. MMMM', { locale: srLatn })}
                      </span>
                    </div>

                    {!props.isLoadingAvailability && (!props.availability || props.availability.length === 0) ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
                        <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mb-4 border border-border shadow-sm">
                          <CalendarDays className="w-8 h-8 text-muted-foreground/50" />
                        </div>
                        <p className="text-base font-bold text-foreground mb-1">Nema slobodnih termina</p>
                        <p className="text-sm text-muted-foreground">Izaberite drugi datum za pregled dostupnosti.</p>
                      </div>
                    ) : (
                      <div className="space-y-6 flex-1">
                        {slotsJutro.length > 0 && (
                          <div className="space-y-3">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-amber-300 shadow-sm"></span>Jutro (pre 12:00)
                            </p>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                              {slotsJutro.map(slot => <SlotBtn key={`${slot.start}-${slot.employeeId}`} slot={slot} />)}
                            </div>
                          </div>
                        )}
                        {slotsPopodne.length > 0 && (
                          <div className="space-y-3">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-orange-400 shadow-sm"></span>Popodne (12:00 - 17:00)
                            </p>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                              {slotsPopodne.map(slot => <SlotBtn key={`${slot.start}-${slot.employeeId}`} slot={slot} />)}
                            </div>
                          </div>
                        )}
                        {slotsVece.length > 0 && (
                          <div className="space-y-3">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-indigo-400 shadow-sm"></span>Veče (nakon 17:00)
                            </p>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                              {slotsVece.map(slot => <SlotBtn key={`${slot.start}-${slot.employeeId}`} slot={slot} />)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {props.step === 4 && (
                <div className="space-y-6">
                  <div className="text-center pt-2 pb-4">
                    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-primary/20">
                      <Check className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="text-2xl font-serif font-bold text-foreground">Pregled rezervacije</h3>
                    <p className="text-sm text-muted-foreground mt-1">Sve je spremno za potvrdu.</p>
                  </div>
                  
                  <div className="bg-card border rounded-2xl p-5 shadow-sm space-y-4">
                     <div className="flex justify-between items-start gap-4 pb-4 border-b">
                       <div className="text-sm text-muted-foreground font-medium">Usluga</div>
                       <div className="font-bold text-right text-foreground">{service?.name}</div>
                     </div>
                     <div className="flex justify-between items-start gap-4 pb-4 border-b">
                       <div className="text-sm text-muted-foreground font-medium">Zaposleni</div>
                        <div className="text-right text-foreground">
                          <div className="flex items-center justify-end gap-2 font-bold">
                            {!props.isAnyEmployeeSelected && employee && <img src={employee.avatarUrl || "https://i.pravatar.cc/150"} alt={employee.name} className="w-5 h-5 rounded-full object-cover border" />}
                            {props.isAnyEmployeeSelected ? 'Bilo koji zaposleni' : employee ? employee.name : 'Bilo koji dostupan'}
                          </div>
                          {props.isAnyEmployeeSelected && <p className="mt-1 text-xs font-medium text-muted-foreground">Sistem bira slobodnog člana tima.</p>}
                        </div>
                     </div>
                     <div className="flex justify-between items-start gap-4 pb-4 border-b">
                       <div className="text-sm text-muted-foreground font-medium">Vreme</div>
                       <div className="font-bold text-right text-primary bg-primary/10 px-3 py-1 rounded-lg">
                         {format(props.selectedDate, 'dd.MM.yyyy')} u {props.selectedSlot?.start}
                       </div>
                     </div>
                     <div className="flex justify-between items-center pt-2">
                       <div className="text-sm text-muted-foreground font-medium">Za plaćanje u salonu</div>
                        <div className="font-bold text-xl text-foreground">{service?.promoPrice ?? service?.price} RSD</div>
                     </div>
                  </div>

                  {!props.user && (
                    <div className="p-4 bg-amber-50 text-amber-800 rounded-xl border border-amber-200 text-sm font-medium flex gap-3 items-start shadow-sm">
                      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
                      <div className="leading-relaxed">
                        Sistem zahteva prijavu za potvrdu termina. Bićete preusmereni na stranicu za prijavu nakon što kliknete na dugme ispod.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t bg-background shrink-0 flex gap-3 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] relative z-20">
        {props.step > 1 && (
          <Button variant="outline" size="lg" className="w-1/3 rounded-xl border-primary/20 hover:bg-primary/5 text-foreground" onClick={() => props.setStep(props.step - 1)}>
            Nazad
          </Button>
        )}
        {props.step < 4 ? (
          <Button 
            size="lg" 
            className={`rounded-xl shadow-md flex-1 text-base font-bold transition-all ${props.step === 1 ? 'w-full' : 'w-2/3'}`}
            onClick={() => props.setStep(props.step + 1)}
            disabled={
              (props.step === 1 && !service) || 
              (props.step === 2 && !props.hasInteractedWithEmployee) || 
              (props.step === 3 && !props.selectedSlot)
            }
          >
            Dalje <ChevronRight className="w-5 h-5 ml-1" />
          </Button>
        ) : (
          <Button 
            size="lg" 
            className="w-full rounded-xl shadow-lg flex-1 text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground transition-all" 
            onClick={props.onBook} 
            disabled={props.isBooking}
          >
            {props.isBooking && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
            Potvrdi rezervaciju
          </Button>
        )}
      </div>
    </Card>
  );
}

export function MobileBookingTrigger({ salon, selectedService, selectedSlot, onOpen }: { salon: SalonProfile, selectedService: string | null, selectedSlot: TimeSlot | null, onOpen: () => void }) {
  const service = salon.services.find(s => s.id === selectedService);
  return (
    <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] left-4 right-4 z-40 bg-card/95 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-primary/20 p-4 flex items-center justify-between md:bottom-4">
       <div className="flex-1 min-w-0 pr-4">
         <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Vaša rezervacija</p>
         <p className="font-bold text-sm truncate text-foreground">
           {service ? service.name : "Izaberite uslugu i zakažite"}
         </p>
         {selectedSlot && <p className="text-xs text-primary font-medium mt-0.5">{selectedSlot.start} - {selectedSlot.end}</p>}
       </div>
        <div className="text-right shrink-0">
          {service && <p className="text-sm font-bold text-foreground mb-1">{service.promoPrice ?? service.price} RSD</p>}
          <Button type="button" onClick={onOpen} className="rounded-xl shadow-md h-9 px-4 font-bold">
         Zakaži
          </Button>
        </div>
    </div>
  );
}

export function MobileBookingDrawer({ isOpen, onClose, children }: { isOpen: boolean, onClose: () => void, children: React.ReactNode }) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="h-[90dvh] rounded-t-3xl border-0 p-0 flex flex-col overflow-hidden [&>button]:right-4 [&>button]:top-4 [&>button]:z-20">
        <SheetTitle className="sr-only">Zakažite termin</SheetTitle>
        <SheetDescription className="sr-only">Izaberite uslugu, zaposlenog i slobodan termin.</SheetDescription>
        <div className="w-full flex justify-center py-3 bg-background shrink-0" aria-hidden="true">
          <div className="w-12 h-1.5 bg-muted rounded-full" />
        </div>
        <div className="flex-1 overflow-hidden relative">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
