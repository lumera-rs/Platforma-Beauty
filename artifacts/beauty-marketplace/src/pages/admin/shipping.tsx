import { useEffect, useState } from "react";
import { AdminLayout } from "./layout";
import {
  useAdminGetShippingConfig,
  useAdminUpdateShippingConfig,
  getAdminGetShippingConfigQueryKey,
} from "@workspace/api-client-react";
import type { ShippingTier } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Truck, Info, PackageCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function formatWeight(grams: number) {
  return grams >= 1000 ? `${(grams / 1000).toLocaleString("sr-RS")} kg` : `${grams} g`;
}

export default function AdminShipping() {
  const { data: config, isLoading, error } = useAdminGetShippingConfig();
  const updateConfig = useAdminUpdateShippingConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [tiers, setTiers] = useState<ShippingTier[]>([]);
  const [threshold, setThreshold] = useState(0);
  const [draftWeight, setDraftWeight] = useState("");
  const [draftPrice, setDraftPrice] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (config && !dirty) {
      setTiers(config.tiers);
      setThreshold(config.freeShippingThreshold);
    }
  }, [config, dirty]);

  const addTier = () => {
    const maxKg = Number(draftWeight);
    const price = Number(draftPrice);
    if (!maxKg || maxKg <= 0) { toast.error("Greška", { description: "Unesite maksimalnu težinu ranga u kilogramima." }); return; }
    if (price < 0 || draftPrice === "") { toast.error("Greška", { description: "Unesite cenu dostave za ovaj rang." }); return; }
    const maxWeightGrams = Math.round(maxKg * 1000);
    if (tiers.some((t) => t.maxWeightGrams === maxWeightGrams)) {
      toast.error("Greška", { description: "Rang sa ovom težinom već postoji." }); return;
    }
    const next = [...tiers, { maxWeightGrams, price, label: `do ${formatWeight(maxWeightGrams)}` }]
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
    updateConfig.mutate(
      { data: { freeShippingThreshold: threshold, tiers } },
      {
        onSuccess: () => {
          toast.success("Sačuvano", { description: "Podešavanja dostave su ažurirana." });
          queryClient.invalidateQueries({ queryKey: getAdminGetShippingConfigQueryKey() });
          setDirty(false);
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          toast.error("Greška", { description: msg ?? "Podešavanja nisu sačuvana." });
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
                  value={threshold}
                  onChange={(e) => { setThreshold(Number(e.target.value)); setDirty(true); }}
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
              <Button onClick={handleSave} disabled={updateConfig.isPending || !dirty} data-testid="btn-save-shipping">
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
