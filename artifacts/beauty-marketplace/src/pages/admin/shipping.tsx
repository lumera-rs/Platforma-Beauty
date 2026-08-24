import { useEffect, useState } from "react";
import { AdminLayout } from "./layout";
import { extractApiError, parseStrictDecimal, parseStrictInt } from "@/lib/admin-form-utils";
import {
  getAdminListCourierServicesQueryKey,
  useAdminGetShippingConfig,
  useAdminListCourierServices,
  useAdminCreateCourierService,
  useAdminUpdateCourierService,
  useAdminDeleteCourierService,
  useAdminUpdateShippingConfig,
  getAdminGetShippingConfigQueryKey,
} from "@workspace/api-client-react";
import type { CourierService, ShippingTier } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Truck, Info, PackageCheck, MapPin, Pencil, Save, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

function formatWeight(grams: number) {
  return grams >= 1000 ? `${(grams / 1000).toLocaleString("sr-RS")} kg` : `${grams} g`;
}

function CourierServices() {
  const { data: services = [], isLoading } = useAdminListCourierServices();
  const create = useAdminCreateCourierService();
  const update = useAdminUpdateCourierService();
  const remove = useAdminDeleteCourierService();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const [editing, setEditing] = useState<CourierService | null>(null);
  const [editName, setEditName] = useState("");
  const [editTemplate, setEditTemplate] = useState("");
  const [editActive, setEditActive] = useState(true);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getAdminListCourierServicesQueryKey() });
  const errorMessage = (error: unknown) => (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Promena nije sačuvana.";
  const beginEdit = (service: CourierService) => {
    setEditing(service);
    setEditName(service.name);
    setEditTemplate(service.trackingUrlTemplate ?? "");
    setEditActive(service.active);
  };
  const createService = () => {
    if (!name.trim()) { toast.error("Greška", { description: "Unesite naziv kurirske službe." }); return; }
    if (!actionGuard.begin("create")) return;
    create.mutate({ data: { name: name.trim(), trackingUrlTemplate: template.trim() || null, active: true } }, {
      onSuccess: () => { setName(""); setTemplate(""); invalidate(); toast.success("Kurirska služba je dodata."); actionGuard.end("create"); },
      onError: (error) => { toast.error("Greška", { description: errorMessage(error) }); actionGuard.end("create"); },
    });
  };
  const saveEdit = () => {
    if (!editing || !editName.trim()) return;
    const actionKey = `save:${editing.id}`;
    if (!actionGuard.begin(actionKey)) return;
    update.mutate({ courierServiceId: editing.id, data: { name: editName.trim(), trackingUrlTemplate: editTemplate.trim() || null, active: editActive } }, {
      onSuccess: () => { setEditing(null); invalidate(); toast.success("Kurirska služba je ažurirana."); actionGuard.end(actionKey); },
      onError: (error) => { toast.error("Greška", { description: errorMessage(error) }); actionGuard.end(actionKey); },
    });
  };
  const deleteService = (service: CourierService) => {
    const actionKey = `delete:${service.id}`;
    if (!actionGuard.begin(actionKey)) return;
    if (!window.confirm(`Obrisati kurirsku službu „${service.name}“? Stare porudžbine će zadržati naziv, ali više neće imati eksterni tracking link.`)) {
      actionGuard.end(actionKey);
      return;
    }
    remove.mutate({ courierServiceId: service.id }, {
      onSuccess: () => { if (editing?.id === service.id) setEditing(null); invalidate(); toast.success("Kurirska služba je obrisana."); actionGuard.end(actionKey); },
      onError: (error) => { toast.error("Greška", { description: errorMessage(error) }); actionGuard.end(actionKey); },
    });
  };

  return <div className="bg-card rounded-xl border shadow-sm p-6 space-y-4">
    <div className="flex items-center gap-2"><Truck className="w-5 h-5 text-primary" /><h2 className="font-semibold">Kurirske službe i praćenje</h2></div>
    <p className="text-sm text-muted-foreground">Administrator bira kurira na porudžbini. URL šablon mora sadržati <code>{"{trackingNumber}"}</code>; ostavite ga praznim za ličnu dostavu bez eksternog praćenja.</p>
    {isLoading ? <div className="py-4 text-center"><Loader2 className="inline h-5 w-5 animate-spin" /></div> : <div className="divide-y rounded-lg border">
      {services.map((service) => editing?.id === service.id ? <div key={service.id} className="space-y-3 bg-muted/30 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1"><Label>Naziv</Label><Input value={editName} onChange={(event) => setEditName(event.target.value)} /></div>
          <div className="space-y-1"><Label>URL šablon za praćenje</Label><Input value={editTemplate} onChange={(event) => setEditTemplate(event.target.value)} placeholder="https://.../{trackingNumber}" /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editActive} onChange={(event) => setEditActive(event.target.checked)} /> Dostupna za nove porudžbine</label>
        <div className="flex gap-2"><Button size="sm" onClick={saveEdit} disabled={update.isPending || actionGuard.isActive(`save:${service.id}`)}><Save className="mr-2 h-4 w-4" />Sačuvaj</Button><Button size="sm" variant="outline" onClick={() => setEditing(null)}><X className="mr-2 h-4 w-4" />Otkaži</Button></div>
      </div> : <div key={service.id} className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-52 flex-1"><p className="font-medium">{service.name}</p><p className="break-all text-xs text-muted-foreground">{service.trackingUrlTemplate ?? "Nema eksternog praćenja (lična dostava)"}</p></div>
        {!service.active && <Badge variant="secondary">Neaktivna</Badge>}
        <Button size="sm" variant="outline" onClick={() => beginEdit(service)}><Pencil className="mr-2 h-4 w-4" />Izmeni</Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteService(service)} disabled={remove.isPending || actionGuard.isActive(`delete:${service.id}`)}><Trash2 className="mr-2 h-4 w-4" />Obriši</Button>
      </div>)}
    </div>}
    <div className="grid gap-3 rounded-lg border border-dashed p-4 md:grid-cols-[1fr_2fr_auto] md:items-end">
      <div className="space-y-1"><Label>Naziv nove službe</Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="npr. X kurir" data-testid="input-courier-name" /></div>
      <div className="space-y-1"><Label>URL šablon za praćenje</Label><Input value={template} onChange={(event) => setTemplate(event.target.value)} placeholder="https://.../{trackingNumber}" data-testid="input-courier-template" /></div>
      <Button onClick={createService} disabled={create.isPending || actionGuard.isActive("create")} data-testid="btn-add-courier"><Plus className="mr-2 h-4 w-4" />Dodaj kurira</Button>
    </div>
  </div>;
}

