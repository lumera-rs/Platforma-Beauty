import { type ComponentProps, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SearchableCombobox, type SearchableComboboxOption } from "@/components/ui/searchable-combobox";
import { BookingSettingsForm } from "@/components/owner/booking-settings-form";
import { QuickPackageDialog } from "@/components/owner/quick-package-dialog";
import { AppointmentLifecyclePanel } from "@/components/appointment-lifecycle-panel";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  getListSalonAppointmentsQueryKey,
  getListSalonCustomersQueryKey,
  getListSalonEmployeesQueryKey,
  getListSalonServicesQueryKey,
  useCreateSalonAppointment,
  useCreateSalonAppointmentSeries,
  usePreviewSalonAppointmentSeries,
  usePreviewSalonAppointmentSeriesMove,
  useCancelSalonAppointmentSeries,
  useCancelBookingGroup,
  useMoveSalonAppointmentSeries,
  useGetCurrentUser,
  useListSalonAppointments,
  useListSalonCustomers,
  useListSalonEmployees,
  useListSalonServices,
  useUpdateSalonAppointment,
  useUpdateSalonCustomer,
  useListSalonTimeBlocks,
  getListSalonTimeBlocksQueryKey,
  useCreateSalonTimeBlock,
  useDeleteSalonTimeBlock,
  useSearchSalonAvailability,
  getSearchSalonAvailabilityQueryKey,
  useGetSalonCalendarDay,
  getGetSalonCalendarDayQueryKey,
  useOwnerListCustomerPackages,
  getOwnerListCustomerPackagesQueryKey,
  getOwnerListPackagesQueryKey,
  usePreviewSalonPackageAppointments,
  useCreateSalonPackageAppointments,
  type Appointment,
  type EmployeeTimeBlock,
  type GetSalonCalendarDayParams,
  type ListSalonAppointmentsParams,
  type ListSalonTimeBlocksParams,
  type SalonCalendarDayEmployee,
  type SearchSalonAvailabilityParams,
  type PackagePurchase,
  type SalonPackageAppointmentSlot
} from "@workspace/api-client-react";
import { CalendarDays, Clock3, House, Loader2, MapPin, MessageSquareOff, Pencil, Plus, Repeat2, Trash2, UserRoundPlus, Search, Ban, AlignLeft, CalendarRange, Settings } from "lucide-react";

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateAtUtcNoon(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function dateLabel(value: string) {
  return dateAtUtcNoon(value).toLocaleDateString("sr-RS", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function shortDateLabel(value: string) {
  return dateAtUtcNoon(value).toLocaleDateString("sr-RS", { day: "numeric", month: "short" });
}

function appointmentDateKey(value: string | Date) {
  return typeof value === "string" ? value.slice(0, 10) : dateKey(value);
}

const statusLabels = {
  pending: "Na čekanju",
  confirmed: "Potvrđen",
  completed: "Završen",
  cancelled: "Otkazan",
  "no-show": "Nije došao",
} as const;

const statusClasses = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  completed: "border-slate-200 bg-slate-100 text-slate-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-800",
  "no-show": "border-red-200 bg-red-50 text-red-800",
} as const;

function rescheduledConfirmationLabel(value: {
  sms?: { status: string; nextRetryAt?: Date | string | null } | null;
  email?: { status: string; nextRetryAt?: Date | string | null } | null;
} | null | undefined) {
  if (!value) return null;
  const channels = [value.sms, value.email].filter(Boolean);
  if (channels.some((channel) => channel?.status === "queued")) return "Potvrda čeka ponovni pokušaj";
  if (channels.some((channel) => channel?.status === "processing")) return "Potvrda se šalje";
  if (channels.some((channel) => channel?.status === "failed")) return "Potvrda nije poslata";
  if (channels.some((channel) => channel?.status === "sent")) return "Izmenjena potvrda poslata";
  return "Potvrda nije dostupna";
}

function AppointmentDayButton({ day, modifiers, className, ...props }: ComponentProps<typeof CalendarDayButton>) {
  const hasAppointments = Boolean(modifiers.hasAppointments);
  return (
    <CalendarDayButton
      {...props}
      day={day}
      modifiers={modifiers}
      className={cn(
        "!h-11 !min-h-11 !min-w-0 rounded-xl border border-transparent py-1.5 text-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/5 hover:shadow-sm focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary/45 sm:!h-14 sm:!min-h-14",
        modifiers.today && !modifiers.selected && "border-primary/60 bg-primary/[0.035]",
        modifiers.disabled && "cursor-not-allowed border-transparent bg-muted/30 text-muted-foreground/45 opacity-70 hover:translate-y-0 hover:bg-muted/30 hover:shadow-none",
        modifiers.outside && "opacity-25",
        className,
      )}
    >
      <span className="!text-base !font-semibold !opacity-100">{day.date.getDate()}</span>
      <span
        aria-hidden="true"
        className={cn(
          "mt-1 h-1.5 w-1.5 rounded-full bg-transparent transition-colors",
          hasAppointments && "bg-primary",
          modifiers.selected && hasAppointments && "bg-primary-foreground",
        )}
      />
    </CalendarDayButton>
  );
}

const today = dateKey(new Date());
type SeriesSlot = { date: string; startTime: string };
type OwnerBookingForm = { serviceId: string; employeeId: string; date: string; startTime: string; notes: string; customerId: string; firstName: string; lastName: string; phone: string; email: string; recurrence: "daily" | "every-2-days" | "every-3-days" | "weekly" | "biweekly" | "monthly" | "custom"; customDays: string; count: string; packagePurchaseId: string };
type CalendarListItem = (Appointment & { _type: "appointment" }) | (EmployeeTimeBlock & { _type: "block" });
const initialForm: OwnerBookingForm = { serviceId: "", employeeId: "", date: today, startTime: "10:00", notes: "", customerId: "new", firstName: "", lastName: "", phone: "", email: "", recurrence: "weekly", customDays: "7", count: "5", packagePurchaseId: "" };

function buildSeriesSlots(form: OwnerBookingForm): SeriesSlot[] {
  const count = Math.max(1, Math.min(24, Number(form.count) || 1));
  const start = dateAtUtcNoon(form.date);
  const step = form.recurrence === "every-2-days" ? 2 : form.recurrence === "every-3-days" ? 3 : form.recurrence === "custom" ? Math.max(1, Math.min(90, Number(form.customDays) || 1)) : 1;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    if (form.recurrence === "weekly") date.setUTCDate(date.getUTCDate() + index * 7);
    else if (form.recurrence === "biweekly") date.setUTCDate(date.getUTCDate() + index * 14);
    else if (form.recurrence === "monthly") date.setUTCMonth(date.getUTCMonth() + index);
    else date.setUTCDate(date.getUTCDate() + index * step);
    return { date: dateKey(date), startTime: form.startTime };
  });
}

function seriesMoveFingerprint(value: { seriesId: string; dayOffset: string; startTime: string }) {
  return `${value.seriesId}:${value.dayOffset.trim()}:${value.startTime}`;
}

