import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListEmployeeLocationAssignmentsQueryKey, useListEmployeeLocationAssignments, useUpsertEmployeeLocationAssignment } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, Copy, ImagePlus, KeyRound, Loader2, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { AvatarImage } from "@/components/optimized-image";
import { uploadOptimizedImage } from "@/lib/media-upload";
import { useToast } from "@/hooks/use-toast";

type Service = { id: string; name: string; active: boolean };
type Employee = { id: string; name: string; role: string; bio: string; avatarUrl: string; email: string | null; specialties: string[]; serviceIds: string[]; serviceNames: string[]; canOrderIndependently: boolean; account: { active: boolean; email: string; mustChangePassword: boolean } | null };
type LeaveRequest = { id: string; employeeName: string; startDate: string; endDate: string; reason: string; status: "pending" | "approved" | "rejected" };
type ManagedLocation = { id: string; name: string };
const empty = { name: "", role: "", bio: "", avatarUrl: "", email: "", specialties: "", serviceIds: [] as string[], canOrderIndependently: false };

export default function OwnerEmployees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [credentials, setCredentials] = useState<{ employeeId: string; email: string; temporaryPassword: string } | null>(null);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);
  const [deactivation, setDeactivation] = useState<{ employee: Employee; futureAppointmentCount: number; hasLoginAccount: boolean; willDeactivateLogin: boolean } | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [locations, setLocations] = useState<ManagedLocation[]>([]);
  const load = async () => {
    const [staff, catalog, requests, locationResponse] = await Promise.all([fetch("/api/salon/employees", { credentials: "include" }), fetch("/api/salon/services", { credentials: "include" }), fetch("/api/salon/leave-requests", { credentials: "include" }), fetch("/api/salon/managed-salons", { credentials: "include" })]);
    if (!staff.ok || !catalog.ok || !requests.ok) throw new Error("Podaci o timu nisu učitani.");
    setEmployees(await staff.json()); setServices(await catalog.json()); setLeaveRequests(await requests.json());
    if (locationResponse.ok) setLocations((await locationResponse.json() as { salons: ManagedLocation[] }).salons);
    setLoading(false);
  };
  useEffect(() => { load().catch((error) => { toast.error(error.message); setLoading(false); }); }, []);
  const begin = (employee?: Employee) => {
    setEditing(employee ?? null);
    setForm(employee ? { name: employee.name, role: employee.role, bio: employee.bio, avatarUrl: employee.avatarUrl, email: employee.email ?? "", specialties: employee.specialties.join(", "), serviceIds: employee.serviceIds, canOrderIndependently: employee.canOrderIndependently } : empty);
    setOpen(true);
  };
  const save = async () => {
    if (!form.name.trim() || !form.role.trim()) { toast.error("Ime i uloga su obavezni."); return; }
    const response = await fetch(editing ? `/api/salon/employees/${editing.id}` : "/api/salon/employees", {
      method: editing ? "PATCH" : "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, specialties: form.specialties.split(",").map((item) => item.trim()).filter(Boolean) }),
    });
    const result = await response.json();
    if (!response.ok) { toast.error(result.error ?? "Čuvanje nije uspelo."); return; }
    toast.success(editing ? "Profil zaposlenog je izmenjen." : "Zaposleni je dodat.");
    setOpen(false); await load();
  };
  const uploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const asset = await uploadOptimizedImage(file, "employee-avatar", editing?.id);
      setForm((current) => ({ ...current, avatarUrl: asset.imageUrl }));
      toast.success("Fotografija zaposlenog je obrađena.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload fotografije nije uspeo.");
    } finally {
      setUploadingAvatar(false);
    }
  };
  const toggleService = (serviceId: string) => setForm({ ...form, serviceIds: form.serviceIds.includes(serviceId) ? form.serviceIds.filter((id) => id !== serviceId) : [...form.serviceIds, serviceId] });
  const makeAccess = async (employee: Employee, reset = false) => {
    try {
      const response = await fetch(`/api/salon/employees/${employee.id}/access${reset ? "/reset-password" : ""}`, { method: "POST", credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Pristupni podaci nisu kreirani.");
      setCredentials({ employeeId: employee.id, email: result.email, temporaryPassword: result.temporaryPassword });
      toast.success(reset ? "Nova privremena lozinka je generisana." : "Pristupni podaci su generisani.");
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Radnja nije uspela."); }
  };
  const decideLeave = async (request: LeaveRequest, status: "approved" | "rejected") => {
    try {
      const response = await fetch(`/api/salon/leave-requests/${request.id}`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Zahtev nije obrađen.");
      toast.success(status === "approved" ? "Odsustvo je odobreno." : "Zahtev je odbijen."); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Radnja nije uspela."); }
  };
  const copyCredentials = async () => {
    if (!credentials) return;
    await navigator.clipboard.writeText(`Email: ${credentials.email}\nPrivremena lozinka: ${credentials.temporaryPassword}`);
    toast.success("Pristupni podaci su kopirani.");
  };
  const beginDeactivation = async (employee: Employee) => {
    try {
      const response = await fetch(`/api/salon/employees/${employee.id}/deactivation-preview`, { credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Nije moguće pripremiti deaktivaciju.");
      setDeactivation({ employee, futureAppointmentCount: result.futureAppointmentCount, hasLoginAccount: result.hasLoginAccount, willDeactivateLogin: result.willDeactivateLogin });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Radnja nije uspela."); }
  };
  const confirmDeactivation = async () => {
    if (!deactivation) return;
    setDeactivating(true);
    try {
      const response = await fetch(`/api/salon/employees/${deactivation.employee.id}/deactivate`, { method: "POST", credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Deaktivacija nije uspela.");
      toast.success("Zaposleni je deaktiviran.", { description: result.loginAccountDeactivated ? "Profil i pristupni nalog su ugašeni." : "Profil je uklonjen iz aktivnog tima." });
      setDeactivation(null); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Radnja nije uspela."); }
    finally { setDeactivating(false); }
  };
  return <BusinessLayout><div className="container mx-auto flex flex-col gap-8 px-4 py-8 md:flex-row">
    <OwnerSidebar current="/vlasnik/zaposleni" />
    <main className="min-w-0 flex-1 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="font-serif text-3xl font-bold">Zaposleni i usluge</h1><p className="text-muted-foreground">Odredite koje usluge svaki član tima obavlja.</p></div><Button onClick={() => begin()}><Plus className="mr-2 h-4 w-4" />Dodaj zaposlenog</Button></div>
      {loading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : <><div className="grid min-w-0 gap-4 lg:grid-cols-2">{employees.map((employee) => <Card key={employee.id} className="min-w-0 overflow-hidden"><CardHeader className="flex-row flex-wrap items-center gap-4 space-y-0"><AvatarImage className="h-14 w-14 shrink-0" size={112} src={employee.avatarUrl || "/default-salon.jpg"} alt={`Fotografija zaposlenog ${employee.name}`} responsiveSizes="56px" /><div className="min-w-0 flex-1"><CardTitle className="break-words">{employee.name}</CardTitle><p className="break-words text-sm text-muted-foreground">{employee.role}</p></div><div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto"><Button className="min-w-0 flex-1 sm:flex-none" size="sm" variant="outline" onClick={() => begin(employee)}>Izmeni</Button><Button size="sm" variant="outline" className="min-w-0 flex-1 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground sm:flex-none" aria-label={`Deaktiviraj ${employee.name}`} onClick={() => beginDeactivation(employee)}><Trash2 className="mr-1.5 h-4 w-4" />Deaktiviraj</Button></div></CardHeader><CardContent className="min-w-0 space-y-3">{employee.bio && <p className="break-words text-sm text-muted-foreground">{employee.bio}</p>}<EmployeeLocations employeeId={employee.id} locations={locations} /><div><p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Usluge koje obavlja</p><div className="flex min-w-0 flex-wrap gap-1.5">{employee.serviceNames.length ? employee.serviceNames.map((name) => <Badge key={name} variant="secondary" className="max-w-full whitespace-normal break-words">{name}</Badge>) : <span className="text-sm text-amber-700">Nijedna usluga nije dodeljena</span>}</div></div><Badge variant={employee.canOrderIndependently ? "default" : "outline"}>{employee.canOrderIndependently ? "Samostalno naručivanje" : "Naručivanje uz odobrenje"}</Badge><div className="min-w-0 rounded-lg border bg-muted/20 p-3"><div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold">Pristup zaposlenog</p><p className="break-all text-xs text-muted-foreground">{employee.account ? employee.account.email : employee.email || "Email će biti automatski generisan"}</p></div>{employee.account ? <Badge variant="secondary">{employee.account.active ? "Nalog aktivan" : "Nalog neaktivan"}</Badge> : <Badge variant="outline">Nema nalog</Badge>}</div>{credentials?.employeeId === employee.id && <div className="mt-3 min-w-0 rounded-md bg-background p-3 text-sm"><p className="font-semibold">Pristupni podaci — prosledite zaposlenom</p><p className="mt-1 break-all">Email: <b>{credentials.email}</b></p><p className="break-all">Privremena lozinka: <b>{credentials.temporaryPassword}</b></p><p className="mt-1 text-xs text-amber-700">Lozinka se mora promeniti pri prvom prijavljivanju.</p><Button className="mt-2" size="sm" variant="outline" onClick={copyCredentials}><Copy className="mr-1.5 h-3.5 w-3.5" />Kopiraj</Button></div>}<Button className="mt-3 w-full" size="sm" variant={employee.account ? "outline" : "default"} onClick={() => makeAccess(employee, Boolean(employee.account))}><KeyRound className="mr-2 h-4 w-4" />{employee.account ? "Resetuj lozinku" : "Kreiraj pristupne podatke"}</Button></div></CardContent></Card>)}</div>
      <Card><CardHeader><CardTitle className="text-lg">Zahtevi za odsustvo</CardTitle></CardHeader><CardContent className="space-y-3">{leaveRequests.filter((request) => request.status === "pending").length ? leaveRequests.filter((request) => request.status === "pending").map((request) => <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between" key={request.id}><div><p className="font-medium">{request.employeeName}</p><p className="text-sm text-muted-foreground">{request.startDate} – {request.endDate} · {request.reason}</p></div><div className="flex gap-2"><Button size="sm" onClick={() => decideLeave(request, "approved")}><Check className="mr-1 h-4 w-4" />Odobri</Button><Button size="sm" variant="outline" onClick={() => decideLeave(request, "rejected")}>Odbij</Button></div></div>) : <p className="text-sm text-muted-foreground">Nema zahteva koji čekaju odluku.</p>}</CardContent></Card></>}
    </main>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto"><DialogHeader><DialogTitle>{editing ? "Izmeni zaposlenog" : "Novi zaposleni"}</DialogTitle></DialogHeader><div className="space-y-4 py-2"><div className="grid gap-3 sm:grid-cols-2"><div><Label>Ime i prezime</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div><div><Label>Uloga</Label><Input placeholder="npr. Frizer" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></div></div><div><Label>Email zaposlenog</Label><Input type="email" placeholder="ime@salon.rs" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div><div><Label>Kratka biografija</Label><Input value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></div><div className="space-y-2"><Label>Fotografija zaposlenog</Label><div className="flex items-center gap-3">{form.avatarUrl ? <AvatarImage className="h-16 w-16" size={128} src={form.avatarUrl} alt="Pregled fotografije zaposlenog" responsiveSizes="64px" /> : null}<Button asChild type="button" variant="outline" disabled={uploadingAvatar}><label className="cursor-pointer">{uploadingAvatar ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}Izaberi fotografiju<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void uploadAvatar(event)} disabled={uploadingAvatar} /></label></Button></div></div><div><Label>Specijalnosti (odvojite zarezom)</Label><Input value={form.specialties} onChange={(e) => setForm({ ...form, specialties: e.target.value })} /></div><label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"><Checkbox className="mt-0.5" checked={form.canOrderIndependently} onCheckedChange={(checked) => setForm({ ...form, canOrderIndependently: checked === true })} /><span><span className="block text-sm font-medium">Sme samostalno da naručuje</span><span className="block text-xs text-muted-foreground">Ako je isključeno, porudžbina zaposlenog mora prvo da bude odobrena.</span></span></label><div><Label className="mb-2 block">Usluge koje obavlja</Label><div className="space-y-2 rounded-lg border p-3">{services.filter((service) => service.active).map((service) => <label key={service.id} className="flex cursor-pointer items-center gap-3 text-sm"><Checkbox checked={form.serviceIds.includes(service.id)} onCheckedChange={() => toggleService(service.id)} />{service.name}</label>)}</div></div><Button className="w-full" onClick={save} disabled={uploadingAvatar}><Users className="mr-2 h-4 w-4" />Sačuvaj zaposlenog</Button></div></DialogContent></Dialog>
    <Dialog open={!!deactivation} onOpenChange={(isOpen) => !isOpen && setDeactivation(null)}><DialogContent><DialogHeader><DialogTitle>Deaktivirati zaposlenog?</DialogTitle><DialogDescription>Profil ostaje sačuvan u istoriji termina, recenzijama i izveštajima.</DialogDescription></DialogHeader>{deactivation && <div className="space-y-4"><div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><div className="flex gap-2 font-semibold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{deactivation.futureAppointmentCount ? `${deactivation.employee.name} ima ${deactivation.futureAppointmentCount} budućih termina.` : "Zaposleni nema buduće termine."}</div>{deactivation.futureAppointmentCount > 0 && <p className="mt-2">Termini ostaju zakazani. Ručno ih preraspodelite ili kontaktirajte klijente pre termina.</p>}</div>{deactivation.willDeactivateLogin ? <p className="text-sm text-muted-foreground">Ovo je poslednja aktivna lokacija ovog zaposlenog — povezani nalog i aktivne prijave biće odmah deaktivirani.</p> : deactivation.hasLoginAccount && <p className="text-sm text-muted-foreground">Zaposleni ostaje aktivan i prijavljen na svojim ostalim lokacijama — deaktivira se samo pristup ovom salonu.</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setDeactivation(null)}>Odustani</Button><Button variant="destructive" disabled={deactivating} onClick={confirmDeactivation}>{deactivating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Da, deaktiviraj</Button></div></div>}</DialogContent></Dialog>
  </div></BusinessLayout>;
}

function EmployeeLocations({ employeeId, locations }: { employeeId: string; locations: ManagedLocation[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const assignments = useListEmployeeLocationAssignments(employeeId);
  const updateAssignment = useUpsertEmployeeLocationAssignment();
  const save = (salonId: string, data: { active?: boolean; isDefault?: boolean }) => {
    updateAssignment.mutate({ employeeId, salonId, data }, {
      onSuccess: () => {
        toast.success("Dodela lokacije je sačuvana.");
        void queryClient.invalidateQueries({ queryKey: getListEmployeeLocationAssignmentsQueryKey(employeeId) });
      },
      onError: (error) => {
        // The API rejects unsafe removals when future appointments would lose
        // their employee. Keep the assignment visible and state the action.
        const message = error instanceof Error ? error.message : "Promena dodele nije sačuvana.";
        toast.error(message, { description: "Ako postoje budući termini, prvo ih preraspodelite ili otkažite pa ponovite promenu." });
      },
    });
  };
  if (locations.length < 2) return null;
  const byLocation = new Map((assignments.data ?? []).map((assignment) => [assignment.salonId, assignment]));
  return <div className="rounded-lg border bg-muted/15 p-3">
    <p className="text-xs font-semibold uppercase text-muted-foreground">Lokacije zaposlenog</p>
    <p className="mb-2 text-xs text-muted-foreground">Uključite lokacije na kojima zaposleni radi i označite podrazumevanu.</p>
    <div className="space-y-2">
      {locations.map((location) => {
        const assignment = byLocation.get(location.id);
        const active = assignment?.active ?? false;
        return <div className="flex items-center gap-2 text-sm" key={location.id}>
          <Checkbox aria-label={`${location.name} aktivna lokacija`} checked={active} disabled={updateAssignment.isPending || assignments.isLoading} onCheckedChange={(checked) => save(location.id, { active: checked === true })} />
          <span className="min-w-0 flex-1 truncate">{location.name}</span>
          {active && <Button type="button" size="sm" variant={assignment?.isDefault ? "secondary" : "ghost"} disabled={updateAssignment.isPending} onClick={() => save(location.id, { active: true, isDefault: true })}>{assignment?.isDefault ? "Podrazumevana" : "Postavi kao podrazumevanu"}</Button>}
        </div>;
      })}
    </div>
  </div>;
}