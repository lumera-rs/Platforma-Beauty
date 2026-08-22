import { type ComponentProps, type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { BusinessLayout } from "@/components/business-layout";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Repeat2,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { AvatarImage } from "@/components/optimized-image";
import { uploadOptimizedImage } from "@/lib/media-upload";

type Appointment = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  seriesId: string | null;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no-show";
  notes: string | null;
  serviceName: string;
  customerName: string;
  customerPhone: string | null;
  allocatedResources?: { resourceId: string; resourceName: string; quantity: number }[];
};

type Portal = {
  salon: { name: string };
  employee: { id: string; name: string; role: string; bio: string; avatarUrl: string; email: string; phone: string | null };
  appointments: Appointment[];
  clients: { id: string; firstName: string; lastName: string; phone: string | null }[];
  services: { id: string; name: string; durationMinutes: number }[];
  schedule: { id: string; weekday: number; startTime: string; endTime: string; breakStart: string | null; breakEnd: string | null }[];
  timeOff: { id: string; startDate: string; endDate: string; reason: string }[];
  leaveRequests: { id: string; startDate: string; endDate: string; reason: string; status: string }[];
  notifications: { id: string; title: string; date: string; createdAt: string }[];
  stats: { week: number; month: number; completed: number; noShow: number };
};

type Slot = { date: string; startTime: string };