function CalendarTimeline({
  appointments,
  timeBlocks,
  employees,
  onSlotClick,
  onAppointmentClick,
  onBlockClick
}: {
  appointments: Appointment[],
  timeBlocks: EmployeeTimeBlock[],
  employees: SalonCalendarDayEmployee[],
  onSlotClick: (empId: string, time: string) => void,
  onAppointmentClick: (a: Appointment) => void,
  onBlockClick: (b: EmployeeTimeBlock) => void
}) {
  const START_HOUR = 8;
  const END_HOUR = 22;
  const hours = Array.from({length: END_HOUR - START_HOUR + 1}, (_, i) => START_HOUR + i);
  const PIXELS_PER_MINUTE = 1.6;
  const containerHeight = (END_HOUR - START_HOUR) * 60 * PIXELS_PER_MINUTE;

  const timeToMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const getTop = (timeStr: string) => {
    return Math.max(0, (timeToMinutes(timeStr) - START_HOUR * 60) * PIXELS_PER_MINUTE);
  };

  const getHeight = (startStr: string, endStr: string) => {
    return Math.max(15, (timeToMinutes(endStr) - timeToMinutes(startStr)) * PIXELS_PER_MINUTE);
  };

  const isSlotAvailable = (emp: SalonCalendarDayEmployee, timeStr: string) => {
    if (emp.unavailable) return false;
    const slotStart = timeToMinutes(timeStr);
    const slotEnd = slotStart + 30;

    let inWorkingHours = false;
    if (!emp.hasExplicitSchedule) {
      inWorkingHours = true;
    } else {
      for (const w of emp.scheduleWindows) {
        const wStart = timeToMinutes(w.startTime);
        const wEnd = timeToMinutes(w.endTime);
        if (slotStart >= wStart && slotEnd <= wEnd) {
          if (w.breakStart && w.breakEnd) {
            const bStart = timeToMinutes(w.breakStart);
            const bEnd = timeToMinutes(w.breakEnd);
            if (!(slotEnd <= bStart || slotStart >= bEnd)) {
              continue;
            }
          }
          inWorkingHours = true;
          break;
        }
      }
    }
    if (!inWorkingHours) return false;

    // Check blocks
    for (const b of timeBlocks) {
      if (b.employeeId !== emp.employeeId) continue;
      const bStart = timeToMinutes(b.startTime);
      const bEnd = timeToMinutes(b.endTime);
      if (!(slotEnd <= bStart || slotStart >= bEnd)) return false;
    }

    // Check appointments
    for (const a of appointments) {
      if (a.employeeId !== emp.employeeId && (a.employeeId !== null || employees.length > 1)) continue;
      if (a.status === "cancelled") continue;
      const aStart = timeToMinutes(a.startTime);
      const aEnd = timeToMinutes(a.endTime);
      if (!(slotEnd <= aStart || slotStart >= aEnd)) return false;
    }

    return true;
  };

  return (
    <div className="relative max-h-[65vh] w-full min-w-0 max-w-full flex-1 overflow-auto rounded-xl border bg-background shadow-sm custom-scrollbar" data-testid="calendar-timeline">
      <div className="min-w-[700px] flex flex-col">
        <div className="flex border-b bg-muted/50 sticky top-0 z-30 backdrop-blur-md">
          <div className="w-16 flex-none border-r bg-muted/50"></div>
          {employees.map(emp => (
            <div key={emp.employeeId} className="flex-1 border-r min-w-[150px] p-2.5 text-center font-semibold truncate text-sm">
              {emp.name}
            </div>
          ))}
        </div>
        <div className="flex relative" style={{ height: containerHeight }}>
          <div className="w-16 flex-none border-r bg-muted/5 relative">
            {hours.map(h => (
              <div key={h} className="absolute w-full text-right pr-2 text-xs text-muted-foreground font-medium"
                   style={{ top: Math.max(2, (h - START_HOUR) * 60 * PIXELS_PER_MINUTE - 7) }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
            {hours.map(h => (
              <div key={`line-${h}`} className="absolute w-full border-t border-border/60"
                   style={{ top: (h - START_HOUR) * 60 * PIXELS_PER_MINUTE }}>
              </div>
            ))}
          </div>
          {employees.map(emp => (
            <div key={emp.employeeId} className="flex-1 border-r relative min-w-[150px] bg-background">
              {hours.map(h => (
                <div key={`grid-${h}`} className="absolute w-full border-t border-border/40"
                     style={{ top: (h - START_HOUR) * 60 * PIXELS_PER_MINUTE }}>
                </div>
              ))}

              {/* Unavailable / Outside Schedule Rendering */}
              {emp.unavailable ? (
                <div className="absolute inset-0 bg-muted/30 z-0 flex items-center justify-center pointer-events-none" title={emp.unavailableReason || "Nedostupno"}>
                  <div className="rotate-90 sm:rotate-0 text-muted-foreground font-medium flex items-center gap-2 whitespace-nowrap"><Ban className="h-4 w-4"/> {emp.unavailableReason || "Nedostupno"}</div>
                </div>
              ) : (
                emp.hasExplicitSchedule && (
                  <>
                    <div className="absolute inset-x-0 top-0 bg-muted/30 z-0 pointer-events-none" style={{ height: getTop(emp.scheduleWindows[0]?.startTime || "08:00") }} />
                    <div className="absolute inset-x-0 bottom-0 bg-muted/30 z-0 pointer-events-none" style={{ top: getTop(emp.scheduleWindows[emp.scheduleWindows.length - 1]?.endTime || "22:00"), bottom: 0 }} />
                    {emp.scheduleWindows.map((w, i) => w.breakStart && w.breakEnd ? (
                      <div key={`break-${i}`} className="absolute inset-x-0 bg-muted/30 z-0 flex items-center justify-center pointer-events-none" style={{ top: getTop(w.breakStart), height: getHeight(w.breakStart, w.breakEnd) }}>
                        <span className="text-xs text-muted-foreground font-medium">Pauza</span>
                      </div>
                    ) : null)}
                  </>
                )
              )}

              {!emp.unavailable && Array.from({length: (END_HOUR - START_HOUR) * 2}).map((_, i) => {
                const hour = START_HOUR + Math.floor(i / 2);
                const min = (i % 2) * 30;
                const timeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
                const available = isSlotAvailable(emp, timeStr);
                const style = {
                  top: (hour - START_HOUR) * 60 * PIXELS_PER_MINUTE + min * PIXELS_PER_MINUTE,
                  height: 30 * PIXELS_PER_MINUTE,
                };
                return available ? (
                  <button
                    key={timeStr}
                    type="button"
                    data-testid={`timeline-slot-${emp.employeeId}-${timeStr}`}
                    aria-label={`Zakaži termin za ${emp.name} u ${timeStr}`}
                    className="absolute z-0 w-full border-0 bg-emerald-50/25 transition-colors hover:bg-primary/10 focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    style={style}
                    onClick={() => onSlotClick(emp.employeeId, timeStr)}
                  />
                ) : (
                  <div
                    key={timeStr}
                    data-testid={`timeline-slot-${emp.employeeId}-${timeStr}`}
                    aria-hidden="true"
                    className="pointer-events-none absolute z-0 w-full bg-muted/10"
                    style={style}
                  />
                );
              })}

              {appointments.filter(a => (a.employeeId === emp.employeeId) || (a.employeeId === null && employees.length === 1)).filter(a => a.status !== "cancelled").map(a => (
                <div key={a.id}
                     data-testid={`timeline-appointment-${a.id}`}
                     className={cn("absolute inset-x-1.5 rounded-lg border p-2 text-xs overflow-hidden cursor-pointer shadow-sm hover:shadow-md transition-all z-10 flex flex-col", a.status === "no-show" ? "bg-muted/50 border-muted-foreground/30 grayscale hover:grayscale-0" : "bg-primary/10 border-primary/20 hover:ring-1 ring-primary/40")}
                     style={{ top: getTop(a.startTime), height: getHeight(a.startTime, a.endTime) }}
                     onClick={(e) => { e.stopPropagation(); onAppointmentClick(a); }}>
                  <div className={cn("font-bold truncate leading-tight mb-0.5", a.status === "no-show" ? "text-muted-foreground" : "text-primary")}>{a.startTime} · {a.customerName}</div>
                  <div className={cn("truncate leading-tight font-medium", a.status === "no-show" ? "text-muted-foreground/80" : "text-primary/80")}>{a.bookingGroupId ? "Grupa · " : ""}{a.serviceName}</div>
                </div>
              ))}

              {timeBlocks.filter(b => b.employeeId === emp.employeeId).map(b => (
                <div key={b.id}
                     data-testid={`timeline-block-${b.id}`}
                     className="absolute inset-x-1.5 rounded-lg bg-rose-50 border border-rose-200 p-2 text-xs overflow-hidden cursor-pointer shadow-sm hover:shadow-md hover:ring-1 ring-rose-300 transition-all z-10 flex flex-col opacity-90 hover:opacity-100"
                     style={{ top: getTop(b.startTime), height: getHeight(b.startTime, b.endTime) }}
                     onClick={(e) => { e.stopPropagation(); onBlockClick(b); }}>
                  <div className="font-bold text-rose-800 truncate leading-tight mb-0.5"><Ban className="inline h-3 w-3 mr-1"/> Nedostupno</div>
                  {b.reason && <div className="truncate text-rose-700/90 leading-tight font-medium">{b.reason}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function OwnerCalendar() {
  const { data: userResp } = useGetCurrentUser();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [viewMode, setViewMode] = useState<"list" | "timeline">("timeline");
  const [filterEmployeeId, setFilterEmployeeId] = useState("");
  const [filterServiceId, setFilterServiceId] = useState("");

  const calendarDayParams = useMemo<GetSalonCalendarDayParams>(() => ({ date: selectedDate ?? today }), [selectedDate]);
  const { data: calendarDayData, isFetching: calendarDayFetching, error: calendarDayError } = useGetSalonCalendarDay(calendarDayParams, {
    query: {
      enabled: !!userResp?.user && !!selectedDate,
      queryKey: getGetSalonCalendarDayQueryKey(calendarDayParams),
    },
  });

  const appointmentParams = useMemo<ListSalonAppointmentsParams>(() => ({
    from: selectedDate ?? today,
    to: selectedDate ?? today,
    ...(filterEmployeeId ? { employeeId: filterEmployeeId } : {}),
    ...(filterServiceId ? { serviceId: filterServiceId } : {})
  }), [selectedDate, filterEmployeeId, filterServiceId]);

  const { data: appointments, isLoading, isFetching, error: appointmentsError, refetch: refetchAppointments } = useListSalonAppointments(appointmentParams, {
    query: {
      enabled: !!userResp?.user && !!selectedDate,
      queryKey: getListSalonAppointmentsQueryKey(appointmentParams),
    },
  });

  const unfilteredAppointmentParams = useMemo<ListSalonAppointmentsParams>(() => ({
    from: selectedDate ?? today,
    to: selectedDate ?? today,
  }), [selectedDate]);

  const { data: unfilteredAppointments, isFetching: unfilteredFetching, refetch: refetchUnfilteredAppointments } = useListSalonAppointments(unfilteredAppointmentParams, {
    query: {
      enabled: !!userResp?.user && !!selectedDate,
      queryKey: getListSalonAppointmentsQueryKey(unfilteredAppointmentParams),
    },
  });

  const timeBlocksParams = useMemo<ListSalonTimeBlocksParams>(() => ({
    date: selectedDate ?? today,
    ...(filterEmployeeId ? { employeeId: filterEmployeeId } : {})
  }), [selectedDate, filterEmployeeId]);

  const { data: timeBlocks, error: timeBlocksError, refetch: refetchTimeBlocks } = useListSalonTimeBlocks(timeBlocksParams, {
    query: {
      enabled: !!userResp?.user && !!selectedDate,
      queryKey: getListSalonTimeBlocksQueryKey(timeBlocksParams),
    }
  });

  const monthParams = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    return {
      from: dateKey(new Date(year, month, 1)),
      to: dateKey(new Date(year, month + 1, 0)),
    };
  }, [visibleMonth]);
  const { data: monthAppointments, refetch: refetchMonthAppointments } = useListSalonAppointments(monthParams, {
    query: {
      enabled: !!userResp?.user,
      queryKey: getListSalonAppointmentsQueryKey(monthParams),
    },
  });
  const { data: services } = useListSalonServices({ query: { enabled: !!userResp?.user, queryKey: getListSalonServicesQueryKey() } });
  const { data: employees } = useListSalonEmployees({ query: { enabled: !!userResp?.user, queryKey: getListSalonEmployeesQueryKey() } });
  const CUSTOMERS_PAGE_SIZE = 25;
  const [customersPage, setCustomersPage] = useState(1);
  const customersParams = useMemo(() => ({ page: customersPage, pageSize: CUSTOMERS_PAGE_SIZE }), [customersPage]);
  const { data: customers, refetch: refetchCustomers } = useListSalonCustomers(customersParams, { query: { enabled: !!userResp?.user, queryKey: getListSalonCustomersQueryKey(customersParams) } });
  const customerOptions = useMemo<SearchableComboboxOption[]>(() => (customers ?? []).map((customer) => ({
    value: customer.id,
    label: `${customer.firstName} ${customer.lastName} · ${customer.phone ?? "bez telefona"}`,
    keywords: `${customer.firstName} ${customer.lastName} ${customer.phone ?? ""}`,
  })), [customers]);
  const serviceOptions = useMemo<SearchableComboboxOption[]>(() => (services ?? [])
    .filter((service) => service.active)
    .map((service) => ({ value: service.id, label: `${service.name} · ${service.durationMinutes} min`, keywords: service.name })), [services]);

  const create = useCreateSalonAppointment();
  const createSeries = useCreateSalonAppointmentSeries();
  const previewSeries = usePreviewSalonAppointmentSeries();
  const previewSeriesMove = usePreviewSalonAppointmentSeriesMove();
  const cancelSeries = useCancelSalonAppointmentSeries();
  const cancelGroup = useCancelBookingGroup();
  const moveSeries = useMoveSalonAppointmentSeries();
  const updateAppointment = useUpdateSalonAppointment();
  const updateCustomer = useUpdateSalonCustomer();
  const createBlock = useCreateSalonTimeBlock();
  const deleteBlock = useDeleteSalonTimeBlock();
  const previewPackageSeries = usePreviewSalonPackageAppointments();
  const createPackageSeries = useCreateSalonPackageAppointments();
  const queryClient = useQueryClient();

  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [bookingMode, setBookingMode] = useState<"standard" | "package">("standard");
  const [form, setForm] = useState(initialForm);
  const currentBookingContextRef = useRef({
    open,
    mode: bookingMode,
    customerId: form.customerId,
    serviceId: form.serviceId,
  });
  currentBookingContextRef.current = {
    open,
    mode: bookingMode,
    customerId: form.customerId,
    serviceId: form.serviceId,
  };
  const [isSeries, setIsSeries] = useState(false);
  const [seriesSlots, setSeriesSlots] = useState<SeriesSlot[]>([]);

  const { data: customerPackages, refetch: refetchCustomerPackages } = useOwnerListCustomerPackages(
    { salonCustomerId: form.customerId, status: 'active' },
    { query: { enabled: !!userResp?.user && form.customerId !== "" && form.customerId !== "new", queryKey: getOwnerListCustomerPackagesQueryKey({ salonCustomerId: form.customerId, status: 'active' }) } }
  );

  type PackagePlannerRow = { id: string; serviceId: string; employeeId: string; date: string; startTime: string };
  const [packagePlannerPackageId, setPackagePlannerPackageId] = useState("");
  const [packagePlannerRows, setPackagePlannerRows] = useState<PackagePlannerRow[]>([]);
  const updatePackagePlannerRow = (index: number, patch: Partial<PackagePlannerRow>) => {
    previewPackageSeries.reset();
    setPackagePlannerRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const applyPlannerPackage = (pkg: PackagePurchase | undefined) => {
    if (!pkg) {
      setPackagePlannerPackageId("");
      setPackagePlannerRows([]);
      previewPackageSeries.reset();
      return;
    }
    setPackagePlannerPackageId(pkg.id);
    const newRows: PackagePlannerRow[] = [];
    if (pkg.quotaPolicy === 'per_service') {
      pkg.serviceQuotas.forEach(q => {
        for (let i = 0; i < q.remainingQuota; i++) {
          newRows.push({
            id: Math.random().toString(36).slice(2),
            serviceId: q.serviceId,
            employeeId: "",
            date: today,
            startTime: "10:00"
          });
        }
      });
    } else if (pkg.quotaPolicy === 'shared_pool') {
      const firstCoveredServiceId = pkg.serviceQuotas[0]?.serviceId || "";
      for (let i = 0; i < pkg.remainingSessions; i++) {
        newRows.push({
          id: Math.random().toString(36).slice(2),
          serviceId: firstCoveredServiceId,
          employeeId: "",
          date: today,
          startTime: "10:00"
        });
      }
    }
    setPackagePlannerRows(newRows);
    previewPackageSeries.reset();
  };
  const handlePlannerPackageChange = (id: string) => {
    applyPlannerPackage(customerPackages?.find(p => p.id === id));
  };
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [seriesMove, setSeriesMove] = useState<{ seriesId: string; dayOffset: string; startTime: string } | null>(null);
  const [seriesMovePreviewKey, setSeriesMovePreviewKey] = useState<string | null>(null);
  const hasCurrentSeriesMovePreview = Boolean(seriesMove && seriesMovePreviewKey === seriesMoveFingerprint(seriesMove));

  const [searchParams, setSearchParams] = useState<SearchSalonAvailabilityParams | null>(null);
  const activeSearchParams = searchParams ?? { serviceId: "", startDate: today };
  const { data: searchResults, isFetching: searchFetching, error: searchError, refetch: refetchSearch } = useSearchSalonAvailability(
    activeSearchParams,
    { query: { enabled: !!searchParams, queryKey: getSearchSalonAvailabilityQueryKey(activeSearchParams) } }
  );
  const [searchForm, setSearchForm] = useState({ serviceId: "", startDate: today, employeeId: "" });
  const searchHasRun = searchParams !== null;

  const [blockOpen, setBlockOpen] = useState(false);
  const [blockForm, setBlockForm] = useState({ date: today, startTime: "09:00", endTime: "10:00", employeeId: "", reason: "" });

  type QuickPackageContext = {
    id: string;
    mode: "standard" | "package";
    customerId: string;
    serviceId: string;
  };
  const [quickPackageContext, setQuickPackageContext] = useState<QuickPackageContext | null>(null);
  const quickPackageContextRef = useRef<QuickPackageContext | null>(null);
  const openQuickPackage = (mode: QuickPackageContext["mode"]) => {
    const context = {
      id: crypto.randomUUID(),
      mode,
      customerId: form.customerId,
      serviceId: form.serviceId,
    };
    quickPackageContextRef.current = context;
    setQuickPackageContext(context);
  };
  const closeQuickPackage = () => {
    quickPackageContextRef.current = null;
    setQuickPackageContext(null);
  };

  const sortedList = useMemo<CalendarListItem[]>(() => {
    const a = (appointments ?? []).map(x => ({ ...x, _type: 'appointment' as const }));
    const b = (timeBlocks ?? []).map(x => ({ ...x, _type: 'block' as const }));
    return [...a, ...b].sort((x, y) => x.startTime.localeCompare(y.startTime));
  }, [appointments, timeBlocks]);

  const appointmentDateKeys = useMemo(() => new Set((monthAppointments ?? []).map((appointment) => appointmentDateKey(appointment.date))), [monthAppointments]);
  const quickDates = useMemo(() => {
    const base = new Date();
    return [
      { label: "Danas", value: dateKey(base) },
      { label: "Sutra", value: dateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1)) },
      { label: "Prekosutra", value: dateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 2)) },
    ];
  }, []);

  const selectDate = (value: string) => {
    setSelectedDate(value);
    const selected = dateAtUtcNoon(value);
    setVisibleMonth(new Date(selected.getUTCFullYear(), selected.getUTCMonth(), 1));
    setForm((current) => ({ ...current, date: value }));
  };

  const openNewAppointment = (overrides?: Partial<OwnerBookingForm>) => {
    setForm({ ...initialForm, date: selectedDate ?? today, ...overrides });
    setIsSeries(false);
    setBookingMode("standard");
    setSeriesSlots([]);
    setPackagePlannerPackageId("");
    setPackagePlannerRows([]);
    previewSeries.reset();
    previewPackageSeries.reset();
    setOpen(true);
  };

  const openNewTimeBlock = () => {
    setBlockForm({ date: selectedDate ?? today, startTime: "09:00", endTime: "10:00", employeeId: employees?.[0]?.id ?? "", reason: "" });
    setBlockOpen(true);
  };

  useEffect(() => { previewSeries.reset(); }, [form.serviceId, form.employeeId, form.packagePurchaseId, form.customerId, seriesSlots]);
  useEffect(() => { previewSeriesMove.reset(); setSeriesMovePreviewKey(null); }, [seriesMove?.seriesId, seriesMove?.dayOffset, seriesMove?.startTime]);

  const createAppointment = (event: React.FormEvent) => {
    event.preventDefault();
    if (form.customerId === "new" && (!form.firstName.trim() || !form.lastName.trim() || !form.phone.trim())) {
      toast.error("Unesite ime, prezime i telefon gosta.");
      return;
    }
    if (isSeries) {
      if (!seriesSlots.length) { toast.error("Prvo primenite pravilo ponavljanja."); return; }
      if (!previewSeries.data?.allAvailable) { toast.error("Pregledom potvrdite da su svi termini dostupni."); return; }
      if (previewSeries.data?.packageEligible === false) { toast.error(`Paket problem: ${previewSeries.data.packageReason}`); return; }
      createSeries.mutate({
        data: {
          serviceId: form.serviceId, employeeId: form.employeeId || null, notes: form.notes || undefined,
          slots: seriesSlots,
          packagePurchaseId: form.packagePurchaseId || undefined,
          ...(form.customerId === "new"
            ? { guest: { firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone.trim(), ...(form.email.trim() ? { email: form.email.trim() } : {}) } }
            : { salonCustomerId: form.customerId }),
        },
      }, {
        onSuccess: () => {
          toast.success("Serija termina je sačuvana", { description: "Svaki termin ima zasebnu SMS i e-mail potvrdu kada su podaci dostupni." });
          setOpen(false); selectDate(seriesSlots[0]!.date); setForm(initialForm); setSeriesSlots([]); refetchAppointments(); refetchUnfilteredAppointments(); refetchCustomers(); refetchCustomerPackages();
        },
        onError: (error) => toast.error("Serija nije sačuvana", { description: error instanceof Error ? error.message : "Ponovo proverite dostupnost." }),
      });
      return;
    }
    create.mutate({
      data: {
        serviceId: form.serviceId,
        employeeId: form.employeeId || null,
        date: form.date,
        startTime: form.startTime,
        notes: form.notes || undefined,
        packagePurchaseId: form.packagePurchaseId || undefined,
        ...(form.customerId === "new"
          ? { guest: { firstName: form.firstName.trim(), lastName: form.lastName.trim(), phone: form.phone.trim(), ...(form.email.trim() ? { email: form.email.trim() } : {}) } }
          : { salonCustomerId: form.customerId }),
      },
    }, {
      onSuccess: () => {
        toast.success("Termin je sačuvan", { description: "Potvrda je evidentirana za SMS slanje ako klijent prima obaveštenja." });
        setOpen(false);
        selectDate(form.date);
        setForm(initialForm);
        refetchAppointments();
        refetchUnfilteredAppointments();
        refetchCustomers();
        refetchCustomerPackages();
      },
      onError: (error) => toast.error("Termin nije sačuvan", { description: error instanceof Error ? error.message : "Proverite dostupnost termina." }),
    });
  };

  const submitPlanner = (e: React.FormEvent) => {
    e.preventDefault();
    if (!previewPackageSeries.data?.allAvailable || !previewPackageSeries.data?.packageEligible) {
      toast.error("Prvo proverite i potvrdite da su svi termini slobodni.");
      return;
    }
    createPackageSeries.mutate({
      data: {
        packagePurchaseId: packagePlannerPackageId,
        slots: packagePlannerRows.map(r => ({
          serviceId: r.serviceId,
          date: r.date,
          startTime: r.startTime,
          employeeId: r.employeeId || null,
        }))
      }
    }, {
      onSuccess: () => {
        toast.success("Ceo paket je raspoređen.");
        setOpen(false);
        const firstDate = packagePlannerRows[0]?.date;
        if (firstDate) selectDate(firstDate);
        refetchAppointments();
        refetchUnfilteredAppointments();
        refetchCustomers();
        refetchCustomerPackages();
      },
      onError: (err) => toast.error("Paket nije sačuvan", { description: err instanceof Error ? err.message : "Pokušajte ponovo." })
    });
  };

  const handleCreateBlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockForm.employeeId) {
      toast.error("Izaberite zaposlenog.");
      return;
    }
    if (!blockForm.reason.trim()) {
      toast.error("Unesite razlog blokiranja.");
      return;
    }
    if (blockForm.startTime >= blockForm.endTime) {
      toast.error("Vreme kraja mora biti nakon vremena početka.");
      return;
    }
    createBlock.mutate({ data: blockForm }, {
      onSuccess: () => {
        toast.success("Vreme je blokirano.");
        setBlockOpen(false);
        refetchTimeBlocks();
        if (searchHasRun) refetchSearch();
      },
      onError: (err) => toast.error("Greška pri blokiranju vremena.", { description: err instanceof Error ? err.message : "Pokušajte ponovo." })
    });
  };

  const handleDeleteBlock = (id: string) => {
    if (confirm("Da li ste sigurni da želite da uklonite ovaj blok?")) {
      deleteBlock.mutate({ timeBlockId: id }, {
        onSuccess: () => {
          toast.success("Blok uklonjen.");
          refetchTimeBlocks();
          if (searchHasRun) refetchSearch();
        },
        onError: (err) => toast.error("Blok nije uklonjen", { description: err instanceof Error ? err.message : "Pokušajte ponovo." })
      });
    }
  };

  const saveAppointmentUpdate = () => {
    if (!editing) return;
    updateAppointment.mutate({ appointmentId: editing.id, data: { ...(editing.employeeId ? { employeeId: editing.employeeId } : {}), notes: editing.notes ?? "" } }, {
      onSuccess: () => { toast.success("Termin je izmenjen"); setEditing(null); refetchAppointments(); refetchUnfilteredAppointments(); },
      onError: (error) => toast.error("Termin nije izmenjen", { description: error instanceof Error ? error.message : "Pokušajte ponovo." }),
    });
  };

  const runSeriesPreview = () => {
    if (!form.serviceId || !seriesSlots.length) { toast.error("Izaberite uslugu i primenite pravilo serije."); return; }
    previewSeries.mutate({ data: { serviceId: form.serviceId, employeeId: form.employeeId || null, slots: seriesSlots, packagePurchaseId: form.packagePurchaseId || null, salonCustomerId: form.customerId !== "new" ? form.customerId : null } });
  };

  const runPlannerPreview = () => {
    if (!packagePlannerPackageId || !packagePlannerRows.length) return;
    previewPackageSeries.mutate({
      data: {
        packagePurchaseId: packagePlannerPackageId,
        slots: packagePlannerRows.map(r => ({
          serviceId: r.serviceId,
          date: r.date,
          startTime: r.startTime,
          employeeId: r.employeeId || null,
        }))
      }
    });
  };

  const openSeriesMove = (seriesId: string) => {
    setEditing(null);
    setSeriesMovePreviewKey(null);
    setSeriesMove({ seriesId, dayOffset: "7", startTime: "" });
  };

  const seriesMoveData = () => {
    if (!seriesMove) return null;
    const dayOffset = Number(seriesMove.dayOffset);
    if (!Number.isInteger(dayOffset) || dayOffset < -365 || dayOffset > 365) {
      toast.error("Unesite ceo broj dana od -365 do 365.");
      return null;
    }
    if (dayOffset === 0 && !seriesMove.startTime) {
      toast.error("Unesite broj dana za pomeranje ili novo vreme.");
      return null;
    }
    return { dayOffset, ...(seriesMove.startTime ? { startTime: seriesMove.startTime } : {}) };
  };

  const runSeriesMovePreview = () => {
    const data = seriesMoveData();
    if (!seriesMove || !data) return;
    const requestKey = seriesMoveFingerprint(seriesMove);
    setSeriesMovePreviewKey(null);
    previewSeriesMove.mutate({ seriesId: seriesMove.seriesId, data }, {
      onSuccess: () => setSeriesMovePreviewKey(requestKey),
      onError: (error) => toast.error("Pregled pomeranja nije uspeo", { description: error instanceof Error ? error.message : "Pokušajte ponovo." }),
    });
  };

  const confirmSeriesMove = () => {
    const data = seriesMoveData();
    if (!seriesMove || !data) return;
    if (!hasCurrentSeriesMovePreview || !previewSeriesMove.data?.allAvailable) {
      toast.error("Pre potvrde rešite sve prikazane konflikte.");
      return;
    }
    moveSeries.mutate({ seriesId: seriesMove.seriesId, data }, {
      onSuccess: (result) => {
        toast.success(`Pomerena su ${result.movedAppointments} termina iz serije.`, { description: "Klijent dobija ažuriranu potvrdu za svaki promenjeni termin." });
        const firstDate = result.appointments[0] ? appointmentDateKey(result.appointments[0].date) : null;
        setSeriesMove(null);
        setSeriesMovePreviewKey(null);
        previewSeriesMove.reset();
        refetchAppointments();
        refetchUnfilteredAppointments();
        refetchMonthAppointments();
        refetchCustomers();
        if (firstDate) selectDate(firstDate);
      },
      onError: (error) => toast.error("Serija nije pomerena", { description: error instanceof Error ? error.message : "Nijedan termin nije izmenjen. Proverite konflikte i pokušajte ponovo." }),
    });
  };

  const timelineEmployees = calendarDayData ? (filterEmployeeId ? calendarDayData.filter(e => e.employeeId === filterEmployeeId) : calendarDayData) : [];

  function getEligiblePackageOptions(packages: PackagePurchase[], serviceId: string) {
    if (!serviceId) return [];
    return packages.filter(p => {
      if (p.status !== 'active') return false;
      const quota = p.serviceQuotas.find(q => q.serviceId === serviceId);
      if (!quota) return false;
      return p.quotaPolicy === 'shared_pool' ? p.remainingSessions > 0 : quota.remainingQuota > 0;
    });
  }

  const eligiblePackages = getEligiblePackageOptions(customerPackages ?? [], form.serviceId);

  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <BusinessLayout>
      <div className="container mx-auto flex w-full max-w-[1600px] flex-col items-start gap-8 px-4 py-8 lg:px-6 xl:flex-row">
        <OwnerSidebar current="/vlasnik/kalendar" />
        <main className="w-full min-w-0 flex-1 space-y-8 overflow-x-clip">
          <div className="flex flex-col justify-between gap-5 border-b pb-6 sm:flex-row sm:items-end">
            <div><p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-primary">Organizacija dana</p><h1 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">Kalendar termina</h1><p className="mt-2 max-w-2xl text-muted-foreground">Izaberite dan i pregledajte raspored, walk-in klijente i SMS obaveštenja na jednom mestu.</p></div>
            <div className="flex items-center gap-3">
              <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                <DialogTrigger asChild><Button variant="outline"><Settings className="mr-2 h-4 w-4" /> Podešavanja rezervacija</Button></DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Podešavanja rezervacija</DialogTitle>
                  </DialogHeader>
                  <BookingSettingsForm onSaved={() => setSettingsOpen(false)} />
                </DialogContent>
              </Dialog>
              <Dialog open={blockOpen} onOpenChange={setBlockOpen}>
                <DialogTrigger asChild><Button data-testid="calendar-new-block" variant="secondary" onClick={openNewTimeBlock}><Ban className="mr-2 h-4 w-4" /> Blokiraj vreme</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Blokiranje vremena zaposlenog</DialogTitle></DialogHeader>
                  <form className="space-y-5 pt-2" onSubmit={handleCreateBlock}>
                    <div className="space-y-2"><Label>Zaposleni</Label><select required data-testid="block-employee-select" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={blockForm.employeeId} onChange={(e) => setBlockForm({ ...blockForm, employeeId: e.target.value })}><option value="">Izaberite zaposlenog</option>{employees?.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></div>
                    <div className="space-y-2"><Label>Datum</Label><Input required type="date" data-testid="block-date-input" min={today} value={blockForm.date} onChange={(e) => setBlockForm({ ...blockForm, date: e.target.value })} /></div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2"><Label>Početak</Label><Input required type="time" data-testid="block-starttime-input" value={blockForm.startTime} onChange={(e) => setBlockForm({ ...blockForm, startTime: e.target.value })} /></div>
                      <div className="space-y-2"><Label>Kraj</Label><Input required type="time" data-testid="block-endtime-input" value={blockForm.endTime} onChange={(e) => setBlockForm({ ...blockForm, endTime: e.target.value })} /></div>
                    </div>
                    <div className="space-y-2"><Label>Razlog</Label><Input required placeholder="npr. Pauza, Odsutan..." data-testid="block-reason-input" value={blockForm.reason} onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} /></div>
                    <Button className="w-full" type="submit" disabled={createBlock.isPending}>{createBlock.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sačuvaj blok</Button>
                  </form>
                </DialogContent>
              </Dialog>
              <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) closeQuickPackage(); }}>
                <DialogTrigger asChild><Button data-testid="calendar-new-appointment" onClick={() => openNewAppointment()}><Plus className="mr-2 h-4 w-4" /> Novi termin</Button></DialogTrigger>
                <DialogContent className="max-h-[90dvh] w-[calc(100vw-1rem)] min-w-0 max-w-3xl overflow-y-auto overflow-x-hidden">
                  <DialogHeader><DialogTitle>Zakazivanje</DialogTitle></DialogHeader>
                  <Tabs value={bookingMode} onValueChange={(v) => setBookingMode(v as "standard" | "package")} className="mt-2 min-w-0">
                    <TabsList className="mb-4 grid min-w-0 w-full grid-cols-2">
                      <TabsTrigger value="standard" className="min-w-0 truncate px-2">Jedan termin ili serija</TabsTrigger>
                      <TabsTrigger value="package" className="min-w-0 truncate px-2">Planiranje celog paketa</TabsTrigger>
                    </TabsList>

                    <TabsContent value="standard" className="min-w-0">
                      <form className="space-y-5" onSubmit={createAppointment}>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2"><Label>Usluga</Label><select required className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.serviceId} onChange={(e) => { setForm({ ...form, serviceId: e.target.value, packagePurchaseId: "" }); previewSeries.reset(); }}><option value="">Izaberite uslugu</option>{services?.filter((service) => service.active).map((service) => <option key={service.id} value={service.id}>{service.name} · {service.durationMinutes} min</option>)}</select></div>
                          <div className="space-y-2"><Label>Zaposleni</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}><option value="">Prvi dostupan</option>{employees?.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></div>
                          <div className="space-y-2"><Label>Datum</Label><Input required type="date" min={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
                          <div className="space-y-2"><Label>Vreme</Label><Input required type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
                        </div>
                        <div className="space-y-2">
                          <Label>Klijent</Label>
                          <SearchableCombobox
                            value={form.customerId}
                            onValueChange={(customerId) => { previewPackageSeries.reset(); setForm({ ...form, customerId, packagePurchaseId: "" }); setPackagePlannerPackageId(""); setPackagePlannerRows([]); }}
                            options={customerOptions}
                            placeholder="Izaberite klijenta"
                            searchPlaceholder="Pretražite klijente..."
                            emptyMessage="Nema klijenata na ovoj strani."
                            pinnedAction={{ label: "Novi klijent (brzi unos)", value: "new" }}
                            data-testid="appointment-customer-combobox"
                            aria-label="Izaberite klijenta"
                            footer={
                              <div className="flex items-center justify-between gap-2">
                                <Button type="button" size="sm" variant="outline" disabled={customersPage <= 1} onClick={() => setCustomersPage((page) => Math.max(1, page - 1))}>Prethodna</Button>
                                <span className="text-xs text-muted-foreground" aria-live="polite">Strana {customersPage}</span>
                                <Button type="button" size="sm" variant="outline" disabled={(customers?.length ?? 0) < CUSTOMERS_PAGE_SIZE} onClick={() => setCustomersPage((page) => page + 1)}>Sledeća</Button>
                              </div>
                            }
                          />
                        </div>
                        {form.customerId !== "new" && form.customerId !== "" && (
                          <div className="space-y-2">
                            <Label>Korišćenje paketa (opciono)</Label>
                            <SearchableCombobox
                              value={form.packagePurchaseId || "none"}
                              onValueChange={(val) => {
                                if (val === "new") {
                                  openQuickPackage("standard");
                                } else {
                                  setForm({ ...form, packagePurchaseId: val === "none" ? "" : val });
                                  previewSeries.reset();
                                }
                              }}
                              options={[
                                { value: "none", label: "Redovno plaćanje (ne koristi paket)", keywords: "redovno placanje" },
                                ...eligiblePackages.map(p => {
                                  const q = p.serviceQuotas.find(sq => sq.serviceId === form.serviceId);
                                  const label = p.quotaPolicy === 'shared_pool' ? `${p.packageName} (Zajedničkih termina: ${p.remainingSessions})` : `${p.packageName} (Preostalo za ovu uslugu: ${q?.remainingQuota}/${q?.totalQuota})`;
                                  const keywords = `${p.packageName} ${services?.find(s => s.id === form.serviceId)?.name || ""}`;
                                  return { value: p.id, label, keywords };
                                })
                              ]}
                              placeholder="Izaberite paket"
                              searchPlaceholder="Pretražite pakete..."
                              emptyMessage="Nema dostupnih aktivnih paketa."
                              pinnedAction={{ label: "Brzi unos novog paketa", value: "new" }}
                            />
                          </div>
                        )}
                        {form.customerId === "new" && <div className="rounded-lg border border-dashed bg-muted/30 p-4"><div className="mb-3 flex items-center gap-2 font-medium"><UserRoundPlus className="h-4 w-4 text-primary" /> Walk-in klijent</div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Ime</Label><Input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div><div className="space-y-2"><Label>Prezime</Label><Input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div><div className="space-y-2"><Label>Telefon</Label><Input required placeholder="+381 6x..." value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div><div className="space-y-2"><Label>E-mail <span className="text-muted-foreground">(opciono)</span></Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div></div></div>}
                        <div className="space-y-2"><Label>Napomena <span className="text-muted-foreground">(opciono)</span></Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                        <div className="rounded-xl border bg-muted/20 p-4"><label className="flex cursor-pointer items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={isSeries} onChange={(event) => { setIsSeries(event.target.checked); if (event.target.checked) setSeriesSlots(buildSeriesSlots(form)); else { setSeriesSlots([]); previewSeries.reset(); } }} /> <Repeat2 className="h-4 w-4 text-primary" /> Zakaži seriju termina</label>{isSeries && <div className="mt-4 space-y-3"><div className="grid gap-3 sm:grid-cols-3"><select className="h-10 rounded-md border bg-background px-3 text-sm" value={form.recurrence} onChange={(event) => setForm({ ...form, recurrence: event.target.value as OwnerBookingForm["recurrence"] })}><option value="daily">Svaki dan</option><option value="every-2-days">Svaka 2 dana</option><option value="every-3-days">Svaka 3 dana</option><option value="weekly">Nedeljno</option><option value="biweekly">Na 2 nedelje</option><option value="monthly">Mesečno</option><option value="custom">Prilagođeno (dani)</option></select>{form.recurrence === "custom" && <Input type="number" min="1" max="90" value={form.customDays} onChange={(event) => setForm({ ...form, customDays: event.target.value })} /> }<Input type="number" min="1" max="24" value={form.count} onChange={(event) => setForm({ ...form, count: event.target.value })} /></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSeriesSlots(buildSeriesSlots(form))}>Primeni pravilo</Button><Button type="button" size="sm" variant="outline" disabled={previewSeries.isPending} onClick={runSeriesPreview}>{previewSeries.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Proveri dostupnost</Button></div>{previewSeries.data?.packageEligible === false && <Badge variant="destructive" className="mt-2 w-full text-center">Paket problem: {previewSeries.data.packageReason}</Badge>}{seriesSlots.length > 0 && <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg border bg-background p-2">{seriesSlots.map((slot, index) => { const state = previewSeries.data?.slots.find((item) => appointmentDateKey(item.date) === slot.date && item.startTime === slot.startTime); return <div className="flex items-center gap-2" key={`${slot.date}-${index}`}><Input className="h-8" type="date" value={slot.date} onChange={(event) => setSeriesSlots(seriesSlots.map((item, i) => i === index ? { ...item, date: event.target.value } : item))} /><Input className="h-8" type="time" value={slot.startTime} onChange={(event) => setSeriesSlots(seriesSlots.map((item, i) => i === index ? { ...item, startTime: event.target.value } : item))} /><span className={cn("text-xs", state?.available === false ? "text-destructive" : state?.available ? "text-emerald-700" : "text-muted-foreground")}>{state ? (state.available ? "Slobodno" : "Konflikt") : "Nije provereno"}</span><Button type="button" variant="ghost" size="icon" aria-label="Ukloni termin iz serije" onClick={() => setSeriesSlots(seriesSlots.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>; })}</div>}</div>}</div>
                        <Button className="w-full" type="submit" disabled={create.isPending || createSeries.isPending || previewSeries.data?.packageEligible === false}>{(create.isPending || createSeries.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {isSeries ? "Sačuvaj seriju termina" : "Sačuvaj termin"}</Button>
                      </form>
                    </TabsContent>

                    <TabsContent value="package" className="min-w-0">
                      <form className="space-y-5" onSubmit={submitPlanner}>
                        <div className="space-y-2">
                          <Label>Klijent</Label>
                          <SearchableCombobox
                            value={form.customerId}
                            onValueChange={(customerId) => { previewPackageSeries.reset(); setForm({ ...form, customerId, packagePurchaseId: "" }); setPackagePlannerPackageId(""); setPackagePlannerRows([]); }}
                            options={customerOptions}
                            placeholder="Izaberite klijenta"
                            searchPlaceholder="Pretražite klijente..."
                            emptyMessage="Nema klijenata na ovoj strani."
                            pinnedAction={{ label: "Novi klijent (brzi unos)", value: "new" }}
                            data-testid="planner-customer-combobox"
                          />
                        </div>
                        {form.customerId === "new" ? (
                          <div className="p-4 text-center text-sm text-muted-foreground bg-muted/20 rounded-xl border">Walk-in klijenti ne mogu koristiti pakete.</div>
                        ) : form.customerId !== "" ? (
                          <>
                            <div className="space-y-2">
                              <Label>Aktivni paket za raspoređivanje</Label>
                              <SearchableCombobox
                                value={packagePlannerPackageId}
                                onValueChange={(val) => {
                                  if (val === "new") {
                                    openQuickPackage("package");
                                  } else {
                                    handlePlannerPackageChange(val);
                                  }
                                }}
                                options={[
                                  ...(customerPackages?.filter(p => p.status === 'active' && p.remainingSessions > 0).map(p => {
                                    const servicesStr = p.serviceQuotas.map(q => services?.find(s => s.id === q.serviceId)?.name).join(" ");
                                    return {
                                      value: p.id,
                                      label: `${p.packageName} (${p.remainingSessions} preostalih termina)`,
                                      keywords: `${p.packageName} ${servicesStr}`
                                    };
                                  }) ?? [])
                                ]}
                                placeholder="Izaberite paket"
                                searchPlaceholder="Pretražite pakete..."
                                emptyMessage="Nema dostupnih aktivnih paketa."
                                clearable
                                pinnedAction={{ label: "Brzi unos novog paketa", value: "new" }}
                              />
                            </div>

                            {packagePlannerPackageId && (
                              <div className="space-y-4">
                                <div className="max-h-[50vh] overflow-y-auto p-1 space-y-3 custom-scrollbar">
                                  {packagePlannerRows.map((row, index) => {
                                    const state = previewPackageSeries.data?.slots[index];
                                    const activePackage = customerPackages?.find(p => p.id === packagePlannerPackageId);
                                    const isShared = activePackage?.quotaPolicy === 'shared_pool';
                                    const coveredServices = isShared ? (activePackage?.serviceQuotas.map(q => q.serviceId) || []) : [];

                                    return (
                                      <div key={row.id} className="flex flex-col gap-2 rounded-lg border bg-muted/10 p-3 shadow-sm">
                                        <div className="flex items-center justify-between text-sm font-medium mb-1">
                                          <span>Termin #{index + 1}</span>
                                          <span className={cn("text-xs", state?.available === false ? "text-destructive" : state?.available ? "text-emerald-700" : "text-muted-foreground")}>{state ? (state.available ? "Slobodno" : "Konflikt") : "Nije provereno"}</span>
                                        </div>
                                        {state?.reason && <p className="text-xs text-destructive">{state.reason}</p>}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                          {isShared ? (
                                            <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={row.serviceId} onChange={(e) => updatePackagePlannerRow(index, { serviceId: e.target.value })}>
                                              {coveredServices.map(sid => {
                                                const s = services?.find(serv => serv.id === sid);
                                                return <option key={sid} value={sid}>{s?.name || sid}</option>;
                                              })}
                                            </select>
                                          ) : (
                                            <div className="h-9 w-full rounded-md border bg-muted/30 px-3 text-sm flex items-center text-muted-foreground">{services?.find(s => s.id === row.serviceId)?.name || row.serviceId}</div>
                                          )}
                                          <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={row.employeeId} onChange={(e) => updatePackagePlannerRow(index, { employeeId: e.target.value })}>
                                            <option value="">Zaposleni: Prvi dostupan</option>
                                            {employees?.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                                          </select>
                                          <Input className="h-9 text-sm" type="date" min={today} value={row.date} onChange={(e) => updatePackagePlannerRow(index, { date: e.target.value })} />
                                          <Input className="h-9 text-sm" type="time" value={row.startTime} onChange={(e) => updatePackagePlannerRow(index, { startTime: e.target.value })} />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                {previewPackageSeries.data?.packageEligible === false && <Badge variant="destructive" className="w-full text-center p-2">Problem sa paketom: {previewPackageSeries.data.packageReason}</Badge>}
                                <div className="flex flex-col gap-2">
                                  <Button type="button" variant="outline" disabled={previewPackageSeries.isPending || packagePlannerRows.length === 0} onClick={runPlannerPreview}>{previewPackageSeries.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Proveri dostupnost celog plana</Button>
                                  <Button type="submit" disabled={createPackageSeries.isPending || !previewPackageSeries.data?.allAvailable || previewPackageSeries.data?.packageEligible === false || packagePlannerRows.length === 0}>
                                    {createPackageSeries.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sačuvaj raspored paketa
                                  </Button>
                                </div>
                              </div>
                            )}
                          </>
                        ) : null}
                      </form>
                    </TabsContent>
                  </Tabs>
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <Dialog open={!!editing} onOpenChange={(isOpen) => !isOpen && setEditing(null)}>
            <DialogContent className="max-h-[90dvh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto">
              <DialogHeader><DialogTitle>Izmeni termin</DialogTitle></DialogHeader>
              {editing && <div className="space-y-4">
                <AppointmentLifecyclePanel appointment={editing} onUpdated={async (updated) => { setEditing(updated); await Promise.all([refetchAppointments(), refetchUnfilteredAppointments(), refetchMonthAppointments()]); }} />
                <div className="space-y-2"><Label>Napomena</Label><Textarea value={editing.notes ?? ""} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /></div>
                <Button className="w-full" onClick={saveAppointmentUpdate} disabled={updateAppointment.isPending}>{updateAppointment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sačuvaj izmene</Button>
                 {editing.seriesId && <Button className="w-full" variant="outline" onClick={() => openSeriesMove(editing.seriesId!)}><Repeat2 className="mr-2 h-4 w-4" /> Pomeri preostale termine serije</Button>}
                {editing.seriesId && <Button className="w-full" variant="destructive" disabled={cancelSeries.isPending} onClick={() => cancelSeries.mutate({ seriesId: editing.seriesId! }, { onSuccess: (result) => { toast.success(`Otkazano je ${result.cancelledAppointments} budućih termina iz serije.`); setEditing(null); refetchAppointments(); refetchUnfilteredAppointments(); refetchCustomers(); }, onError: (error) => toast.error("Serija nije otkazana", { description: error instanceof Error ? error.message : "Pokušajte ponovo." }) })}>{cancelSeries.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Otkaži sve buduće termine serije</Button>}
                {editing.bookingGroupId && <Button className="w-full" variant="destructive" disabled={cancelGroup.isPending} onClick={() => cancelGroup.mutate({ bookingGroupId: editing.bookingGroupId!, data: { reason: "Salon je otkazao celu grupnu rezervaciju" } }, { onSuccess: () => { toast.success("Cela grupna rezervacija je otkazana."); setEditing(null); refetchAppointments(); refetchUnfilteredAppointments(); refetchCustomers(); }, onError: (error) => toast.error("Grupa nije otkazana", { description: error instanceof Error ? error.message : "Pokušajte ponovo." }) })}>{cancelGroup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Otkaži celu grupnu rezervaciju</Button>}
              </div>}
            </DialogContent>
          </Dialog>
          <Dialog open={!!seriesMove} onOpenChange={(isOpen) => { if (!isOpen) { setSeriesMove(null); setSeriesMovePreviewKey(null); previewSeriesMove.reset(); } }}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader><DialogTitle>Pomeri preostale termine serije</DialogTitle></DialogHeader>
              {seriesMove && <div className="space-y-5">
                <p className="text-sm text-muted-foreground">Biće pomereni samo budući termini koji nisu završeni. Prvo pregledajte konflikte; nijedna izmena se ne čuva dok je ne potvrdite.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Pomerite datume za (dana)</Label><Input type="number" min="-365" max="365" step="1" value={seriesMove.dayOffset} onChange={(event) => setSeriesMove({ ...seriesMove, dayOffset: event.target.value })} /><p className="text-xs text-muted-foreground">Pozitivan broj pomera unapred, negativan unazad.</p></div>
                  <div className="space-y-2"><Label>Novo vreme <span className="text-muted-foreground">(opciono)</span></Label><Input type="time" value={seriesMove.startTime} onChange={(event) => setSeriesMove({ ...seriesMove, startTime: event.target.value })} /><p className="text-xs text-muted-foreground">Ako ostane prazno, zadržava se postojeće vreme.</p></div>
                </div>
                <Button className="w-full" variant="outline" onClick={runSeriesMovePreview} disabled={previewSeriesMove.isPending}>{previewSeriesMove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Pregledaj konflikte</Button>
                {hasCurrentSeriesMovePreview && previewSeriesMove.data && <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">Pregled {previewSeriesMove.data.slots.length} termina</p><Badge variant={previewSeriesMove.data.allAvailable ? "secondary" : "destructive"}>{previewSeriesMove.data.allAvailable ? "Svi termini su slobodni" : "Postoje konflikti"}</Badge></div>
                  <div className="max-h-60 space-y-2 overflow-y-auto">{previewSeriesMove.data.slots.map((slot) => <div className="rounded-lg border bg-background p-3 text-sm" key={slot.appointmentId}><div className="flex flex-wrap items-center justify-between gap-2"><span>{shortDateLabel(appointmentDateKey(slot.currentDate))} · {slot.currentStartTime} <span className="text-muted-foreground">→</span> {shortDateLabel(appointmentDateKey(slot.date))} · {slot.startTime}</span><span className={cn("font-medium", slot.available ? "text-emerald-700" : "text-destructive")}>{slot.available ? "Slobodno" : "Konflikt"}</span></div>{slot.reason && <p className="mt-1 text-xs text-destructive">{slot.reason}</p>}</div>)}</div>
                  {!previewSeriesMove.data.allAvailable && <p className="text-sm text-destructive">Serija ne može biti pomerena dok svi termini ne budu slobodni. Promenite broj dana ili vreme pa ponovo proverite.</p>}
                </div>}
                <Button className="w-full" onClick={confirmSeriesMove} disabled={!hasCurrentSeriesMovePreview || !previewSeriesMove.data?.allAvailable || moveSeries.isPending}>{moveSeries.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Potvrdi pomeranje serije</Button>
              </div>}
            </DialogContent>
          </Dialog>

          <QuickPackageDialog
            open={quickPackageContext !== null}
            onOpenChange={(nextOpen) => { if (!nextOpen) closeQuickPackage(); }}
            contextId={quickPackageContext?.id ?? ""}
            customerId={quickPackageContext?.customerId ?? ""}
            services={services || []}
            onSuccess={(result, contextId) => {
              queryClient.invalidateQueries({ queryKey: getOwnerListPackagesQueryKey() });
              queryClient.invalidateQueries({ queryKey: getOwnerListCustomerPackagesQueryKey({ salonCustomerId: result.purchase.salonCustomerId, status: 'active' }) });
              queryClient.invalidateQueries({ queryKey: ["owner-customer-packages"] });
              refetchCustomerPackages();
              previewPackageSeries.reset();
              const submittedContext = quickPackageContextRef.current;
              const currentContext = currentBookingContextRef.current;
              const isSameContext = Boolean(
                submittedContext
                && submittedContext.id === contextId
                && currentContext.open
                && currentContext.mode === submittedContext.mode
                && currentContext.customerId === submittedContext.customerId
                && currentContext.customerId === result.purchase.salonCustomerId
                && (submittedContext.mode === "package" || currentContext.serviceId === submittedContext.serviceId),
              );
              if (result.purchase.status === "active" && isSameContext && submittedContext) {
                if (submittedContext.mode === "standard") {
                  const coversCurrentService = result.purchase.serviceQuotas.some(q => q.serviceId === currentContext.serviceId);
                  if (coversCurrentService) {
                    setForm(f => ({ ...f, packagePurchaseId: result.purchase.id }));
                    previewSeries.reset();
                    toast.success(`Paket ${result.package.name} je kreiran i izabran za termin.`);
                  } else {
                    toast.success(`Paket ${result.package.name} je kreiran. Izaberite uslugu iz tog paketa da biste ga koristili.`);
                  }
                } else {
                  applyPlannerPackage(result.purchase);
                  toast.success(`Paket ${result.package.name} je kreiran i spreman za raspoređivanje.`);
                }
              } else if (result.purchase.status === "active") {
                toast.success(`Paket ${result.package.name} je kreiran i aktivan.`);
              } else {
                toast.success(`Paket ${result.package.name} je sačuvan i čeka uplatu.`);
              }
            }}
          />

          <div className="grid min-w-0 gap-7 xl:grid-cols-[minmax(0,.82fr)_minmax(0,1.7fr)]">
            <div className="space-y-6">
              <Card className="h-fit min-w-0 overflow-hidden border-primary/10 shadow-md max-sm:-mx-2 max-sm:w-[calc(100%+1rem)]">
                <CardHeader className="border-b bg-primary/[0.035] px-5 py-5 sm:px-7">
                  <CardTitle className="flex items-center gap-3 text-xl"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="h-5 w-5" /></span> Izaberite datum</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 px-0 py-4 sm:px-6 sm:py-7">
                  <div className="min-w-0 overflow-hidden rounded-2xl border bg-background p-0 shadow-sm sm:p-3">
                    <Calendar
                      mode="single"
                      showOutsideDays={false}
                      selected={selectedDate ? dateAtUtcNoon(selectedDate) : undefined}
                      onSelect={(date) => { if (date) selectDate(dateKey(date)); }}
                      onMonthChange={(month) => setVisibleMonth(month)}
                      components={{ DayButton: AppointmentDayButton }}
                      modifiers={{ hasAppointments: (date) => appointmentDateKeys.has(dateKey(date)) }}
                      className="w-full"
                      classNames={{ months: "w-full", month: "w-full space-y-4", table: "w-full border-collapse", head_row: "flex w-full justify-between pb-2 text-muted-foreground", head_cell: "w-11 font-medium text-[0.8rem] sm:w-14 uppercase tracking-wider", row: "flex w-full justify-between mt-2", cell: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20" }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 px-4 sm:px-0"><span className="mr-1 flex items-center text-sm font-semibold text-muted-foreground">Brzi prelazak:</span>{quickDates.map((date) => <Button key={date.value} variant={selectedDate === date.value ? "default" : "outline"} size="sm" className="rounded-full" onClick={() => selectDate(date.value)}>{date.label}</Button>)}</div>
                </CardContent>
              </Card>

              <Card className="h-fit min-w-0 overflow-hidden border-primary/10 shadow-md max-sm:-mx-2 max-sm:w-[calc(100%+1rem)]">
                <CardHeader className="border-b bg-primary/[0.035] px-5 py-4 sm:px-7">
                  <CardTitle className="flex items-center gap-3 text-lg"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Search className="h-4 w-4" /></span> Brza pretraga slobodnih termina</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 px-5 py-5 sm:px-7">
                  <div className="space-y-2">
                    <Label>Usluga</Label>
                    <SearchableCombobox
                      value={searchForm.serviceId}
                      onValueChange={(serviceId) => setSearchForm({ ...searchForm, serviceId })}
                      options={serviceOptions}
                      placeholder="Izaberite uslugu"
                      searchPlaceholder="Pretražite usluge..."
                      data-testid="search-service-combobox"
                      aria-label="Izaberite uslugu za pretragu"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Zaposleni (opciono)</Label>
                    <select data-testid="search-employee-select" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={searchForm.employeeId} onChange={(e) => setSearchForm({...searchForm, employeeId: e.target.value})}>
                      <option value="">Bilo koji</option>
                      {employees?.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Počevši od datuma</Label>
                    <Input type="date" data-testid="search-date-input" value={searchForm.startDate} onChange={(e) => setSearchForm({...searchForm, startDate: e.target.value})} />
                  </div>
                  <Button className="w-full" data-testid="search-submit-btn" disabled={!searchForm.serviceId || !searchForm.startDate || searchFetching} onClick={() => {
                    setSearchParams({ serviceId: searchForm.serviceId, startDate: searchForm.startDate, ...(searchForm.employeeId ? {employeeId: searchForm.employeeId} : {}), limit: 10 } as SearchSalonAvailabilityParams);
                  }}>
                    {searchFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Search className="mr-2 h-4 w-4"/>} Traži termine
                  </Button>

                  {searchError ? (
                    <div className="mt-4 border-t pt-4 text-sm text-center text-destructive animate-in fade-in">Greška pri pretrazi termina. Pokušajte ponovo.</div>
                  ) : searchFetching ? (
                    <div className="mt-4 border-t pt-6 flex justify-center animate-in fade-in"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                  ) : searchHasRun && searchResults && searchResults.length === 0 ? (
                    <div className="mt-4 border-t pt-4 text-sm text-center text-muted-foreground animate-in fade-in">Nema slobodnih termina za ove kriterijume.</div>
                  ) : searchHasRun && searchResults && searchResults.length > 0 ? (
                    <div className="mt-4 border-t pt-4 animate-in fade-in slide-in-from-bottom-2" data-testid="search-results">
                      <p className="text-sm font-medium mb-3 text-primary">Slobodni termini</p>
                      <div className="max-h-56 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                        {searchResults.map((slot) => (
                          <button key={`${slot.date}-${slot.startTime}-${slot.employeeId}`} data-testid={`search-result-slot-${slot.date}-${slot.startTime}`} type="button" className="w-full flex items-center justify-between text-left rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm hover:bg-primary/10 transition-colors shadow-sm" onClick={() => {
                            selectDate(slot.date);
                            openNewAppointment({ serviceId: searchForm.serviceId, employeeId: slot.employeeId, date: slot.date, startTime: slot.startTime });
                          }}>
                            <div>
                              <div className="font-semibold text-primary">{shortDateLabel(slot.date)} u {slot.startTime}</div>
                              <div className="text-xs font-medium text-primary/70">{slot.employeeName}</div>
                            </div>
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary"><Plus className="h-3 w-3" /></div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 border-t pt-4 text-sm text-center text-muted-foreground animate-in fade-in">Popunite formu iznad i pokrenite pretragu.</div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="min-w-0 max-w-full overflow-hidden border-primary/10 shadow-md">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 border-b bg-muted/20 px-5 py-4 sm:px-7">
                <div>
                  <CardTitle className="text-xl">Raspored</CardTitle>
                  <p className="text-sm text-muted-foreground">{selectedDate ? dateLabel(selectedDate) : "Izaberite datum za pregled termina"}</p>
                </div>
                {selectedDate && (
                  <div className="flex flex-wrap items-center gap-3">
                    <select data-testid="filter-employee-select" className="h-9 rounded-md border bg-background px-3 text-sm font-medium" value={filterEmployeeId} onChange={(e) => setFilterEmployeeId(e.target.value)}>
                      <option value="">Svi zaposleni</option>
                      {employees?.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                    <select data-testid="filter-service-select" className="h-9 rounded-md border bg-background px-3 text-sm font-medium" value={filterServiceId} onChange={(e) => setFilterServiceId(e.target.value)}>
                      <option value="">Sve usluge</option>
                      {services?.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <Tabs value={viewMode} onValueChange={(value) => setViewMode(value === "list" ? "list" : "timeline")} className="w-auto" data-testid="calendar-view-tabs">
                      <TabsList>
                        <TabsTrigger value="timeline" data-testid="tab-timeline" className="gap-2"><CalendarRange className="h-4 w-4"/> Vremenska osa</TabsTrigger>
                        <TabsTrigger value="list" data-testid="tab-list" className="gap-2"><AlignLeft className="h-4 w-4"/> Lista</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-0 sm:p-5">
                {!selectedDate ? (
                  <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CalendarDays className="h-8 w-8" /></div>
                    <p className="text-lg font-semibold">Nema izabranog datuma</p>
                    <p className="mt-2 max-w-sm text-sm text-muted-foreground">Kliknite na datum u kalendaru levo da vidite termine za taj dan.</p>
                  </div>
                ) : isLoading || isFetching || calendarDayFetching ? (
                  <div className="flex min-h-[400px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                ) : appointmentsError || timeBlocksError || calendarDayError ? (
                  <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center" role="alert">
                    <p className="font-semibold text-destructive">Raspored trenutno nije dostupan</p>
                    <p className="mt-2 max-w-sm text-sm text-muted-foreground">Osvežite stranicu ili pokušajte ponovo za nekoliko trenutaka.</p>
                  </div>
                ) : (
                  <div className="w-full min-w-0 max-w-full p-4 sm:p-0">
                    {viewMode === "timeline" ? (
                      <CalendarTimeline
                        appointments={appointments ?? []}
                        timeBlocks={timeBlocks ?? []}
                        employees={timelineEmployees}
                        onSlotClick={(empId, time) => openNewAppointment({ employeeId: empId, startTime: time, date: selectedDate })}
                        onAppointmentClick={setEditing}
                        onBlockClick={(b) => handleDeleteBlock(b.id)}
                      />
                    ) : sortedList.length > 0 ? (
                      <div className="space-y-4">
                        {sortedList.map((item) => {
                          if (item._type === "block") {
                            return (
                              <div key={`block-${item.id}`} data-testid={`list-block-${item.id}`} className="flex flex-col gap-4 rounded-xl border border-rose-200 bg-rose-50 p-4 transition-all hover:border-rose-300 hover:shadow-md sm:flex-row sm:items-center">
                                <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                                  <div className="flex items-center gap-3 font-semibold text-rose-800"><Ban className="h-5 w-5" />{item.startTime} - {item.endTime}</div>
                                  <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-2"><p className="font-semibold text-rose-900">Nedostupno vreme: {employees?.find(e => e.id === item.employeeId)?.name}</p></div>
                                    {item.reason && <p className="text-sm text-rose-700">{item.reason}</p>}
                                  </div>
                                </div>
                                <Button size="sm" variant="outline" className="border-rose-300 text-rose-700 hover:bg-rose-100" onClick={() => handleDeleteBlock(item.id)}><Trash2 className="h-3.5 w-3.5 mr-1" /> Ukloni blok</Button>
                              </div>
                            );
                          }

                          const appointment = item;
                          return (
                            <div key={`app-${appointment.id}`} data-testid={`list-appointment-${appointment.id}`} className={cn("flex flex-col gap-4 rounded-xl border bg-background p-4 transition-all hover:border-primary/20 hover:shadow-md sm:flex-row sm:items-center", appointment.status === "cancelled" || appointment.status === "no-show" ? "opacity-60 grayscale hover:opacity-100 hover:grayscale-0" : "")}>
                              <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                                <div className="flex items-center gap-3 font-semibold text-primary"><Clock3 className="h-5 w-5 text-muted-foreground" />{appointment.startTime}</div>
                                <div className="flex-1 space-y-1">
                                  <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-foreground">{appointment.customerName}</p>{appointment.seriesId && <Badge variant="secondary" className="h-5 rounded-md px-1.5"><Repeat2 className="mr-1 h-3 w-3" /> Serija</Badge>}{appointment.bookingGroupId && <Badge variant="outline" className="h-5 rounded-md px-1.5">Grupna rezervacija</Badge>}</div>
                                  <p className="font-medium text-primary">{appointment.serviceName}</p>
                                  {appointment.bookingGroupId && <p className="text-xs text-muted-foreground">Tretmani: {(appointments ?? []).filter((member) => member.bookingGroupId === appointment.bookingGroupId).map((member) => member.serviceName).join(" · ")}</p>}
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>Zaposleni: {appointment.employeeName}</span><span>{appointment.durationMinutes} min</span><span>{appointment.price.toLocaleString("sr-RS")} RSD</span>{appointment.treatmentLocation === "home" && <span className="flex items-center text-emerald-700"><MapPin className="mr-1 h-3 w-3" /> Na adresi (+{appointment.travelFee} RSD)</span>}</div>
                                  {appointment.rescheduledConfirmation && <Badge variant={appointment.rescheduledConfirmation?.sms?.status === "queued" || appointment.rescheduledConfirmation?.email?.status === "processing" ? "outline" : appointment.rescheduledConfirmation?.sms?.status === "failed" || appointment.rescheduledConfirmation?.email?.status === "failed" ? "destructive" : "secondary"} className="mt-2">{rescheduledConfirmationLabel(appointment.rescheduledConfirmation)}</Badge>}
                                  {appointment.notes && <p className="mt-2 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">{appointment.notes}</p>}
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                                <Badge variant="outline" className={cn("rounded-full px-3 py-1 text-xs font-semibold", statusClasses[appointment.status as keyof typeof statusClasses])}>{statusLabels[appointment.status as keyof typeof statusLabels]}</Badge>
                                 <Button size="sm" variant="outline" className="gap-1.5 opacity-90 transition-opacity hover:opacity-100" aria-label={`Izmeni termin za ${appointment.customerName}`} onClick={() => setEditing(appointment)}><Pencil className="h-3.5 w-3.5" /> Izmeni</Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex min-h-[300px] flex-col items-center justify-center p-8 text-center">
                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CalendarDays className="h-8 w-8" /></div>
                        <p className="text-lg font-semibold">Nema zakazanih termina</p>
                        <p className="mt-2 max-w-sm text-sm text-muted-foreground">Nema aktivnosti za izabrani datum i filtere.</p>
                        <Button variant="outline" className="mt-5" onClick={() => openNewAppointment()}><Plus className="mr-2 h-4 w-4" /> Dodaj termin</Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">CRM kontakti</CardTitle>
              <p className="text-sm text-muted-foreground">Za svakog gosta možete isključiti SMS potvrde i podsetnike.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {customers?.length ? customers.map((customer) => (
                <div className="rounded-lg border p-3" key={customer.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{customer.firstName} {customer.lastName}</p>
                      <p className="text-xs text-muted-foreground">{customer.phone ?? "Nema telefona"} · {customer.visitCount} termina{customer.noShowCount ? ` · ${customer.noShowCount} nije došao` : ""}</p>
                      {customer.series?.map((series) => <p className="mt-2 flex items-center gap-1 text-xs text-primary" key={series.id}><Repeat2 className="h-3 w-3" /> {series.serviceName}: {series.completedAppointments}/{series.totalAppointments} završeno · {series.upcomingAppointments} predstoji</p>)}
                    </div>
                    <Button size="sm" variant={customer.smsOptOut ? "outline" : "ghost"} disabled={updateCustomer.isPending} onClick={() => updateCustomer.mutate({ customerId: customer.id, data: { smsOptOut: !customer.smsOptOut } }, { onSuccess: () => { toast.success(customer.smsOptOut ? "SMS obaveštenja su uključena" : "SMS obaveštenja su isključena"); refetchCustomers(); } })}>
                      {customer.smsOptOut ? "Uključi SMS" : <><MessageSquareOff className="mr-1 h-3.5 w-3.5" /> Isključi SMS</>}
                    </Button>
                  </div>
                </div>
              )) : (
                <p className="py-8 text-center text-sm text-muted-foreground">CRM se puni pri ručnom zakazivanju ili online rezervaciji.</p>
              )}
              {(customersPage > 1 || (customers?.length ?? 0) >= CUSTOMERS_PAGE_SIZE) && (
                <div className="flex items-center justify-between pt-2">
                  <Button size="sm" variant="outline" disabled={customersPage <= 1} onClick={() => setCustomersPage((page) => Math.max(1, page - 1))}>Prethodna</Button>
                  <span className="text-xs text-muted-foreground">Strana {customersPage}</span>
                  <Button size="sm" variant="outline" disabled={(customers?.length ?? 0) < CUSTOMERS_PAGE_SIZE} onClick={() => setCustomersPage((page) => page + 1)}>Sledeća</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </BusinessLayout>
  );
}
