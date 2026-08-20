import { useEffect, useState } from "react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Users } from "lucide-react";
import { toast } from "sonner";

type Service = { id: string; name: string; active: boolean };
type Employee = { id: string; name: string; role: string; bio: string; avatarUrl: string; specialties: string[]; serviceIds: string[]; serviceNames: string[] };
const empty = { name: "", role: "", bio: "", avatarUrl: "", specialties: "", serviceIds: [] as string[] };

export default function OwnerEmployees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    const [staff, catalog] = await Promise.all([fetch("/api/salon/employees", { credentials: "include" }), fetch("/api/salon/services", { credentials: "include" })]);
    if (!staff.ok || !catalog.ok) throw new Error("Podaci o timu nisu učitani.");
    setEmployees(await staff.json()); setServices(await catalog.json()); setLoading(false);
  };
  useEffect(() => { load().catch((error) => { toast.error(error.message); setLoading(false); }); }, []);
  const begin = (employee?: Employee) => {
    setEditing(employee ?? null);
    setForm(employee ? { name: employee.name, role: employee.role, bio: employee.bio, avatarUrl: employee.avatarUrl, specialties: employee.specialties.join(", "), serviceIds: employee.serviceIds } : empty);
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
  const toggleService = (serviceId: string) => setForm({ ...form, serviceIds: form.serviceIds.includes(serviceId) ? form.serviceIds.filter((id) => id !== serviceId) : [...form.serviceIds, serviceId] });
  return <BusinessLayout><div className="container mx-auto flex flex-col gap-8 px-4 py-8 md:flex-row">
    <OwnerSidebar current="/vlasnik/zaposleni" />
    <main className="min-w-0 flex-1 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="font-serif text-3xl font-bold">Zaposleni i usluge</h1><p className="text-muted-foreground">Odredite koje usluge svaki član tima obavlja.</p></div><Button onClick={() => begin()}><Plus className="mr-2 h-4 w-4" />Dodaj zaposlenog</Button></div>
      {loading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : <div className="grid gap-4 lg:grid-cols-2">{employees.map((employee) => <Card key={employee.id}><CardHeader className="flex-row items-center gap-4 space-y-0"><img className="h-14 w-14 rounded-full object-cover" src={employee.avatarUrl || "https://i.pravatar.cc/150"} alt="" /><div className="min-w-0 flex-1"><CardTitle>{employee.name}</CardTitle><p className="text-sm text-muted-foreground">{employee.role}</p></div><Button size="sm" variant="outline" onClick={() => begin(employee)}>Izmeni</Button></CardHeader><CardContent className="space-y-3">{employee.bio && <p className="text-sm text-muted-foreground">{employee.bio}</p>}<div><p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Usluge koje obavlja</p><div className="flex flex-wrap gap-1.5">{employee.serviceNames.length ? employee.serviceNames.map((name) => <Badge key={name} variant="secondary">{name}</Badge>) : <span className="text-sm text-amber-700">Nijedna usluga nije dodeljena</span>}</div></div></CardContent></Card>)}</div>}
    </main>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto"><DialogHeader><DialogTitle>{editing ? "Izmeni zaposlenog" : "Novi zaposleni"}</DialogTitle></DialogHeader><div className="space-y-4 py-2"><div className="grid gap-3 sm:grid-cols-2"><div><Label>Ime i prezime</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div><div><Label>Uloga</Label><Input placeholder="npr. Frizer" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></div></div><div><Label>Kratka biografija</Label><Input value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></div><div><Label>URL fotografije</Label><Input value={form.avatarUrl} onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })} /></div><div><Label>Specijalnosti (odvojite zarezom)</Label><Input value={form.specialties} onChange={(e) => setForm({ ...form, specialties: e.target.value })} /></div><div><Label className="mb-2 block">Usluge koje obavlja</Label><div className="space-y-2 rounded-lg border p-3">{services.filter((service) => service.active).map((service) => <label key={service.id} className="flex cursor-pointer items-center gap-3 text-sm"><Checkbox checked={form.serviceIds.includes(service.id)} onCheckedChange={() => toggleService(service.id)} />{service.name}</label>)}</div></div><Button className="w-full" onClick={save}><Users className="mr-2 h-4 w-4" />Sačuvaj zaposlenog</Button></div></DialogContent></Dialog>
  </div></BusinessLayout>;
}