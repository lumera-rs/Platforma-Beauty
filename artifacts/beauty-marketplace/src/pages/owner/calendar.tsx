import { type ComponentProps, useMemo, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  getListSalonAppointmentsQueryKey,
  getListSalonCustomersQueryKey,
  getListSalonEmployeesQueryKey,
  getListSalonServicesQueryKey,
  useCreateSalonAppointment,
  useGetCurrentUser,
  useListSalonAppointments,
  useListSalonCustomers,
  useListSalonEmployees,
  useListSalonServices,
  useUpdateSalonAppointment,
  useUpdateSalonCustomer,
} from "@workspace/api-client-react";
import { CalendarDays, Clock3, Loader2, MessageSquareOff, Pencil, Plus, UserRoundPlus } from "lucide-react";

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

const today = dateKey(new Date());
const initialForm = { serviceId: "", employeeId: "", date: today, startTime: "10:00", notes: "", customerId: "new", firstName: "", lastName: "", phone: "", email: "" };

export default function OwnerCalendar() {
  const { data: userResp } = useGetCurrentUser();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const appointmentParams = useMemo(() => selectedDate ? { from: selectedDate, to: selectedDate } : undefined, [selectedDate]);
  const { data: appointments, isLoading, isFetching, refetch: refetchAppointments } = useListSalonAppointments(appointmentParams, {
    query: {
      enabled: !!userResp?.user && !!selectedDate,
      queryKey: getListSalonAppointmentsQueryKey(appointmentParams),
    },
  });
  const monthParams = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    return {
      from: dateKey(new Date(year, month, 1)),
      to: dateKey(new Date(year, month + 1, 0)),
    };
  }, [visibleMonth]);
  const { data: monthAppointments } = useListSalonAppointments(monthParams, {
    query: {
      enabled: !!userResp?.user,
      queryKey: getListSalonAppointmentsQueryKey(monthParams),
    },
  });
  const { data: services } = useListSalonServices({ query: { enabled: !!userResp?.user, queryKey: getListSalonServicesQueryKey() } });
  const { data: employees } = useListSalonEmployees({ query: { enabled: !!userResp?.user, queryKey: getListSalonEmployeesQueryKey() } });
  const { data: customers, refetch: refetchCustomers } = useListSalonCustomers({ query: { enabled: !!userResp?.user, queryKey: getListSalonCustomersQueryKey() } });
  const create = useCreateSalonAppointment();
  const updateAppointment = useUpdateSalonAppointment();
  const updateCustomer = useUpdateSalonCustomer();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [editing, setEditing] = useState<{ id: string; status: "pending" | "confirmed" | "completed" | "cancelled" | "no-show"; employeeId: string; notes: string } | null>(null);
  const sorted = useMemo(() => [...(appointments ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime)), [appointments]);
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

  const openNewAppointment = () => {
    setForm({ ...initialForm, date: selectedDate ?? today });
    setOpen(true);
  };

  const createAppointment = (event: React.FormEvent) => {
    event.preventDefault();
    if (form.customerId === "new" && (!form.firstName.trim() || !form.lastName.trim() || !form.phone.trim())) {
      toast.error("Unesite ime, prezime i telefon gosta.");
      return;
    }
    create.mutate({
      data: {
        serviceId: form.serviceId,
        employeeId: form.employeeId || null,
        date: form.date,
        startTime: form.startTime,
        notes: form.notes || undefined,
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
        refetchCustomers();
      },
      onError: (error) => toast.error("Termin nije sačuvan", { description: error instanceof Error ? error.message : "Proverite dostupnost termina." }),
    });
  };

  const saveAppointmentUpdate = () => {
    if (!editing) return;
    updateAppointment.mutate({ appointmentId: editing.id, data: { status: editing.status, ...(editing.employeeId ? { employeeId: editing.employeeId } : {}), notes: editing.notes } }, {
      onSuccess: () => { toast.success("Termin je izmenjen"); setEditing(null); refetchAppointments(); },
      onError: (error) => toast.error("Termin nije izmenjen", { description: error instanceof Error ? error.message : "Pokušajte ponovo." }),
    });
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto flex w-full max-w-[1600px] flex-col items-start gap-8 px-4 py-8 lg:px-6 xl:flex-row">
        <OwnerSidebar current="/vlasnik/kalendar" />
        <main className="w-full min-w-0 flex-1 space-y-8">
          <div className="flex flex-col justify-between gap-5 border-b pb-6 sm:flex-row sm:items-end">
            <div><p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-primary">Organizacija dana</p><h1 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">Kalendar termina</h1><p className="mt-2 max-w-2xl text-muted-foreground">Izaberite dan i pregledajte raspored, walk-in klijente i SMS obaveštenja na jednom mestu.</p></div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button data-testid="calendar-new-appointment" onClick={openNewAppointment}><Plus className="mr-2 h-4 w-4" /> Novi termin</Button></DialogTrigger>
              <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                <DialogHeader><DialogTitle>Ručno zakazivanje termina</DialogTitle></DialogHeader>
                <form className="space-y-5 pt-2" onSubmit={createAppointment}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2"><Label>Usluga</Label><select required className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}><option value="">Izaberite uslugu</option>{services?.filter((service) => service.active).map((service) => <option key={service.id} value={service.id}>{service.name} · {service.durationMinutes} min</option>)}</select></div>
                    <div className="space-y-2"><Label>Zaposleni</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}><option value="">Prvi dostupan</option>{employees?.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></div>
                    <div className="space-y-2"><Label>Datum</Label><Input required type="date" min={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
                    <div className="space-y-2"><Label>Vreme</Label><Input required type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
                  </div>
                  <div className="space-y-2"><Label>Klijent</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}><option value="new">Novi klijent (brzi unos)</option>{customers?.map((customer) => <option key={customer.id} value={customer.id}>{customer.firstName} {customer.lastName} · {customer.phone ?? "bez telefona"}</option>)}</select></div>
                  {form.customerId === "new" && <div className="rounded-lg border border-dashed bg-muted/30 p-4"><div className="mb-3 flex items-center gap-2 font-medium"><UserRoundPlus className="h-4 w-4 text-primary" /> Walk-in klijent</div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Ime</Label><Input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div><div className="space-y-2"><Label>Prezime</Label><Input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div><div className="space-y-2"><Label>Telefon</Label><Input required placeholder="+381 6x..." value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div><div className="space-y-2"><Label>E-mail <span className="text-muted-foreground">(opciono)</span></Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div></div></div>}
                  <div className="space-y-2"><Label>Napomena <span className="text-muted-foreground">(opciono)</span></Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                  <Button className="w-full" type="submit" disabled={create.isPending}>{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sačuvaj termin</Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          <Dialog open={!!editing} onOpenChange={(isOpen) => !isOpen && setEditing(null)}>
            <DialogContent>
              <DialogHeader><DialogTitle>Izmeni termin</DialogTitle></DialogHeader>
              {editing && <div className="space-y-4">
                <div className="space-y-2"><Label>Status</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as typeof editing.status })}><option value="pending">Na čekanju</option><option value="confirmed">Potvrđen</option><option value="completed">Završen</option><option value="cancelled">Otkazan</option><option value="no-show">Nije došao</option></select></div>
                <div className="space-y-2"><Label>Napomena</Label><Textarea value={editing.notes} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /></div>
                <Button className="w-full" onClick={saveAppointmentUpdate} disabled={updateAppointment.isPending}>{updateAppointment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sačuvaj izmene</Button>
              </div>}
            </DialogContent>
          </Dialog>
          <div className="grid gap-7 xl:grid-cols-[minmax(370px,.82fr)_minmax(0,1.7fr)]">
            <Card className="h-fit overflow-hidden border-primary/10 shadow-md">
              <CardHeader className="border-b bg-primary/[0.035] px-5 py-5 sm:px-7">
                <CardTitle className="flex items-center gap-3 text-xl"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="h-5 w-5" /></span> Izaberite datum</CardTitle>
                <p className="pl-[52px] text-sm text-muted-foreground">Termini se prikazuju tek nakon izbora dana.</p>
              </CardHeader>
              <CardContent className="space-y-6 px-4 py-5 sm:px-6 sm:py-7">
                <div className="rounded-2xl border bg-background p-2 shadow-sm sm:p-4">
                  <Calendar
                    mode="single"
                    selected={selectedDate ? dateAtUtcNoon(selectedDate) : undefined}
                    onSelect={(date) => date && selectDate(dateKey(date))}
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
                    {quickDates.map((quickDate) => <Button key={quickDate.label} type="button" variant={selectedDate === quickDate.value ? "default" : "outline"} className={cn("h-auto min-h-[72px] flex-col items-start justify-center gap-1 rounded-xl px-4 py-3 text-left transition-all", selectedDate === quickDate.value ? "shadow-md shadow-primary/20" : "hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/[0.04]")} aria-pressed={selectedDate === quickDate.value} onClick={() => selectDate(quickDate.value)}><span className="text-sm font-semibold">{quickDate.label}</span><span className={cn("text-xs font-normal", selectedDate === quickDate.value ? "text-primary-foreground/75" : "text-muted-foreground")}>{shortDateLabel(quickDate.value)}</span></Button>)}
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
                      <span>{selectedDate ? `Termini · ${dateLabel(selectedDate)}` : "Termini za izabrani datum"}</span>
                    </CardTitle>
                    {selectedDate && <p className="mt-2 pl-[52px] text-sm text-muted-foreground">Raspored za izabrani dan, poređan po vremenu.</p>}
                  </div>
                  {selectedDate && sorted.length > 0 && <Badge variant="outline" className="w-fit rounded-full px-3 py-1 text-sm">{sorted.length} {sorted.length === 1 ? "termin" : "termina"}</Badge>}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {!selectedDate ? <div className="flex min-h-72 flex-col items-center justify-center p-8 text-center"><CalendarDays className="mb-3 h-10 w-10 text-muted-foreground/60" /><p className="font-medium">Izaberite datum da vidite zakazane termine</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">Kliknite na dan u kalendaru ili izaberite Danas, Sutra ili Prekosutra.</p></div>
                  : isLoading || isFetching ? <div className="flex min-h-72 flex-col items-center justify-center gap-3 p-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Učitavamo termine za izabrani datum…</p></div>
                    : sorted.length ? <div className="space-y-3 bg-muted/[0.18] p-4 sm:p-5">{sorted.map((appointment) => <div className="group flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md sm:flex-row sm:items-center sm:justify-between sm:p-5" key={appointment.id}><div className="flex min-w-0 items-start gap-4"><div className="flex h-[60px] w-[78px] shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-primary"><span className="text-xl font-bold tracking-tight">{appointment.startTime}</span><span className="text-[10px] font-medium uppercase tracking-wider text-primary/70">početak</span></div><div className="min-w-0 pt-0.5"><p className="truncate text-base font-bold">{appointment.customerName}</p><p className="mt-1 truncate text-sm font-medium text-foreground/80">{appointment.serviceName}</p><p className="mt-1 text-sm text-muted-foreground">Zaposleni: {appointment.employeeName}</p>{appointment.notes && <p className="mt-2 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">{appointment.notes}</p>}</div></div><div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end"><Badge variant="outline" className={cn("rounded-full px-3 py-1 text-xs font-semibold", statusClasses[appointment.status])}>{statusLabels[appointment.status]}</Badge><Button size="sm" variant="outline" className="gap-1.5 opacity-90 transition-opacity group-hover:opacity-100" aria-label={`Izmeni termin za ${appointment.customerName}`} onClick={() => setEditing({ id: appointment.id, status: appointment.status, employeeId: "", notes: appointment.notes ?? "" })}><Pencil className="h-3.5 w-3.5" /> Izmeni</Button></div></div>)}</div>
                      : <div className="flex min-h-80 flex-col items-center justify-center p-8 text-center"><div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CalendarDays className="h-8 w-8" /></div><p className="text-lg font-semibold">Nema zakazanih termina za {dateLabel(selectedDate)}</p><p className="mt-2 max-w-sm text-sm text-muted-foreground">Kada klijent rezerviše termin za ovaj dan, pojaviće se ovde.</p><Button variant="outline" className="mt-5" onClick={openNewAppointment}><Plus className="mr-2 h-4 w-4" /> Dodaj termin</Button></div>}
              </CardContent>
            </Card>
          </div>
          <Card><CardHeader><CardTitle className="text-lg">CRM kontakti</CardTitle><p className="text-sm text-muted-foreground">Za svakog gosta možete isključiti SMS potvrde i podsetnike.</p></CardHeader><CardContent className="space-y-3">{customers?.length ? customers.map((customer) => <div className="rounded-lg border p-3" key={customer.id}><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{customer.firstName} {customer.lastName}</p><p className="text-xs text-muted-foreground">{customer.phone ?? "Nema telefona"} · {customer.visitCount} termina</p></div><Button size="sm" variant={customer.smsOptOut ? "outline" : "ghost"} disabled={updateCustomer.isPending} onClick={() => updateCustomer.mutate({ customerId: customer.id, data: { smsOptOut: !customer.smsOptOut } }, { onSuccess: () => { toast.success(customer.smsOptOut ? "SMS obaveštenja su uključena" : "SMS obaveštenja su isključena"); refetchCustomers(); } })}>{customer.smsOptOut ? "Uključi SMS" : <><MessageSquareOff className="mr-1 h-3.5 w-3.5" /> Isključi SMS</>}</Button></div></div>) : <p className="py-8 text-center text-sm text-muted-foreground">CRM se puni pri ručnom zakazivanju ili online rezervaciji.</p>}</CardContent></Card>
        </main>
      </div>
    </BusinessLayout>
  );
}