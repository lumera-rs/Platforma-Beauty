import { useState, useEffect } from "react";
import { type GroupedAvailabilityCandidate, type GroupedAvailabilityResponse } from "@workspace/api-client-react";
import { Clock, Calendar as CalendarIcon, List as ListIcon } from "lucide-react";
import { formatDateOnly } from "@/lib/date-only";
import { format, parseISO } from "date-fns";
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
}

export function GroupedAvailabilityView({
  isLoading,
  viewMode,
  onViewModeChange,
  availabilityResponse,
  salon,
  selectedCandidate,
  onSelectCandidate,
}: GroupedAvailabilityViewProps) {
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);

  const calendarDays = availabilityResponse?.calendarDays ?? [];
  const candidates = availabilityResponse?.candidates ?? [];

  // Reset selected calendar date when response changes
  useEffect(() => {
    if (calendarDays.length > 0) {
      const firstAvailable = calendarDays.find((d: any) => d.candidates.length > 0);
      if (firstAvailable) {
        setSelectedCalendarDate(firstAvailable.date);
      } else {
        setSelectedCalendarDate(null);
      }
    } else {
      setSelectedCalendarDate(null);
    }
  }, [availabilityResponse]);

  const renderCandidate = (c: any, i: number) => {
    return (
      <div
        key={i}
        className={`p-3 rounded-lg cursor-pointer transition-all border-2 ${selectedCandidate === c ? 'border-primary bg-primary/5 ring-4 ring-primary/10' : 'border-border hover:border-primary/40'}`}
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
        <div className="flex justify-between items-center mb-1">
          <span className="font-bold text-sm">{formatDateOnly(c.date, "dd. MM.")}</span>
          <span className="font-bold text-primary bg-primary/10 px-2 py-0.5 rounded text-sm"><Clock className="w-3.5 h-3.5 inline mr-1" />{c.startTime}</span>
        </div>
        <div className="space-y-1 mt-2">
          {c.treatments.map((t: any, tidx: number) => {
            const svc = salon.services?.find((s: any) => s.id === t.serviceId);
            const staffList = (salon as any).staff || (salon as any).employees || [];
            const emp = staffList.find((e: any) => e.id === t.employeeId);
            return (
              <div key={tidx} className="flex justify-between items-center text-xs">
                <span className="font-medium truncate pr-2 text-muted-foreground">{svc?.name}</span>
                <span className="text-muted-foreground whitespace-nowrap">{t.date !== c.date ? `${formatDateOnly(t.date, "dd.MM.")} · ` : ""}{t.startTime} • {emp?.name || "Bilo ko"}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const hasListCandidates = candidates.some((candidate: any) =>
    formatDateOnly(candidate.date, "yyyy-MM-dd") && candidate.treatments?.every((treatment: any) => formatDateOnly(treatment.date, "yyyy-MM-dd"))
  );

  const hasCalendarDays = calendarDays.length > 0;

  return (
    <div className="space-y-4">
      <Tabs value={viewMode} onValueChange={(v) => onViewModeChange(v as "list" | "calendar")}>
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="list" className="flex items-center gap-2">
            <ListIcon className="w-4 h-4" />
            Lista
          </TabsTrigger>
          <TabsTrigger value="calendar" className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4" />
            Kalendar
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-2"><div className="h-16 bg-muted animate-pulse rounded-lg"/><div className="h-16 bg-muted animate-pulse rounded-lg"/></div>
      ) : viewMode === "list" ? (
        hasListCandidates ? (
          <div className="space-y-2 mb-4">
            {candidates.filter((candidate: any) =>
              formatDateOnly(candidate.date, "yyyy-MM-dd")
              && candidate.treatments?.every((treatment: any) => formatDateOnly(treatment.date, "yyyy-MM-dd"))
            ).map((c: any, i: number) => renderCandidate(c, i))}
          </div>
        ) : availabilityResponse ? (
          <div className="text-center p-6 bg-muted/20 rounded-xl border border-dashed mb-4">
            <p className="text-sm text-muted-foreground">Nema slobodnih termina za ovaj period.</p>
          </div>
        ) : null
      ) : viewMode === "calendar" ? (
        hasCalendarDays ? (
          <div className="space-y-4">
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned'].map(day => (
                <div key={day} className="text-center text-xs font-medium text-muted-foreground py-1">
                  {day}
                </div>
              ))}
              
              {/* Pad first day of the calendar to align with correct weekday */}
              {(() => {
                const firstDay = parseISO(calendarDays[0].date);
                // getDay() returns 0 for Sunday, 1 for Monday. We want 0 for Monday, 6 for Sunday.
                const emptyCells = (firstDay.getDay() + 6) % 7;
                return Array.from({ length: emptyCells }).map((_, i) => (
                  <div key={`empty-${i}`} className="p-2" />
                ));
              })()}
              
              {calendarDays.map((day: any) => {
                const isAvailable = day.candidates.length > 0;
                const isSelected = selectedCalendarDate === day.date;
                const dateObj = parseISO(day.date);
                
                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => {
                      if (isAvailable) setSelectedCalendarDate(day.date);
                    }}
                    disabled={!isAvailable}
                    aria-pressed={isSelected}
                    className={`
                      flex flex-col items-center justify-center p-1 sm:p-2 rounded-lg border transition-colors aspect-square
                      ${isAvailable ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-50 bg-muted/30'}
                      ${isSelected ? 'border-primary bg-primary/10 ring-2 ring-primary/20' : 'border-border'}
                    `}
                  >
                    <span className="text-sm font-semibold">{format(dateObj, 'd')}</span>
                    <span className="text-[10px] uppercase text-muted-foreground">{format(dateObj, 'MMM', { locale: srLatn }).replace('.', '')}</span>
                  </button>
                );
              })}
            </div>

            {selectedCalendarDate && (
              <div className="mt-4 pt-4 border-t animate-in slide-in-from-top-2 duration-300">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-primary" />
                  Slobodni termini za {format(parseISO(selectedCalendarDate), 'd. MMMM', { locale: srLatn })}
                </h3>
                <div className="space-y-2">
                  {calendarDays
                    .find((d: any) => d.date === selectedCalendarDate)
                    ?.candidates.filter((candidate: any) =>
                      formatDateOnly(candidate.date, "yyyy-MM-dd")
                      && candidate.treatments?.every((treatment: any) => formatDateOnly(treatment.date, "yyyy-MM-dd"))
                    )
                    .map((c: any, i: number) => renderCandidate(c, i))}
                </div>
              </div>
            )}
          </div>
        ) : availabilityResponse ? (
          <div className="text-center p-6 bg-muted/20 rounded-xl border border-dashed mb-4">
            <p className="text-sm text-muted-foreground">Nema slobodnih termina za ovaj period.</p>
          </div>
        ) : null
      ) : null}
    </div>
  );
}
