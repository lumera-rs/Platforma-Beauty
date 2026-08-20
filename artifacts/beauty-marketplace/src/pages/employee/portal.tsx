import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CalendarDays, CheckCircle2, Clock3, Loader2, Plus, UserRound, XCircle } from "lucide-react";
import { toast } from "sonner";

type Appointment = { id: string; date: string; startTime: string; endTime: string; status: "pending" | "confirmed" | "completed" | "cancelled" | "no-show"; notes: string | null; serviceName: string; customerName: string; customerPhone: string | null };
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
const today = () => new Date().toISOString().slice(0, 10);
const statusLabel: Record<Appointment["status"], string> = { pending: "Na čekanju", confirmed: "Potvrđen", completed: "Završen", cancelled: "Otkazan", "no-show": "No-show" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Radnja nije uspela.");
  return body as T;
}

export function EmployeePasswordChange() {
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (password.length < 8) { toast.error("Lozinka mora imati najmanje 8 karaktera."); return; }
    if (password !== confirm) { toast.error("Lozinke se ne podudaraju."); return; }
    setSaving(true);
    try {
      await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ newPassword: password }) });
      toast.success("Lozinka je promenjena.");
      setLocation("/zaposleni");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Promena lozinke nije uspela."); }
    finally { setSaving(false); }
  };
  return <BusinessLayout><div className="container mx-auto flex max-w-lg flex-1 items-center px-4 py-12"><Card className="w-full"><CardHeader><CardTitle>Postavite svoju lozinku</CardTitle><p className="text-sm text-muted-foreground">Radi bezbednosti, privremenu lozinku morate promeniti pre pristupa portalu.</p></CardHeader><CardContent className="space-y-4"><div><Label>Nova lozinka</Label><Input className="mt-1" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></div><div><Label>Ponovite lozinku</Label><Input className="mt-1" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></div><Button className="w-full" onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sačuvaj novu lozinku</Button></CardContent></Card></div></BusinessLayout>;
}

