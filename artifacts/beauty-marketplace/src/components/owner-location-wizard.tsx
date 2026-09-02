import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateSalonLocation } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type Location = { id: string; name: string };
const blank = { name: "", city: "", municipality: "", address: "", postalCode: "", phone: "", email: "", shortDescription: "", description: "", imageUrl: "" };

/** Shared entry point for adding a location from navigation and its profile. */
export function OwnerLocationWizard({ triggerClassName, triggerLabel = "Dodaj lokaciju" }: { triggerClassName?: string; triggerLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [sourceSalonId, setSourceSalonId] = useState("");
  const [copyServices, setCopyServices] = useState(false);
  const [copyPackages, setCopyPackages] = useState(false);
  const [form, setForm] = useState(blank);
  const [created, setCreated] = useState<Location | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateSalonLocation();
  useEffect(() => {
    if (!open) return;
    void fetch("/api/salon/managed-salons", { credentials: "include" }).then(async (response) => {
      if (!response.ok) throw new Error("Lokacije nisu učitane.");
      return response.json() as Promise<{ salons: Location[] }>;
    }).then((payload) => {
      setLocations(payload.salons);
      if (payload.salons.length === 1) setSourceSalonId(payload.salons[0].id);
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Lokacije nisu učitane."));
  }, [open, toast]);
  const update = (key: keyof typeof blank, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = () => {
    if (Object.entries(form).some(([key, value]) => key !== "postalCode" && !value.trim())) {
      toast.error("Popunite sva obavezna polja lokacije.");
      return;
    }
    create.mutate({ data: {
      ...form,
      postalCode: form.postalCode.trim() || null,
      sourceSalonId: sourceSalonId || null,
      copyServices,
      copyPackages,
      activateAfterCreate: false,
      idempotencyKey: crypto.randomUUID(),
    } }, {
      onSuccess: (result) => {
        setCreated({ id: result.location.id, name: result.location.name });
        queryClient.clear();
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : "Lokacija nije kreirana."),
    });
  };
  const switchToCreated = async () => {
    if (!created) return;
    const response = await fetch("/api/salon/active-salon", { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ salonId: created.id }) });
    if (!response.ok) { toast.error("Lokacija je kreirana, ali promena aktivne lokacije nije uspela."); return; }
    window.location.assign(window.location.pathname + window.location.search + window.location.hash);
  };
  const close = () => { setOpen(false); setCreated(null); setForm(blank); setCopyServices(false); setCopyPackages(false); };
  return <>
    <Button type="button" variant="outline" className={triggerClassName} onClick={() => setOpen(true)}>{triggerLabel}</Button>
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{created ? "Lokacija je kreirana" : "Nova lokacija"}</DialogTitle><DialogDescription>{created ? "Izaberite kontekst u kome želite da nastavite rad." : "Podaci, cene i usluge svake lokacije ostaju nezavisni."}</DialogDescription></DialogHeader>
        {created ? <div className="space-y-4"><p className="rounded-lg bg-muted p-4 text-sm"><b>{created.name}</b> je spremna. Loyalty program se ne kopira: zajednički je za ceo vlasnički nalog i sve lokacije.</p><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={close}>Ostani na aktivnoj lokaciji</Button><Button onClick={() => void switchToCreated()}>Otvori novu lokaciju</Button></div></div> : <div className="space-y-4 py-2">
          <div className="grid gap-3 sm:grid-cols-2">{(["name", "city", "municipality", "address", "postalCode", "phone", "email"] as const).map((key) => <div key={key}><Label>{({ name: "Naziv", city: "Grad", municipality: "Opština", address: "Adresa", postalCode: "Poštanski broj", phone: "Telefon", email: "Email" } as Record<string, string>)[key]}{key !== "postalCode" ? " *" : ""}</Label><Input type={key === "email" ? "email" : "text"} value={form[key]} onChange={(event) => update(key, event.target.value)} /></div>)}</div>
          <div><Label>Kratak opis *</Label><Input value={form.shortDescription} onChange={(event) => update("shortDescription", event.target.value)} /></div><div><Label>Opis *</Label><Input value={form.description} onChange={(event) => update("description", event.target.value)} /></div><div><Label>URL naslovne fotografije *</Label><Input value={form.imageUrl} onChange={(event) => update("imageUrl", event.target.value)} /></div>
          {locations.length > 0 && <div className="rounded-lg border p-3 space-y-3"><Label>Izvor za kopiranje (opciono)</Label>{locations.length === 1 ? <p className="text-sm">{locations[0].name} će biti ponuđena kao izvor.</p> : <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={sourceSalonId} onChange={(event) => setSourceSalonId(event.target.value)}><option value="">Ne kopiraj sadržaj</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select>}<label className="flex items-center gap-2 text-sm"><Checkbox disabled={!sourceSalonId} checked={copyServices} onCheckedChange={(value) => { setCopyServices(value === true); if (value !== true) setCopyPackages(false); }} />Kopiraj usluge</label><label className="flex items-center gap-2 text-sm"><Checkbox disabled={!sourceSalonId || !copyServices} checked={copyPackages} onCheckedChange={(value) => setCopyPackages(value === true)} />Kopiraj pakete (zahteva kopiranje usluga)</label></div>}
          <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">Pregled: {copyServices ? "usluge" : "bez usluga"}{copyPackages ? " i paketi" : ""} biće kopirani, ali se nakon toga uređuju nezavisno, uključujući cene. Loyalty se nikada ne kopira jer je zajednički za sve lokacije.</p>
          <Button className="w-full" disabled={create.isPending} onClick={submit}>{create.isPending ? "Kreiranje…" : "Kreiraj lokaciju"}</Button>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}