export default function AdminShipping() {
  const { data: config, isLoading, error } = useAdminGetShippingConfig();
  const updateConfig = useAdminUpdateShippingConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();

  const [tiers, setTiers] = useState<ShippingTier[]>([]);
  const [threshold, setThreshold] = useState(0);
  const [thresholdRaw, setThresholdRaw] = useState("0");
  const [personalEnabled, setPersonalEnabled] = useState(false);
  const [personalName, setPersonalName] = useState("Lična dostava u Beogradu");
  const [personalPrice, setPersonalPrice] = useState(0);
  const [personalPriceRaw, setPersonalPriceRaw] = useState("0");
  const [personalDescription, setPersonalDescription] = useState("Dostava na adresu u Beogradu.");
  const [draftWeight, setDraftWeight] = useState("");
  const [draftPrice, setDraftPrice] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (config && !dirty) {
      setTiers(config.tiers);
      setThreshold(config.freeShippingThreshold);
      setThresholdRaw(String(config.freeShippingThreshold));
      setPersonalEnabled(config.personalDeliveryEnabled);
      setPersonalName(config.personalDeliveryName);
      setPersonalPrice(config.personalDeliveryPrice);
      setPersonalPriceRaw(String(config.personalDeliveryPrice));
      setPersonalDescription(config.personalDeliveryDescription);
    }
  }, [config, dirty]);

  const addTier = () => {
    const weightParsed = parseStrictDecimal(draftWeight, { label: "Maksimalna težina", allowNegative: false, allowZero: false });
    if (!weightParsed.ok) { toast.error("Greška", { description: weightParsed.message }); return; }
    const priceParsed = parseStrictInt(draftPrice, { label: "Cena dostave", allowNegative: false, allowZero: true });
    if (!priceParsed.ok) { toast.error("Greška", { description: priceParsed.message }); return; }
    const maxWeightGrams = Math.round(weightParsed.value * 1000);
    if (tiers.some((t) => t.maxWeightGrams === maxWeightGrams)) {
      toast.error("Greška", { description: "Rang sa ovom težinom već postoji." }); return;
    }
    const next = [...tiers, { maxWeightGrams, price: priceParsed.value, label: `do ${formatWeight(maxWeightGrams)}` }]
      .sort((a, b) => a.maxWeightGrams - b.maxWeightGrams);
    setTiers(next);
    setDraftWeight("");
    setDraftPrice("");
    setDirty(true);
  };

  const removeTier = (idx: number) => {
    setTiers(tiers.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const handleSave = () => {
    if (updateConfig.isPending) return;
    const thresholdParsed = parseStrictInt(thresholdRaw, { label: "Prag besplatne dostave", allowNegative: false, allowZero: true });
    if (!thresholdParsed.ok) { toast.error("Greška", { description: thresholdParsed.message }); return; }
    const personalPriceParsed = parseStrictInt(personalPriceRaw, { label: "Cena lične dostave", allowNegative: false, allowZero: true });
    if (!personalPriceParsed.ok) { toast.error("Greška", { description: personalPriceParsed.message }); return; }
    if (!actionGuard.begin("save-config")) return;
    updateConfig.mutate(
      { data: { freeShippingThreshold: thresholdParsed.value, tiers, personalDeliveryEnabled: personalEnabled, personalDeliveryName: personalName, personalDeliveryPrice: personalPriceParsed.value, personalDeliveryDescription: personalDescription } },
      {
        onSuccess: () => {
          setThreshold(thresholdParsed.value);
          setPersonalPrice(personalPriceParsed.value);
          toast.success("Sačuvano", { description: "Podešavanja dostave su ažurirana." });
          queryClient.invalidateQueries({ queryKey: getAdminGetShippingConfigQueryKey() });
          setDirty(false);
          actionGuard.end("save-config");
        },
        onError: (err: unknown) => {
          toast.error("Greška", { description: extractApiError(err, "Podešavanja nisu sačuvana.") });
          actionGuard.end("save-config");
        },
      }
    );
  };

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-serif font-bold text-foreground">Dostava po težini</h1>
          <p className="text-muted-foreground text-sm">
            Cena dostave u B2B shopu računa se prema ukupnoj težini porudžbine (količina × težina proizvoda).
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : error ? (
          <div className="p-8 text-center text-destructive bg-card border rounded-xl">Došlo je do greške pri učitavanju podešavanja.</div>
        ) : (
          <>
            {/* Weight tiers */}
            <div className="bg-card rounded-xl border shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-primary" />
                <h2 className="font-semibold">Težinski rangovi</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Definišite proizvoljan broj rangova: „do X kg = Y RSD". Za porudžbine teže od najvećeg ranga primenjuje se cena najvećeg ranga.
              </p>

              {tiers.length === 0 ? (
                <div className="border border-dashed rounded-lg p-6 text-center text-muted-foreground text-sm">
                  Nema definisanih rangova — dostava se trenutno ne naplaćuje.
                </div>
              ) : (
                <div className="divide-y divide-border/50 border rounded-lg overflow-hidden">
                  {tiers.map((tier, idx) => (
                    <div key={tier.maxWeightGrams} className="flex items-center justify-between px-4 py-3 bg-background" data-testid={`shipping-tier-${idx}`}>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="font-mono text-xs">{idx + 1}</Badge>
                        <span className="text-sm">
                          {idx === 0 ? "do" : `${formatWeight(tiers[idx - 1]!.maxWeightGrams)} –`} <strong>{formatWeight(tier.maxWeightGrams)}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-primary">{tier.price.toLocaleString("sr-RS")} RSD</span>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => removeTier(idx)} data-testid={`btn-remove-tier-${idx}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2 items-end pt-2">
                <div className="space-y-1 flex-1 w-full">
                  <Label className="text-xs">Do težine (kg)</Label>
                  <Input type="number" min="0" step="0.1" value={draftWeight} onChange={(e) => setDraftWeight(e.target.value)} placeholder="npr. 2" data-testid="input-tier-weight" />
                </div>
                <div className="space-y-1 flex-1 w-full">
                  <Label className="text-xs">Cena dostave (RSD)</Label>
                  <Input type="number" min="0" value={draftPrice} onChange={(e) => setDraftPrice(e.target.value)} placeholder="npr. 390" data-testid="input-tier-price" />
                </div>
                <Button type="button" variant="secondary" onClick={addTier} className="gap-1 w-full sm:w-auto" data-testid="btn-add-tier">
                  <Plus className="w-4 h-4" /> Dodaj rang
                </Button>
              </div>
            </div>

            <div className="bg-card rounded-xl border shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-2"><MapPin className="w-5 h-5 text-primary" /><h2 className="font-semibold">Lična dostava u Beogradu</h2></div>
              <p className="text-sm text-muted-foreground">Alternativna metoda isporuke prikazuje se samo kada kupac unese adresu u Beogradu. Cena se potvrđuje na serveru pri kreiranju porudžbine.</p>
              <label className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer"><input type="checkbox" checked={personalEnabled} onChange={e => { setPersonalEnabled(e.target.checked); setDirty(true); }} /><span className="text-sm font-medium">Uključi ličnu dostavu</span></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1"><Label>Naziv metode</Label><Input value={personalName} onChange={e => { setPersonalName(e.target.value); setDirty(true); }} /></div>
                <div className="space-y-1"><Label>Cena (RSD)</Label><Input type="number" min="0" value={personalPriceRaw} onChange={e => { setPersonalPriceRaw(e.target.value); setDirty(true); }} /></div>
                <div className="space-y-1 sm:col-span-2"><Label>Opis za kupca</Label><Input value={personalDescription} onChange={e => { setPersonalDescription(e.target.value); setDirty(true); }} /></div>
              </div>
            </div>

            <CourierServices />

            {/* Free shipping threshold */}
            <div className="bg-card rounded-xl border shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-2">
                <PackageCheck className="w-5 h-5 text-primary" />
                <h2 className="font-semibold">Besplatna dostava</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Kada vrednost porudžbine dostigne ovaj iznos, dostava je besplatna. Vrednost 0 znači da besplatna dostava nije aktivna.
              </p>
              <div className="flex items-center gap-3 max-w-xs">
                <Input
                  type="number" min="0"
                  value={thresholdRaw}
                  onChange={(e) => { setThresholdRaw(e.target.value); setDirty(true); }}
                  data-testid="input-free-shipping-threshold"
                />
                <span className="text-sm text-muted-foreground shrink-0">RSD</span>
              </div>
              {threshold > 0 ? (
                <div className="flex items-start gap-2 text-sm bg-primary/5 border border-primary/20 rounded-lg p-3">
                  <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <span>Porudžbine od <strong>{threshold.toLocaleString("sr-RS")} RSD</strong> i više imaće besplatnu dostavu. Kupci će videti poruku koliko im još nedostaje.</span>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-sm bg-muted/40 border rounded-lg p-3 text-muted-foreground">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Besplatna dostava je isključena (prag je 0). Unesite iznos kada odlučite prag.</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              {dirty && <span className="text-xs text-muted-foreground self-center">Imate nesačuvane izmene</span>}
              <Button onClick={handleSave} disabled={updateConfig.isPending || actionGuard.isActive("save-config") || !dirty} data-testid="btn-save-shipping">
                {updateConfig.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Sačuvaj podešavanja
              </Button>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