const weekdays = ["Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak", "Subota", "Nedelja"];
const statusLabel: Record<Appointment["status"], string> = {
  pending: "Na čekanju",
  confirmed: "Potvrđen",
  completed: "Završen",
  cancelled: "Otkazan",
  "no-show": "No-show",
};
const statusClasses: Record<Appointment["status"], string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  completed: "border-slate-200 bg-slate-100 text-slate-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-800",
  "no-show": "border-red-200 bg-red-50 text-red-800",
};

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateAtUtcNoon(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function appointmentDateKey(value: string) {
  return value.slice(0, 10);
}

function shortDateLabel(value: string) {
  return dateAtUtcNoon(value).toLocaleDateString("sr-RS", { day: "numeric", month: "short" });
}

function dateLabel(value: string) {
  return dateAtUtcNoon(value).toLocaleDateString("sr-RS", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function today() {
  return dateKey(new Date());
}

function recurringSlots(first: Slot, rule: string, count: number): Slot[] {
  const start = new Date(`${first.date}T12:00:00Z`);
  return Array.from({ length: Math.max(1, Math.min(24, count)) }, (_, index) => {
    const date = new Date(start);
    if (rule === "weekly") date.setUTCDate(date.getUTCDate() + index * 7);
    else if (rule === "biweekly") date.setUTCDate(date.getUTCDate() + index * 14);
    else if (rule === "monthly") date.setUTCMonth(date.getUTCMonth() + index);
    else date.setUTCDate(date.getUTCDate() + index * (rule === "every-2-days" ? 2 : rule === "every-3-days" ? 3 : 1));
    return { date: date.toISOString().slice(0, 10), startTime: first.startTime };
  });
}

function AppointmentDayButton({ day, modifiers, className, ...props }: ComponentProps<typeof CalendarDayButton>) {
  const hasAppointments = Boolean(modifiers.hasAppointments);
  return (
    <CalendarDayButton
      {...props}
      day={day}
      modifiers={modifiers}
      className={cn(
        "min-h-[--cell-size] rounded-xl border border-transparent py-1.5 transition-all hover:border-primary/30 hover:bg-primary/5",
        modifiers.today && "border-primary/40 bg-primary/5",
        className,
      )}
    >
      <span className="!text-base !font-semibold !opacity-100">{day.date.getDate()}</span>
      <span
        aria-hidden="true"
        className={cn(
          "mt-1 h-1.5 w-1.5 rounded-full bg-transparent",
          hasAppointments && "bg-primary",
          modifiers.selected && hasAppointments && "bg-primary-foreground",
        )}
      />
    </CalendarDayButton>
  );
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Radnja nije uspela.");
  return body as T;
}

export function EmployeePasswordChange() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("Lozinka mora imati najmanje 8 karaktera.");
      return;
    }
    if (password !== confirm) {
      toast.error("Lozinke se ne podudaraju.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ newPassword: password }) });
      await queryClient.refetchQueries({ queryKey: getGetCurrentUserQueryKey() });
      toast.success("Lozinka je promenjena.");
      setLocation("/zaposleni");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Promena lozinke nije uspela.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto flex max-w-lg flex-1 items-center px-4 py-12">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Postavite svoju lozinku</CardTitle>
            <p className="text-sm text-muted-foreground">Radi bezbednosti, privremenu lozinku morate promeniti pre pristupa portalu.</p>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={save}>
              <div>
                <Label>Nova lozinka</Label>
                <PasswordInput className="mt-1" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
              <div>
                <Label>Ponovite lozinku</Label>
                <PasswordInput className="mt-1" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
              </div>
              <Button className="w-full" type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sačuvaj novu lozinku
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </BusinessLayout>
  );
}

export default function EmployeePortal() {
  const [portal, setPortal] = useState<Portal | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(today());
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [booking, setBooking] = useState({
    serviceId: "",
    salonCustomerId: "",
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    slots: [{ date: today(), startTime: "10:00" }] as Slot[],
  });
  const [seriesMode, setSeriesMode] = useState(false);
  const [seriesRule, setSeriesRule] = useState("weekly");
  const [seriesCount, setSeriesCount] = useState("5");
  const [seriesPreview, setSeriesPreview] = useState<{
    slots: Array<{ date: string; startTime: string; available: boolean; reason: string | null }>;
    allAvailable: boolean;
  } | null>(null);
  const [profile, setProfile] = useState({ bio: "", avatarUrl: "", phone: "" });
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [leave, setLeave] = useState({ startDate: today(), endDate: today(), reason: "" });

  const load = async () => {
    setLoading(true);
    try {
      const data = await api<Portal>("/api/employee/portal");
      setPortal(data);
      setProfile({ bio: data.employee.bio, avatarUrl: data.employee.avatarUrl, phone: data.employee.phone ?? "" });
      setBooking((current) => ({ ...current, serviceId: current.serviceId || data.services[0]?.id || "" }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Portal nije učitan.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const appointments = useMemo(
    () => (portal?.appointments ?? [])
      .filter((appointment) => appointmentDateKey(appointment.date) === date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [date, portal],
  );
  const appointmentDateKeys = useMemo(
    () => new Set((portal?.appointments ?? []).map((appointment) => appointmentDateKey(appointment.date))),
    [portal],
  );
  const quickDates = useMemo(() => {
    const base = new Date();
    return [
      { label: "Danas", value: dateKey(base) },
      { label: "Sutra", value: dateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1)) },
      { label: "Prekosutra", value: dateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 2)) },
    ];
  }, []);

  const selectDate = (value: string) => {
    setDate(value);
    const selected = dateAtUtcNoon(value);
    setVisibleMonth(new Date(selected.getUTCFullYear(), selected.getUTCMonth(), 1));
  };

  const saveAppointment = async () => {
    if (!editing) return;
    try {
      await api(`/api/employee/appointments/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: editing.status, notes: editing.notes ?? "" }),
      });
      toast.success("Termin je ažuriran.");
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Izmena nije uspela.");
    }
  };

  const saveProfile = async () => {
    try {
      await api("/api/employee/profile", { method: "PUT", body: JSON.stringify(profile) });
      toast.success("Profil je sačuvan.");
      setProfileOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Profil nije sačuvan.");
    }
  };
  const uploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !portal) return;
    setUploadingAvatar(true);
    try {
      const asset = await uploadOptimizedImage(file, "employee-avatar", portal.employee.id);
      setProfile((current) => ({ ...current, avatarUrl: asset.imageUrl }));
      toast.success("Fotografija profila je obrađena.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload fotografije nije uspeo.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const requestLeave = async () => {
    try {
      await api("/api/employee/leave-requests", { method: "POST", body: JSON.stringify(leave) });
      toast.success("Zahtev je poslat salonu.");
      setLeaveOpen(false);
      setLeave({ startDate: today(), endDate: today(), reason: "" });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Zahtev nije poslat.");
    }
  };

  const book = async () => {
    try {
      if (seriesMode && !seriesPreview?.allAvailable) {
        toast.error("Prvo proverite da su svi termini iz serije slobodni.");
        return;
      }
      await api(seriesMode ? "/api/employee/appointment-series" : "/api/employee/appointments", {
        method: "POST",
        body: JSON.stringify({
          serviceId: booking.serviceId,
          salonCustomerId: booking.salonCustomerId || undefined,
          guest: booking.salonCustomerId ? undefined : {
            firstName: booking.firstName,
            lastName: booking.lastName,
            phone: booking.phone,
            email: booking.email,
          },
          slots: booking.slots,
        }),
      });
      toast.success(booking.slots.length > 1 ? "Termini su zakazani i potvrde poslate." : "Termin je zakazan i potvrda poslata.");
      setBookingOpen(false);
      setSeriesMode(false);
      setSeriesPreview(null);
      setBooking((current) => ({
        ...current,
        salonCustomerId: "",
        firstName: "",
        lastName: "",
        phone: "",
        email: "",
        slots: [{ date: today(), startTime: "10:00" }],
      }));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Zakazivanje nije uspelo.");
    }
  };

  const previewEmployeeSeries = async () => {
    try {
      const preview = await api<{
        slots: Array<{ date: string; startTime: string; available: boolean; reason: string | null }>;
        allAvailable: boolean;
      }>("/api/employee/appointment-series/preview", {
        method: "POST",
        body: JSON.stringify({ serviceId: booking.serviceId, slots: booking.slots }),
      });
      setSeriesPreview(preview);
      if (preview.allAvailable) toast.success("Svi termini u seriji su slobodni.");
      else toast.error("Neki termini nisu dostupni. Pomerite ili uklonite označeni slot.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Dostupnost nije proverena.");
    }
  };

  if (loading || !portal) {
    return <BusinessLayout><div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div></BusinessLayout>;
  }

  return (
    <BusinessLayout>
      <div className="container mx-auto space-y-6 px-4 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">{portal.salon.name}</p>
            <h1 className="font-serif text-3xl font-bold">Portal zaposlenog</h1>
            <p className="text-muted-foreground">Dobro došli, {portal.employee.name}.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setProfileOpen(true)}><UserRound className="mr-2 h-4 w-4" />Moj profil</Button>
            <Button onClick={() => setBookingOpen(true)}><Plus className="mr-2 h-4 w-4" />Zakaži termin</Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric title="Ove nedelje" value={portal.stats.week} icon={<CalendarDays className="h-5 w-5" />} />
          <Metric title="Ovog meseca" value={portal.stats.month} icon={<Clock3 className="h-5 w-5" />} />
          <Metric title="Završeni" value={portal.stats.completed} icon={<CheckCircle2 className="h-5 w-5" />} />
          <Metric title="No-show" value={portal.stats.noShow} icon={<XCircle className="h-5 w-5" />} />
        </div>

        <div className="grid gap-7 xl:grid-cols-[minmax(370px,.82fr)_minmax(0,1.7fr)]" data-testid="employee-calendar">
          <Card className="h-fit overflow-hidden border-primary/10 shadow-md">
            <CardHeader className="border-b bg-primary/[0.035] px-5 py-5 sm:px-7">
              <CardTitle className="flex items-center gap-3 text-xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="h-5 w-5" /></span>
                Izaberite datum
              </CardTitle>
              <p className="pl-[52px] text-sm text-muted-foreground">Prikazani su samo termini koji su dodeljeni vama.</p>
            </CardHeader>
            <CardContent className="space-y-6 px-4 py-5 sm:px-6 sm:py-7">
              <div className="rounded-2xl border bg-background p-2 shadow-sm sm:p-4">
                <Calendar
                  mode="single"
                  selected={dateAtUtcNoon(date)}
                  onSelect={(selected) => selected && selectDate(dateKey(selected))}
                  month={visibleMonth}
                  onMonthChange={setVisibleMonth}
                  modifiers={{ hasAppointments: [...appointmentDateKeys].map(dateAtUtcNoon) }}
                  components={{ DayButton: AppointmentDayButton }}
                  className="mx-auto w-full [--cell-size:2.65rem] sm:[--cell-size:3.4rem]"
                />
              </div>
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Brzi izbor</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                  {quickDates.map((quickDate) => (
                    <Button
                      key={quickDate.label}
                      type="button"
                      variant={date === quickDate.value ? "default" : "outline"}
                      className={cn(
                        "h-auto min-h-[72px] flex-col items-start justify-center gap-1 rounded-xl px-4 py-3 text-left transition-all",
                        date === quickDate.value
                          ? "shadow-md shadow-primary/20"
                          : "hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/[0.04]",
                      )}
                      aria-pressed={date === quickDate.value}
                      onClick={() => selectDate(quickDate.value)}
                    >
                      <span className="text-sm font-semibold">{quickDate.label}</span>
                      <span className={cn("text-xs font-normal", date === quickDate.value ? "text-primary-foreground/75" : "text-muted-foreground")}>
                        {shortDateLabel(quickDate.value)}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-primary/10 shadow-md">
            <CardHeader className="border-b bg-card px-5 py-5 sm:px-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl sm:text-2xl">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Clock3 className="h-5 w-5" /></span>
                    <span>Moji termini · {dateLabel(date)}</span>
                  </CardTitle>
                  <p className="mt-2 pl-[52px] text-sm text-muted-foreground">Raspored za izabrani dan, poređan po vremenu.</p>
                </div>
                {appointments.length > 0 && <Badge variant="outline" className="w-fit rounded-full px-3 py-1 text-sm">{appointments.length} {appointments.length === 1 ? "termin" : "termina"}</Badge>}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {appointments.length ? (
                <div className="space-y-3 bg-muted/[0.18] p-4 sm:p-5">
                  {appointments.map((appointment) => (
                    <div className="group flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md sm:flex-row sm:items-center sm:justify-between sm:p-5" key={appointment.id}>
                      <div className="flex min-w-0 items-start gap-4">
                        <div className="flex h-[60px] w-[78px] shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <span className="text-xl font-bold tracking-tight">{appointment.startTime}</span>
                          <span className="text-[10px] font-medium uppercase tracking-wider text-primary/70">početak</span>
                        </div>
                        <div className="min-w-0 pt-0.5">
                          <p className="truncate text-base font-bold">{appointment.customerName}</p>
                          <p className="mt-1 truncate text-sm font-medium text-foreground/80">{appointment.serviceName}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{appointment.customerPhone ?? "Telefon nije dostupan"}</p>
                          {appointment.seriesId && <Badge variant="secondary" className="mt-2 gap-1"><Repeat2 className="h-3 w-3" />Serija</Badge>}
                          {appointment.notes && <p className="mt-2 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">{appointment.notes}</p>}
                          {appointment.allocatedResources && appointment.allocatedResources.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {appointment.allocatedResources.map((alloc, i) => (
                                <Badge key={i} variant="secondary" className="text-[10px] font-medium opacity-80 bg-background">{alloc.resourceName} x{alloc.quantity}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                        <Badge variant="outline" className={cn("rounded-full px-3 py-1 text-xs font-semibold", statusClasses[appointment.status])}>{statusLabel[appointment.status]}</Badge>
                        {!["completed", "no-show", "cancelled"].includes(appointment.status) && (
                          <Button size="sm" variant="outline" className="gap-1.5 opacity-90 transition-opacity group-hover:opacity-100" onClick={() => setEditing({ ...appointment })}>
                            <Pencil className="h-3.5 w-3.5" />Završi / no-show
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-80 flex-col items-center justify-center p-8 text-center">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CalendarDays className="h-8 w-8" /></div>
                  <p className="text-lg font-semibold">Nema vaših termina za {dateLabel(date)}</p>
                  <p className="mt-2 max-w-sm text-sm text-muted-foreground">Kada vam salon dodeli termin za ovaj dan, pojaviće se ovde.</p>
                  <Button variant="outline" className="mt-5" onClick={() => setBookingOpen(true)}><Plus className="mr-2 h-4 w-4" />Dodaj termin</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader><CardTitle className="text-lg">Moje radno vreme</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {portal.schedule.length ? portal.schedule.map((item) => <div key={item.id} className="flex justify-between text-sm"><span>{weekdays[item.weekday - 1]}</span><span>{item.startTime}–{item.endTime}{item.breakStart && ` · pauza ${item.breakStart}–${item.breakEnd}`}</span></div>) : <p className="text-sm text-muted-foreground">Salon još nije uneo posebno radno vreme.</p>}
              <Button className="mt-2 w-full" variant="outline" onClick={() => setLeaveOpen(true)}>Pošalji zahtev za odsustvo</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-lg">Obaveštenja</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {portal.notifications.length ? portal.notifications.map((notification) => <div key={notification.id} className="border-b pb-2 last:border-0"><p className="text-sm font-medium">{notification.title}</p><p className="text-xs text-muted-foreground">{new Date(notification.date).toLocaleDateString("sr-RS")}</p></div>) : <p className="text-sm text-muted-foreground">Nemate nova obaveštenja.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-lg">Moje usluge</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {portal.services.length ? portal.services.map((service) => <Badge key={service.id} variant="secondary">{service.name} · {service.durationMinutes} min</Badge>) : <p className="text-sm text-muted-foreground">Salon vam još nije dodelio usluge.</p>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-lg">Odsustva i zahtevi</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {portal.leaveRequests.length ? portal.leaveRequests.map((item) => <div key={item.id} className="flex items-center justify-between rounded-md border p-3 text-sm"><span>{item.startDate} – {item.endDate} · {item.reason}</span><Badge variant={item.status === "approved" ? "secondary" : item.status === "rejected" ? "destructive" : "default"}>{item.status === "pending" ? "Na čekanju" : item.status === "approved" ? "Odobreno" : "Odbijeno"}</Badge></div>) : <p className="text-sm text-muted-foreground">Nema poslatih zahteva.</p>}
          </CardContent>
        </Card>

        <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Ažuriraj termin</DialogTitle></DialogHeader>
            {editing && <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{editing.customerName} · {editing.serviceName}</p>
              <div>
                <Label>Status</Label>
                <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as Appointment["status"] })}>
                  <option value="completed">Završen</option>
                  <option value="no-show">No-show</option>
                </select>
              </div>
              <div><Label>Interna napomena</Label><Textarea className="mt-1" value={editing.notes ?? ""} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /></div>
              <Button className="w-full" onClick={saveAppointment}>Sačuvaj</Button>
            </div>}
          </DialogContent>
        </Dialog>

        <Dialog open={bookingOpen} onOpenChange={setBookingOpen}>
          <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
            <DialogHeader><DialogTitle>Zakaži termin za svog klijenta</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Usluga</Label>
                <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={booking.serviceId} onChange={(event) => setBooking({ ...booking, serviceId: event.target.value })}>
                  {portal.services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.durationMinutes} min</option>)}
                </select>
              </div>
              <div>
                <Label>Klijent kog ste ranije uslužili</Label>
                <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={booking.salonCustomerId} onChange={(event) => setBooking({ ...booking, salonCustomerId: event.target.value })}>
                  <option value="">Brzi unos novog klijenta</option>
                  {portal.clients.map((client) => <option key={client.id} value={client.id}>{client.firstName} {client.lastName} · {client.phone ?? "bez telefona"}</option>)}
                </select>
              </div>
              {!booking.salonCustomerId && <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Ime</Label><Input className="mt-1" value={booking.firstName} onChange={(event) => setBooking({ ...booking, firstName: event.target.value })} /></div>
                <div><Label>Prezime</Label><Input className="mt-1" value={booking.lastName} onChange={(event) => setBooking({ ...booking, lastName: event.target.value })} /></div>
                <div><Label>Telefon</Label><Input className="mt-1" value={booking.phone} onChange={(event) => setBooking({ ...booking, phone: event.target.value })} /></div>
                <div><Label>Email (opciono)</Label><Input className="mt-1" type="email" value={booking.email} onChange={(event) => setBooking({ ...booking, email: event.target.value })} /></div>
              </div>}
              <div className="rounded-lg border bg-muted/20 p-3">
                <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={seriesMode} onChange={(event) => { setSeriesMode(event.target.checked); setSeriesPreview(null); }} /><Repeat2 className="h-4 w-4 text-primary" />Zakaži seriju termina</label>
                {seriesMode && <div className="mt-3 flex flex-wrap gap-2">
                  <select className="h-9 rounded-md border bg-background px-2 text-sm" value={seriesRule} onChange={(event) => setSeriesRule(event.target.value)}>
                    <option value="daily">Svaki dan</option>
                    <option value="every-2-days">Svaka 2 dana</option>
                    <option value="every-3-days">Svaka 3 dana</option>
                    <option value="weekly">Nedeljno</option>
                    <option value="biweekly">Na 2 nedelje</option>
                    <option value="monthly">Mesečno</option>
                  </select>
                  <Input className="h-9 w-20" type="number" min="1" max="24" value={seriesCount} onChange={(event) => setSeriesCount(event.target.value)} />
                  <Button type="button" size="sm" variant="outline" onClick={() => { setBooking({ ...booking, slots: recurringSlots(booking.slots[0]!, seriesRule, Number(seriesCount) || 1) }); setSeriesPreview(null); }}>Primeni</Button>
                  <Button type="button" size="sm" variant="outline" onClick={previewEmployeeSeries}>Proveri</Button>
                </div>}
              </div>
              <div className="space-y-2">
                <Label>Termini</Label>
                {booking.slots.map((slot, index) => {
                  const state = seriesPreview?.slots.find((item) => item.date.slice(0, 10) === slot.date && item.startTime === slot.startTime);
                  return <div className="flex items-center gap-2" key={index}>
                    <Input type="date" value={slot.date} onChange={(event) => { setBooking({ ...booking, slots: booking.slots.map((item, itemIndex) => itemIndex === index ? { ...item, date: event.target.value } : item) }); setSeriesPreview(null); }} />
                    <Input type="time" value={slot.startTime} onChange={(event) => { setBooking({ ...booking, slots: booking.slots.map((item, itemIndex) => itemIndex === index ? { ...item, startTime: event.target.value } : item) }); setSeriesPreview(null); }} />
                    {state && <span className={state.available ? "text-xs text-emerald-700" : "text-xs text-destructive"}>{state.available ? "Slobodno" : "Konflikt"}</span>}
                    {booking.slots.length > 1 && <Button type="button" variant="outline" size="icon" aria-label="Ukloni termin" onClick={() => { setBooking({ ...booking, slots: booking.slots.filter((_, itemIndex) => itemIndex !== index) }); setSeriesPreview(null); }}><Trash2 className="h-4 w-4" /></Button>}
                  </div>;
                })}
                <Button type="button" size="sm" variant="outline" onClick={() => { setBooking({ ...booking, slots: [...booking.slots, { date: booking.slots.at(-1)?.date ?? today(), startTime: "10:00" }] }); setSeriesPreview(null); }}><Plus className="mr-1 h-3.5 w-3.5" />Zakaži još jedan termin</Button>
              </div>
              <Button className="w-full" onClick={book}>Zakaži {seriesMode ? "seriju" : booking.slots.length > 1 ? "termine" : "termin"}</Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Moj profil</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Fotografija profila</Label><div className="flex items-center gap-3">{profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt="Pregled fotografije profila" size={128} responsiveSizes="64px" className="h-16 w-16" /> : null}<Button asChild type="button" variant="outline" disabled={uploadingAvatar}><label className="cursor-pointer">{uploadingAvatar ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}Izaberi fotografiju<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void uploadAvatar(event)} disabled={uploadingAvatar} /></label></Button></div></div>
              <div><Label>Opis</Label><Textarea className="mt-1" value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} /></div>
              <div><Label>Kontakt telefon</Label><Input className="mt-1" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></div>
              <Button className="w-full" onClick={saveProfile} disabled={uploadingAvatar}>Sačuvaj profil</Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Zahtev za odsustvo</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Od</Label><Input className="mt-1" type="date" value={leave.startDate} onChange={(event) => setLeave({ ...leave, startDate: event.target.value })} /></div>
                <div><Label>Do</Label><Input className="mt-1" type="date" value={leave.endDate} onChange={(event) => setLeave({ ...leave, endDate: event.target.value })} /></div>
              </div>
              <div><Label>Razlog</Label><Textarea className="mt-1" value={leave.reason} onChange={(event) => setLeave({ ...leave, reason: event.target.value })} /></div>
              <Button className="w-full" onClick={requestLeave}>Pošalji zahtev</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </BusinessLayout>
  );
}

function Metric({ title, value, icon }: { title: string; value: number; icon: ReactNode }) {
  return <Card><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{title}</p><p className="text-2xl font-bold">{value}</p></div><div className="text-primary">{icon}</div></CardContent></Card>;
}