export default function EmployeePortal() {
  const [portal, setPortal] = useState<Portal | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [date, setDate] = useState(today());
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [booking, setBooking] = useState({ serviceId: "", salonCustomerId: "", firstName: "", lastName: "", phone: "", email: "", slots: [{ date: today(), startTime: "10:00" }] as Slot[] });
  const [profile, setProfile] = useState({ bio: "", avatarUrl: "", phone: "" });
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
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const appointments = useMemo(() => {
    if (!portal) return [];
    const base = new Date(`${date}T12:00:00`);
    const start = new Date(base);
    const end = new Date(base);
    if (view === "week") { const shift = (base.getDay() + 6) % 7; start.setDate(base.getDate() - shift); end.setDate(start.getDate() + 6); }
    if (view === "month") { start.setDate(1); end.setMonth(base.getMonth() + 1, 0); }
    const from = start.toISOString().slice(0, 10); const to = end.toISOString().slice(0, 10);
    return portal.appointments.filter((appointment) => appointment.date >= from && appointment.date <= to);
  }, [portal, date, view]);

  const saveAppointment = async () => {
    if (!editing) return;
    try {
      await api(`/api/employee/appointments/${editing.id}`, { method: "PATCH", body: JSON.stringify({ status: editing.status, notes: editing.notes ?? "" }) });
      toast.success("Termin je ažuriran."); setEditing(null); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Izmena nije uspela."); }
  };
  const saveProfile = async () => {
    try { await api("/api/employee/profile", { method: "PUT", body: JSON.stringify(profile) }); toast.success("Profil je sačuvan."); setProfileOpen(false); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Profil nije sačuvan."); }
  };
  const requestLeave = async () => {
    try { await api("/api/employee/leave-requests", { method: "POST", body: JSON.stringify(leave) }); toast.success("Zahtev je poslat salonu."); setLeaveOpen(false); setLeave({ startDate: today(), endDate: today(), reason: "" }); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Zahtev nije poslat."); }
  };
  const book = async () => {
    try {
      await api("/api/employee/appointments", { method: "POST", body: JSON.stringify({ serviceId: booking.serviceId, salonCustomerId: booking.salonCustomerId || undefined, guest: booking.salonCustomerId ? undefined : { firstName: booking.firstName, lastName: booking.lastName, phone: booking.phone, email: booking.email }, slots: booking.slots }) });
      toast.success(booking.slots.length > 1 ? "Termini su zakazani i potvrde poslate." : "Termin je zakazan i potvrda poslata.");
      setBookingOpen(false); setBooking((current) => ({ ...current, salonCustomerId: "", firstName: "", lastName: "", phone: "", email: "", slots: [{ date: today(), startTime: "10:00" }] })); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Zakazivanje nije uspelo."); }
  };

  if (loading || !portal) return <BusinessLayout><div className="flex justify-center p-20"><Loader2 className="h-8 w-8 animate-spin" /></div></BusinessLayout>;
  return <BusinessLayout><div className="container mx-auto space-y-6 px-4 py-8">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium text-primary">{portal.salon.name}</p><h1 className="font-serif text-3xl font-bold">Portal zaposlenog</h1><p className="text-muted-foreground">Dobro došli, {portal.employee.name}.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setProfileOpen(true)}><UserRound className="mr-2 h-4 w-4" />Moj profil</Button><Button onClick={() => setBookingOpen(true)}><Plus className="mr-2 h-4 w-4" />Zakaži termin</Button></div></div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Metric title="Ove nedelje" value={portal.stats.week} icon={<CalendarDays className="h-5 w-5" />} /><Metric title="Ovog meseca" value={portal.stats.month} icon={<Clock3 className="h-5 w-5" />} /><Metric title="Završeni" value={portal.stats.completed} icon={<CheckCircle2 className="h-5 w-5" />} /><Metric title="No-show" value={portal.stats.noShow} icon={<XCircle className="h-5 w-5" />} /></div>
    <div className="grid gap-6 lg:grid-cols-[1.45fr_.55fr]"><Card><CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Moji termini</CardTitle><p className="text-sm text-muted-foreground">Vidljivi su samo termini dodeljeni vama.</p></div><div className="flex flex-wrap gap-2"><Input className="w-36" type="date" value={date} onChange={(event) => setDate(event.target.value)} /><div className="flex rounded-md border p-0.5">{(["day", "week", "month"] as const).map((item) => <Button key={item} size="sm" variant={view === item ? "default" : "ghost"} onClick={() => setView(item)}>{item === "day" ? "Dan" : item === "week" ? "Nedelja" : "Mesec"}</Button>)}</div></div></CardHeader><CardContent className="p-0">{appointments.length ? <div className="divide-y">{appointments.map((appointment) => <div key={appointment.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{appointment.startTime} · {appointment.customerName}</p><p className="text-sm text-muted-foreground">{appointment.customerPhone ?? "Telefon nije dostupan"} · {appointment.serviceName}</p>{appointment.notes && <p className="mt-1 text-xs text-muted-foreground">Napomena: {appointment.notes}</p>}</div><div className="flex items-center gap-2"><Badge variant={appointment.status === "completed" ? "secondary" : appointment.status === "no-show" ? "destructive" : "default"}>{statusLabel[appointment.status]}</Badge>{!["completed", "no-show", "cancelled"].includes(appointment.status) && <Button size="sm" variant="outline" onClick={() => setEditing({ ...appointment })}>Završi / no-show</Button>}</div></div>)}</div> : <p className="p-10 text-center text-sm text-muted-foreground">Nema vaših termina za izabrani period.</p>}</CardContent></Card>
      <div className="space-y-6"><Card><CardHeader><CardTitle className="text-lg">Moje radno vreme</CardTitle></CardHeader><CardContent className="space-y-2">{portal.schedule.length ? portal.schedule.map((item) => <div key={item.id} className="flex justify-between text-sm"><span>{weekdays[item.weekday - 1]}</span><span>{item.startTime}–{item.endTime}{item.breakStart && ` · pauza ${item.breakStart}–${item.breakEnd}`}</span></div>) : <p className="text-sm text-muted-foreground">Salon još nije uneo posebno radno vreme.</p>}<Button className="mt-2 w-full" variant="outline" onClick={() => setLeaveOpen(true)}>Pošalji zahtev za odsustvo</Button></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-lg">Obaveštenja</CardTitle></CardHeader><CardContent className="space-y-3">{portal.notifications.length ? portal.notifications.map((notification) => <div key={notification.id} className="border-b pb-2 last:border-0"><p className="text-sm font-medium">{notification.title}</p><p className="text-xs text-muted-foreground">{new Date(notification.date).toLocaleDateString("sr-RS")}</p></div>) : <p className="text-sm text-muted-foreground">Nemate nova obaveštenja.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-lg">Moje usluge</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">{portal.services.length ? portal.services.map((service) => <Badge key={service.id} variant="secondary">{service.name} · {service.durationMinutes} min</Badge>) : <p className="text-sm text-muted-foreground">Salon vam još nije dodelio usluge.</p>}</CardContent></Card></div></div>
    <Card><CardHeader><CardTitle className="text-lg">Odsustva i zahtevi</CardTitle></CardHeader><CardContent className="space-y-2">{portal.leaveRequests.length ? portal.leaveRequests.map((item) => <div key={item.id} className="flex items-center justify-between rounded-md border p-3 text-sm"><span>{item.startDate} – {item.endDate} · {item.reason}</span><Badge variant={item.status === "approved" ? "secondary" : item.status === "rejected" ? "destructive" : "default"}>{item.status === "pending" ? "Na čekanju" : item.status === "approved" ? "Odobreno" : "Odbijeno"}</Badge></div>) : <p className="text-sm text-muted-foreground">Nema poslatih zahteva.</p>}</CardContent></Card>
    <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}><DialogContent><DialogHeader><DialogTitle>Ažuriraj termin</DialogTitle></DialogHeader>{editing && <div className="space-y-4"><p className="text-sm text-muted-foreground">{editing.customerName} · {editing.serviceName}</p><div><Label>Status</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as Appointment["status"] })}><option value="completed">Završen</option><option value="no-show">No-show</option></select></div><div><Label>Interna napomena</Label><Textarea className="mt-1" value={editing.notes ?? ""} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /></div><Button className="w-full" onClick={saveAppointment}>Sačuvaj</Button></div>}</DialogContent></Dialog>
    <Dialog open={bookingOpen} onOpenChange={setBookingOpen}><DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto"><DialogHeader><DialogTitle>Zakaži termin za svog klijenta</DialogTitle></DialogHeader><div className="space-y-4"><div><Label>Usluga</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={booking.serviceId} onChange={(event) => setBooking({ ...booking, serviceId: event.target.value })}>{portal.services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.durationMinutes} min</option>)}</select></div><div><Label>Klijent kog ste ranije uslužili</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={booking.salonCustomerId} onChange={(event) => setBooking({ ...booking, salonCustomerId: event.target.value })}><option value="">Brzi unos novog klijenta</option>{portal.clients.map((client) => <option key={client.id} value={client.id}>{client.firstName} {client.lastName} · {client.phone ?? "bez telefona"}</option>)}</select></div>{!booking.salonCustomerId && <div className="grid gap-3 sm:grid-cols-2"><div><Label>Ime</Label><Input className="mt-1" value={booking.firstName} onChange={(event) => setBooking({ ...booking, firstName: event.target.value })} /></div><div><Label>Prezime</Label><Input className="mt-1" value={booking.lastName} onChange={(event) => setBooking({ ...booking, lastName: event.target.value })} /></div><div><Label>Telefon</Label><Input className="mt-1" value={booking.phone} onChange={(event) => setBooking({ ...booking, phone: event.target.value })} /></div><div><Label>Email (opciono)</Label><Input className="mt-1" type="email" value={booking.email} onChange={(event) => setBooking({ ...booking, email: event.target.value })} /></div></div>}<div className="space-y-2"><Label>Termini</Label>{booking.slots.map((slot, index) => <div className="flex gap-2" key={index}><Input type="date" value={slot.date} onChange={(event) => setBooking({ ...booking, slots: booking.slots.map((item, i) => i === index ? { ...item, date: event.target.value } : item) })} /><Input type="time" value={slot.startTime} onChange={(event) => setBooking({ ...booking, slots: booking.slots.map((item, i) => i === index ? { ...item, startTime: event.target.value } : item) })} />{booking.slots.length > 1 && <Button variant="outline" onClick={() => setBooking({ ...booking, slots: booking.slots.filter((_, i) => i !== index) })}>Ukloni</Button>}</div>)}<Button size="sm" variant="outline" onClick={() => setBooking({ ...booking, slots: [...booking.slots, { date: booking.slots.at(-1)?.date ?? today(), startTime: "10:00" }] })}><Plus className="mr-1 h-3.5 w-3.5" />Zakaži još jedan termin</Button></div><Button className="w-full" onClick={book}>Zakaži {booking.slots.length > 1 ? "termine" : "termin"}</Button></div></DialogContent></Dialog>
    <Dialog open={profileOpen} onOpenChange={setProfileOpen}><DialogContent><DialogHeader><DialogTitle>Moj profil</DialogTitle></DialogHeader><div className="space-y-4"><div><Label>URL fotografije</Label><Input className="mt-1" value={profile.avatarUrl} onChange={(event) => setProfile({ ...profile, avatarUrl: event.target.value })} /></div><div><Label>Opis</Label><Textarea className="mt-1" value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} /></div><div><Label>Kontakt telefon</Label><Input className="mt-1" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></div><Button className="w-full" onClick={saveProfile}>Sačuvaj profil</Button></div></DialogContent></Dialog>
    <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}><DialogContent><DialogHeader><DialogTitle>Zahtev za odsustvo</DialogTitle></DialogHeader><div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div><Label>Od</Label><Input className="mt-1" type="date" value={leave.startDate} onChange={(event) => setLeave({ ...leave, startDate: event.target.value })} /></div><div><Label>Do</Label><Input className="mt-1" type="date" value={leave.endDate} onChange={(event) => setLeave({ ...leave, endDate: event.target.value })} /></div></div><div><Label>Razlog</Label><Textarea className="mt-1" value={leave.reason} onChange={(event) => setLeave({ ...leave, reason: event.target.value })} /></div><Button className="w-full" onClick={requestLeave}>Pošalji zahtev</Button></div></DialogContent></Dialog>
  </div></BusinessLayout>;
}

function Metric({ title, value, icon }: { title: string; value: number; icon: ReactNode }) {
  return <Card><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{title}</p><p className="text-2xl font-bold">{value}</p></div><div className="text-primary">{icon}</div></CardContent></Card>;
}