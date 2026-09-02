import { useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, Clock3, List } from "lucide-react";
import { type AvailabilitySearchSlot } from "@workspace/api-client-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAvailabilityViewMode } from "@/hooks/use-availability-view-mode";

type InternalStaffAvailabilityPickerProps = {
  startDate: string;
  slots: AvailabilitySearchSlot[] | undefined;
  isLoading?: boolean;
  error?: unknown;
  selectedSlot?: Pick<AvailabilitySearchSlot, "date" | "startTime" | "employeeId"> | null;
  onSelectSlot: (slot: AvailabilitySearchSlot) => void;
  testId?: string;
};

function dateFromKey(key: string) {
  return new Date(`${key}T12:00:00`);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sevenDays(startDate: string) {
  const start = dateFromKey(startDate);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return dateKey(day);
  });
}

export function InternalStaffAvailabilityPicker({
  startDate,
  slots,
  isLoading = false,
  error,
  selectedSlot,
  onSelectSlot,
  testId = "internal-availability",
}: InternalStaffAvailabilityPickerProps) {
  const [viewMode, setViewMode] = useAvailabilityViewMode();
  const days = useMemo(() => sevenDays(startDate), [startDate]);
  const slotsByDay = useMemo(() => {
    const grouped = new Map<string, AvailabilitySearchSlot[]>();
    for (const slot of slots ?? []) {
      grouped.set(slot.date, [...(grouped.get(slot.date) ?? []), slot]);
    }
    return grouped;
  }, [slots]);
  const [calendarDate, setCalendarDate] = useState<string | null>(null);

  useEffect(() => {
    setCalendarDate((current) => current && days.includes(current) ? current : days.find((day) => slotsByDay.has(day)) ?? null);
  }, [days, slotsByDay]);

  const isSelected = (slot: AvailabilitySearchSlot) =>
    selectedSlot?.date === slot.date && selectedSlot.startTime === slot.startTime && selectedSlot.employeeId === slot.employeeId;

  const renderSlots = (day: string) => {
    const daySlots = slotsByDay.get(day) ?? [];
    if (!daySlots.length) return <p className="text-sm text-muted-foreground" data-testid={`${testId}-unavailable-${day}`}>Nema slobodnih termina.</p>;
    return <div className="flex flex-wrap gap-2">
      {daySlots.map((slot) => (
        <Button
          key={`${slot.date}-${slot.startTime}-${slot.employeeId}`}
          type="button"
          size="sm"
          variant={isSelected(slot) ? "default" : "outline"}
          aria-pressed={isSelected(slot)}
          aria-label={`Izaberite termin ${slot.startTime}, ${slot.employeeName}`}
          data-testid={`${testId}-slot-${slot.date}-${slot.startTime}-${slot.employeeId}`}
          onClick={() => onSelectSlot(slot)}
        >
          <Clock3 className="mr-1 h-3.5 w-3.5" />{slot.startTime}
          <span className="ml-1 max-w-24 truncate text-xs opacity-80">· {slot.employeeName}</span>
        </Button>
      ))}
    </div>;
  };

  return (
    <section className="min-w-0 space-y-3 rounded-xl border bg-muted/20 p-3 sm:p-4" aria-label="Dostupni termini" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-sm font-semibold">Izaberite slobodan termin</h3><p className="text-xs text-muted-foreground">Prikaz je potvrđen rasporedom salona.</p></div>
        <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as "list" | "calendar")}>
          <TabsList aria-label="Prikaz dostupnosti">
            <TabsTrigger value="list" data-testid={`${testId}-view-list`}><List className="mr-1 h-4 w-4" />Lista</TabsTrigger>
            <TabsTrigger value="calendar" data-testid={`${testId}-view-calendar`}><CalendarIcon className="mr-1 h-4 w-4" />Kalendar</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {isLoading ? <div className="space-y-2" aria-live="polite" data-testid={`${testId}-loading`}><div className="h-10 animate-pulse rounded bg-muted" /><div className="h-10 animate-pulse rounded bg-muted" /></div> : error ? (
        <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive" role="alert" data-testid={`${testId}-error`}>Dostupnost trenutno nije moguće učitati.</p>
      ) : viewMode === "list" ? (
        <div className="space-y-3" data-testid={`${testId}-list`}>
          {days.map((day) => <div key={day} className="space-y-2 rounded-lg border bg-background p-3" data-testid={`${testId}-day-${day}`}>
            <h4 className="text-sm font-medium">{dateFromKey(day).toLocaleDateString("sr-RS", { weekday: "long", day: "numeric", month: "long" })}</h4>
            {renderSlots(day)}
          </div>)}
        </div>
      ) : (
        <div className="space-y-3" data-testid={`${testId}-calendar`}>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const available = slotsByDay.has(day);
              const selected = calendarDate === day;
              return <button key={day} type="button" disabled={!available} aria-pressed={selected} aria-label={`${dateFromKey(day).toLocaleDateString("sr-RS")}${available ? ", ima slobodnih termina" : ", nema slobodnih termina"}`} data-testid={`${testId}-calendar-day-${day}`} onClick={() => setCalendarDate(day)} className={cn("min-w-0 rounded-md border p-1 text-center text-xs sm:p-2", available ? "hover:bg-muted" : "cursor-not-allowed bg-muted/40 text-muted-foreground opacity-60", selected && "border-primary bg-primary/10 ring-1 ring-primary")}>
                <span className="block font-semibold">{dateFromKey(day).getDate()}</span><span className="hidden truncate sm:block">{dateFromKey(day).toLocaleDateString("sr-RS", { weekday: "short" })}</span>
              </button>;
            })}
          </div>
          {calendarDate ? <div className="space-y-2 rounded-lg border bg-background p-3"><h4 className="text-sm font-medium">{dateFromKey(calendarDate).toLocaleDateString("sr-RS", { weekday: "long", day: "numeric", month: "long" })}</h4>{renderSlots(calendarDate)}</div> : <p className="text-sm text-muted-foreground" data-testid={`${testId}-empty`}>Nema slobodnih termina u narednih 7 dana.</p>}
        </div>
      )}
    </section>
  );
}