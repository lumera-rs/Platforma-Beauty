import { useMemo, useState } from "react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
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
  useUpdateSalonCustomer,
} from "@workspace/api-client-react";
import { CalendarDays, Loader2, MessageSquareOff, Plus, UserRoundPlus } from "lucide-react";

const today = new Date().toISOString().slice(0, 10);
const initialForm = { serviceId: "", employeeId: "", date: today, startTime: "10:00", notes: "", customerId: "new", firstName: "", lastName: "", phone: "", email: "" };

export default function OwnerCalendar() {
  const { data: userResp } = useGetCurrentUser();
  const { data: appointments, isLoading, refetch: refetchAppointments } = useListSalonAppointments(undefined, { query: { enabled: !!userResp?.user, queryKey: getListSalonAppointmentsQueryKey(undefined) }});
  const { data: services } = useListSalonServices({ query: { enabled: !!userResp?.user, queryKey: getListSalonServicesQueryKey() } });
  const { data: employees } = useListSalonEmployees({ query: { enabled: !!userResp?.user, queryKey: getListSalonEmployeesQueryKey() } });
  const { data: customers, refetch: refetchCustomers } = useListSalonCustomers({ query: { enabled: !!userResp?.user, queryKey: getListSalonCustomersQueryKey() } });
  const create = useCreateSalonAppointment();
  const updateCustomer = useUpdateSalonCustomer();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const sorted = useMemo(() => [...(appointments ?? [])].sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)), [appointments]);

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
        setOpen(false); setForm(initialForm); refetchAppointments(); refetchCustomers();
      },
      onError: (error) => toast.error("Termin nije sačuvan", { description: error instanceof Error ? error.message : "Proverite dostupnost termina." }),
    });
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto flex flex-col items-start gap-8 px-4 py-8 md:flex-row">
        <OwnerSidebar current="/vlasnik/kalendar" />
        <main className="w-full flex-1 space-y-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div><h1 className="font-serif text-3xl font-bold">Kalendar termina</h1><p className="text-muted-foreground">Zakazivanja, walk-in klijenti i SMS obaveštenja na jednom mestu.</p></div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button data-testid="calendar-new-appointment"><Plus className="mr-2 h-4 w-4" /> Novi termin</Button></DialogTrigger>
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
          <div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /> Predstojeći termini</CardTitle></CardHeader><CardContent className="p-0">{isLoading ? <div className="flex justify-center p-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div> : sorted.length ? <div className="divide-y">{sorted.map((appointment) => <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" key={appointment.id}><div><p className="font-semibold">{appointment.customerName}</p><p className="text-sm text-muted-foreground">{appointment.serviceName} · {appointment.employeeName}</p></div><div className="flex items-center gap-3"><span className="text-sm font-medium">{new Date(appointment.date).toLocaleDateString("sr-RS")} · {appointment.startTime}</span><Badge variant={appointment.status === "cancelled" ? "secondary" : "default"}>{appointment.status}</Badge></div></div>)}</div> : <div className="p-12 text-center text-muted-foreground">Nema zakazanih termina za prikaz.</div>}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-lg">CRM kontakti</CardTitle><p className="text-sm text-muted-foreground">Za svakog gosta možete isključiti SMS potvrde i podsetnike.</p></CardHeader><CardContent className="space-y-3">{customers?.length ? customers.map((customer) => <div className="rounded-lg border p-3" key={customer.id}><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{customer.firstName} {customer.lastName}</p><p className="text-xs text-muted-foreground">{customer.phone ?? "Nema telefona"} · {customer.visitCount} termina</p></div><Button size="sm" variant={customer.smsOptOut ? "outline" : "ghost"} disabled={updateCustomer.isPending} onClick={() => updateCustomer.mutate({ customerId: customer.id, data: { smsOptOut: !customer.smsOptOut } }, { onSuccess: () => { toast.success(customer.smsOptOut ? "SMS obaveštenja su uključena" : "SMS obaveštenja su isključena"); refetchCustomers(); } })}>{customer.smsOptOut ? "Uključi SMS" : <><MessageSquareOff className="mr-1 h-3.5 w-3.5" /> Isključi SMS</>}</Button></div></div>) : <p className="py-8 text-center text-sm text-muted-foreground">CRM se puni pri ručnom zakazivanju ili online rezervaciji.</p>}</CardContent></Card>
          </div>
        </main>
      </div>
    </BusinessLayout>
  );
}