import { useState, useEffect } from "react";
import { type GroupedAvailabilityCandidate, type GroupedAvailabilityResponse } from "@workspace/api-client-react";
import { Clock, Calendar as CalendarIcon, List as ListIcon, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isBefore, isToday, addMonths, subMonths, startOfDay } from "date-fns";
import { srLatn } from "date-fns/locale";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface GroupedAvailabilityViewProps {
  isLoading: boolean;
  viewMode: "list" | "calendar";
  onViewModeChange: (mode: "list" | "calendar") => void;
  availabilityResponse: GroupedAvailabilityResponse | null | undefined;
  salon: any; // Accept SalonProfile or WidgetSalon
  selectedCandidate: GroupedAvailabilityCandidate | null;
  onSelectCandidate: (candidate: GroupedAvailabilityCandidate) => void;
  currentMonth?: Date;
  onMonthChange?: (month: Date) => void;
  fromDate?: string;
  toDate?: string;
  onDateSelect?: (dateStr: string) => void;
}

export function GroupedAvailabilityView({
  isLoading,
  viewMode,
  onViewModeChange,
  availabilityResponse,
  salon,
  selectedCandidate,
  onSelectCandidate,
  currentMonth,
  onMonthChange,
  fromDate,
  toDate,
  onDateSelect,
}: GroupedAvailabilityViewProps) {
  const [internalMonth, setInternalMonth] = useState(() => startOfMonth(new Date()));
  const displayMonth = currentMonth || internalMonth;
  const setDisplayMonth = onMonthChange || setInternalMonth;

  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);

  const calendarDays = availabilityResponse?.calendarDays ?? [];
  const candidates = availabilityResponse?.candidates ?? [];

  useEffect(() => {
    if (calendarDays.length > 0) {
      if (selectedCalendarDate && calendarDays.some((d: any) => d.date === selectedCalendarDate && d.candidates.length > 0)) {
         // Keep selection
      } else {
         const firstAvailable = calendarDays.find((d: any) => d.candidates.length > 0);
         setSelectedCalendarDate(firstAvailable ? firstAvailable.date : null);
      }
    } else {
      setSelectedCalendarDate(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityResponse]);

  const renderCandidate = (c: any, i: number) => {
    return (
      <div
        key={i}
        data-testid={`booking-candidate-${c.date}-${c.startTime}-${i}`}
        aria-label={`Izaberi raspored ${c.date} u ${c.startTime}`}
        className={`p-4 rounded-xl cursor-pointer transition-all border-2 ${selectedCandidate === c ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:border-primary/30 bg-card'}`}
        onClick={() => onSelectCandidate(c)}
        role="button"
        aria-pressed={selectedCandidate === c}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectCandidate(c);
          }
        }}
      >
        <div className="flex justify-between items-center mb-2">
          <span className="font-serif font-bold text-base text-foreground">{format(parseISO(c.date), "dd. MMMM", { locale: srLatn })}</span>
          <span className="font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-md text-sm flex items-center gap-1.5"><Clock className="w-4 h-4" />{c.startTime}</span>
        </div>
        <div className="space-y-1.5 mt-3 border-t pt-3">
          {c.treatments.map((t: any, tidx: number) => {
            const svc = salon.services?.find((s: any) => s.id === t.serviceId);
            const staffList = (salon as any).staff || (salon as any).employees || [];
            const emp = staffList.find((e: any) => e.id === t.employeeId);
            return (
              <div key={tidx} className="flex justify-between items-center text-sm">
                <span className="font-medium truncate pr-3 text-foreground">{svc?.name}</span>
                <span className="text-muted-foreground whitespace-nowrap text-xs">
                  {t.date !== c.date ? `${format(parseISO(t.date), "dd.MM.")} · ` : ""}{t.startTime} • {emp?.name || "Bilo ko"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const hasListCandidates = candidates.some((candidate: any) =>
    candidate.date && candidate.treatments?.every((treatment: any) => treatment.date)
  );

  const monthStart = startOfMonth(displayMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const calendarGrid = eachDayOfInterval({ start: startDate, end: endDate });
  const today = startOfDay(new Date());

  const handlePrevMonth = () => setDisplayMonth(subMonths(displayMonth, 1));
  const handleNextMonth = () => setDisplayMonth(addMonths(displayMonth, 1));

  const dayPeriods = [
    { label: "Pre podne", range: "08:00–12:00", includes: (hour: number) => hour < 12 },
    { label: "Popodne", range: "12:00–17:00", includes: (hour: number) => hour >= 12 && hour < 17 },
    { label: "Veče", range: "17:00–22:00", includes: (hour: number) => hour >= 17 },
  ];

  return (
    <div className="space-y-4">
      <Tabs value={viewMode} onValueChange={(v) => onViewModeChange(v as "list" | "calendar")} className="mb-4">
        <TabsList className="w-full grid grid-cols-2 bg-secondary/40 p-1.5 rounded-xl h-auto">
          <TabsTrigger value="calendar" data-testid="booking-view-calendar" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary py-2 text-sm font-bold">
            <CalendarIcon className="w-4 h-4 mr-2" />
            Kalendar
          </TabsTrigger>
          <TabsTrigger value="list" data-testid="booking-view-list" className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary py-2 text-sm font-bold">
            <ListIcon className="w-4 h-4 mr-2" />
            Lista
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {viewMode === "list" ? (
        isLoading ? (
          <div className="space-y-3"><div className="h-24 bg-muted/50 animate-pulse rounded-xl"/><div className="h-24 bg-muted/50 animate-pulse rounded-xl"/></div>
        ) : hasListCandidates ? (
          <div className="space-y-3 mb-4 animate-in fade-in duration-300">
            {candidates.map((c: any, i: number) => renderCandidate(c, i))}
          </div>
        ) : availabilityResponse ? (
          <div className="text-center p-8 bg-muted/20 rounded-2xl border border-dashed mb-4 animate-in fade-in duration-300">
            <CalendarIcon className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground font-medium">Nema slobodnih termina za izabrani period.</p>
          </div>
        ) : null
      ) : viewMode === "calendar" ? (
        <div className="animate-in fade-in duration-300">
          <div className="bg-card border rounded-2xl p-4 shadow-sm mb-6 relative">
            <div className="flex items-center justify-between mb-4 px-1">
              <button type="button" onClick={handlePrevMonth} disabled={isBefore(monthStart, startOfMonth(today))} className="p-2 rounded-full hover:bg-secondary text-foreground disabled:opacity-30 disabled:hover:bg-transparent transition-colors z-10">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h3 className="font-serif font-bold text-lg capitalize">{format(displayMonth, 'MMMM yyyy', { locale: srLatn })}</h3>
              <button type="button" onClick={handleNextMonth} className="p-2 rounded-full hover:bg-secondary text-foreground transition-colors z-10">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-3 flex items-center justify-center gap-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Slobodno
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                Nema termina
              </span>
            </div>

            <div className="grid grid-cols-7 gap-1 relative z-0">
              {['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned'].map(day => (
                <div key={day} className="text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground py-2">
                  {day}
                </div>
              ))}
              {calendarGrid.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const isPast = isBefore(day, today);
                const isCurrentMonth = isSameMonth(day, displayMonth);
                const isDayToday = isToday(day);

                const fetchedDay = calendarDays.find((d:any) => d.date === dateStr);
                const isFetched = !!fetchedDay || (fromDate && toDate && dateStr >= fromDate && dateStr <= toDate);
                const isAvailable = fetchedDay ? fetchedDay.candidates.length > 0 : false;
                
                const isSelected = selectedCalendarDate === dateStr;

                return (
                  <button
                    key={dateStr}
                    data-testid={`booking-calendar-day-${dateStr}`}
                    aria-label={`${dateStr}${isAvailable ? ", ima slobodnih rasporeda" : ", nema slobodnih rasporeda"}`}
                    type="button"
                    disabled={isPast || isLoading}
                    onClick={() => {
                       if (isPast) return;
                       if (!isFetched && onDateSelect) {
                          onDateSelect(dateStr);
                          setSelectedCalendarDate(dateStr);
                       } else if (isAvailable) {
                          setSelectedCalendarDate(dateStr);
                       } else if (!isFetched) {
                          setSelectedCalendarDate(dateStr);
                       }
                    }}
                    className={`
                       relative flex flex-col items-center justify-center aspect-square rounded-xl text-sm transition-all duration-200
                       ${!isCurrentMonth ? 'opacity-30' : ''}
                       ${isPast ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
                       ${isSelected ? 'bg-primary text-primary-foreground font-bold shadow-md scale-105 z-10' : 'hover:bg-secondary/70 bg-transparent'}
                       ${isDayToday && !isSelected ? 'text-primary font-bold bg-primary/5' : ''}
                    `}
                  >
                    <span className="z-10">{format(day, 'd')}</span>
                    {!isPast && (
                       <div className="absolute bottom-1.5 flex justify-center w-full gap-0.5">
                          {isFetched ? (
                             isAvailable ? <div className={`w-1 h-1 rounded-full ${isSelected ? 'bg-primary-foreground/90' : 'bg-emerald-500'}`} />
                                         : <div className={`w-1 h-1 rounded-full ${isSelected ? 'bg-primary-foreground/30' : 'bg-muted-foreground/30'}`} />
                          ) : (
                             <div className={`w-1 h-1 rounded-full ${isSelected ? 'bg-primary-foreground/50' : 'bg-border'}`} />
                          )}
                       </div>
                    )}
                    {isDayToday && !isSelected && <div className="absolute top-0.5 text-[8px] font-bold text-primary uppercase tracking-tighter">Danas</div>}
                  </button>
                );
              })}
            </div>

            {isLoading && (
               <div className="absolute inset-0 bg-background/50 backdrop-blur-[1px] flex items-center justify-center rounded-2xl z-20">
                  <div className="bg-card shadow-lg px-4 py-2 rounded-xl flex items-center text-primary text-sm font-medium animate-pulse border">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Učitavanje...
                  </div>
               </div>
            )}
          </div>

          {selectedCalendarDate && !isLoading && (
            <div className="animate-in slide-in-from-bottom-2 fade-in duration-400">
              <h4 className="text-sm font-bold mb-4 flex items-center gap-2 text-foreground px-1">
                 <CalendarIcon className="w-4 h-4 text-primary" />
                 Slobodni termini: {format(parseISO(selectedCalendarDate), 'd. MMMM', { locale: srLatn })}
              </h4>
              <div className="space-y-5">
                 {(() => {
                    const candidatesForDay = calendarDays.find((d:any) => d.date === selectedCalendarDate)?.candidates || [];
                    if (candidatesForDay.length === 0) return <p className="text-sm text-muted-foreground text-center py-8 bg-muted/20 rounded-2xl border border-dashed">Nema slobodnih termina za ovaj dan.</p>;
                    return (
                      <>
                        {selectedCandidate && candidatesForDay.includes(selectedCandidate) && (
                          <div>
                            <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Izabrani raspored</p>
                            {renderCandidate(selectedCandidate, -1)}
                          </div>
                        )}

                        {dayPeriods.map((period) => {
                          const periodCandidates = candidatesForDay.filter((candidate: any) => {
                            const hour = Number.parseInt(candidate.startTime?.slice(0, 2) ?? "", 10);
                            return Number.isFinite(hour) && period.includes(hour);
                          });
                          if (periodCandidates.length === 0) return null;
                          return (
                            <section key={period.label} aria-label={`${period.label} ${period.range}`}>
                              <div className="mb-2 flex items-baseline justify-between px-1">
                                <h5 className="text-[11px] font-bold uppercase tracking-[0.16em] text-foreground">{period.label}</h5>
                                <span className="text-[10px] font-medium text-muted-foreground">{period.range}</span>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                {periodCandidates.map((candidate: any, index: number) => {
                                  const isCandidateSelected = selectedCandidate === candidate;
                                  return (
                                    <button
                                      key={`${candidate.date}-${candidate.startTime}-${index}`}
                                      data-testid={`booking-calendar-candidate-${candidate.date}-${candidate.startTime}-${index}`}
                                      aria-label={`Izaberi raspored ${candidate.date} u ${candidate.startTime}`}
                                      type="button"
                                      aria-pressed={isCandidateSelected}
                                      onClick={() => onSelectCandidate(candidate)}
                                      className={`min-h-11 rounded-xl border px-2 py-2 text-sm font-bold transition-all ${
                                        isCandidateSelected
                                          ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                          : "border-border bg-card text-primary hover:border-primary/40 hover:bg-primary/5"
                                      }`}
                                    >
                                      {candidate.startTime}
                                    </button>
                                  );
                                })}
                              </div>
                            </section>
                          );
                        })}
                      </>
                    );
                 })()}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
