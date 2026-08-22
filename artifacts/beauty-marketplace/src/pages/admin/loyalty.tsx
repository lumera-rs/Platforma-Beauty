import { useState, useRef } from "react";
import { AdminLayout } from "./layout";
import { 
  useAdminListLoyaltyTiers, 
  useAdminCreateLoyaltyTier, 
  useAdminUpdateLoyaltyTier, 
  useAdminDeleteLoyaltyTier,
  getAdminListLoyaltyTiersQueryKey,
  useGetCurrentUser
} from "@workspace/api-client-react";
import type { LoyaltyTier, LoyaltyTierInput } from "@workspace/api-client-react";
import { LoyaltyTierInputPeriod } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Edit2, Trash2, Crown, ChevronRight, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

export default function AdminLoyalty() {
  const { data: tiers, isLoading, error } = useAdminListLoyaltyTiers();
  const createTier = useAdminCreateLoyaltyTier();
  const updateTier = useAdminUpdateLoyaltyTier();
  const deleteTier = useAdminDeleteLoyaltyTier();
  const { data: currentUserResponse } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canManageLoyalty = currentUserResponse?.user?.role === "SUPER_ADMIN";
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<LoyaltyTier | null>(null);
  const [formData, setFormData] = useState<LoyaltyTierInput>({
    name: "",
    sortOrder: 1,
    spendThreshold: 0,
    period: LoyaltyTierInputPeriod.monthly,
    subscriptionDiscountPercent: 0,
    productDiscountPercent: 0,
    freeSubscription: false,
    premiumListing: false,
    freeShipping: false,
    benefits: [],
    active: true
  });
  const [benefitInput, setBenefitInput] = useState("");

  const handleOpenNew = () => {
    if (!canManageLoyalty) return;
    setEditingTier(null);
    setFormData({
      name: "", sortOrder: tiers ? tiers.length + 1 : 1, spendThreshold: 0, period: LoyaltyTierInputPeriod.monthly,
      subscriptionDiscountPercent: 0, productDiscountPercent: 0, freeSubscription: false,
      premiumListing: false, freeShipping: false, benefits: [], active: true
    });
    setBenefitInput("");
    setIsModalOpen(true);
  };

  const handleOpenEdit = (tier: LoyaltyTier) => {
    if (!canManageLoyalty) return;
    setEditingTier(tier);
    setFormData({
      name: tier.name, sortOrder: tier.sortOrder, spendThreshold: tier.spendThreshold, period: tier.period as LoyaltyTierInputPeriod,
      subscriptionDiscountPercent: tier.subscriptionDiscountPercent, productDiscountPercent: tier.productDiscountPercent,
      freeSubscription: tier.freeSubscription, premiumListing: tier.premiumListing, freeShipping: tier.freeShipping,
      benefits: tier.benefits || [], active: tier.active
    });
    setBenefitInput("");
    setIsModalOpen(true);
  };

  const handleAddBenefit = () => {
    if (!benefitInput.trim()) return;
    setFormData(prev => ({ ...prev, benefits: [...(prev.benefits || []), benefitInput.trim()] }));
    setBenefitInput("");
  };

  const handleRemoveBenefit = (idx: number) => {
    setFormData(prev => ({ ...prev, benefits: (prev.benefits || []).filter((_, i) => i !== idx) }));
  };

  const handleSave = () => {
    if (!canManageLoyalty) return;
    const name = formData.name.trim();
    if (!name) { toast.error("Greška", { description: "Naziv je obavezan." }); return; }
    const sortOrder = Number(formData.sortOrder);
    if (!Number.isFinite(sortOrder) || sortOrder < 1) { toast.error("Greška", { description: "Redosled mora biti pozitivan broj." }); return; }
    const spendThreshold = Number(formData.spendThreshold);
    if (!Number.isFinite(spendThreshold) || spendThreshold < 0) { toast.error("Greška", { description: "Prag potrošnje ne može biti negativan." }); return; }
    const subDisc = Number(formData.subscriptionDiscountPercent);
    if (!Number.isFinite(subDisc) || subDisc < 0 || subDisc > 100) { toast.error("Greška", { description: "Popust na pretplatu mora biti između 0 i 100." }); return; }
    const prodDisc = Number(formData.productDiscountPercent);
    if (!Number.isFinite(prodDisc) || prodDisc < 0 || prodDisc > 100) { toast.error("Greška", { description: "Popust na opremu mora biti između 0 i 100." }); return; }

    const payload: LoyaltyTierInput = {
      ...formData,
      name,
      sortOrder: Math.round(sortOrder),
      spendThreshold: Math.round(spendThreshold),
      subscriptionDiscountPercent: Math.round(subDisc),
      productDiscountPercent: Math.round(prodDisc),
      benefits: (formData.benefits || []).filter(b => b.trim()),
    };
    
    if (editingTier) {
      updateTier.mutate({ tierId: editingTier.id, data: payload }, {
        onSuccess: () => {
          toast.success("Sačuvano", { description: "Loyalty nivo je uspešno ažuriran." });
          queryClient.invalidateQueries({ queryKey: getAdminListLoyaltyTiersQueryKey() });
          setIsModalOpen(false);
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          toast.error("Greška", { description: msg ?? "Loyalty nivo nije sačuvan." });
        },
      });
    } else {
      createTier.mutate({ data: payload }, {
        onSuccess: () => {
          toast.success("Kreirano", { description: "Novi loyalty nivo je uspešno kreiran." });
          queryClient.invalidateQueries({ queryKey: getAdminListLoyaltyTiersQueryKey() });
          setIsModalOpen(false);
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          toast.error("Greška", { description: msg ?? "Loyalty nivo nije kreiran." });
        },
      });
    }
  };

  const handleDelete = (id: string) => {
    if (!canManageLoyalty) return;
    if (!window.confirm("Da li ste sigurni da želite obrisati ovaj nivo? Ovo može uticati na salone koji su trenutno u ovom nivou.")) return;
    
    deleteTier.mutate({ tierId: id }, {
      onSuccess: () => {
        toast.success("Obrisano", { description: "Loyalty nivo je uklonjen." });
        queryClient.invalidateQueries({ queryKey: getAdminListLoyaltyTiersQueryKey() });
      },
      onError: () => toast.error("Greška", { description: "Loyalty nivo nije uklonjen." }),
    });
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">Loyalty Program (B2B)</h1>
            <p className="text-muted-foreground text-sm">
              {canManageLoyalty
                ? "Konfiguracija loyalty nivoa i benefita za salone."
                : "Pregled loyalty nivoa. Izmene su dostupne samo super administratorima."}
            </p>
          </div>
          <Button onClick={handleOpenNew} disabled={!canManageLoyalty} className="shrink-0 gap-2" data-testid="btn-new-tier">
            <Plus className="w-4 h-4" /> Novi Nivo
          </Button>
        </div>

        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">Došlo je do greške pri učitavanju nivoa.</div>
          ) : !tiers || tiers.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-muted-foreground">
              <Crown className="w-12 h-12 mb-4 opacity-20" />
              <p>Nema kreiranih loyalty nivoa.</p>
              <Button variant="outline" className="mt-4" onClick={handleOpenNew} disabled={!canManageLoyalty}>Kreiraj prvi nivo</Button>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {tiers.sort((a, b) => a.sortOrder - b.sortOrder).map(tier => (
                <div key={tier.id} className={`p-6 flex flex-col lg:flex-row gap-6 hover:bg-muted/10 transition-colors ${!tier.active ? 'opacity-60' : ''}`} data-testid={`tier-card-${tier.id}`}>
                  <div className="flex-1 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center font-bold shadow-inner">
                        L{tier.sortOrder}
                      </div>
                      <div>
                        <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
                          {tier.name}
                          {!tier.active && <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-normal">Neaktivno</span>}
                        </h3>
                        <p className="text-sm text-muted-foreground">Prag: {tier.spendThreshold.toLocaleString()} RSD / {tier.period}</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div className="bg-background border rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-1">Pretplata popust</p>
                        <p className="font-semibold">{tier.subscriptionDiscountPercent}%</p>
                      </div>
                      <div className="bg-background border rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-1">B2B Oprema popust</p>
                        <p className="font-semibold">{tier.productDiscountPercent}%</p>
                      </div>
                      <div className="bg-background border rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-1">Besplatna pretplata</p>
                        <p className="font-semibold">{tier.freeSubscription ? 'Da' : 'Ne'}</p>
                      </div>
                      <div className="bg-background border rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-1">Premium listanje</p>
                        <p className="font-semibold">{tier.premiumListing ? 'Da' : 'Ne'}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-row lg:flex-col gap-2 justify-end shrink-0 border-t lg:border-t-0 lg:border-l pt-4 lg:pt-0 lg:pl-6 border-border/50">
                    <Button variant="outline" size="sm" className="flex-1 lg:flex-none justify-start" onClick={() => handleOpenEdit(tier)} disabled={!canManageLoyalty} data-testid={`btn-edit-${tier.id}`}>
                      <Edit2 className="w-4 h-4 mr-2 text-muted-foreground" /> Izmeni
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 lg:flex-none justify-start text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(tier.id)} disabled={!canManageLoyalty} data-testid={`btn-delete-${tier.id}`}>
                      <Trash2 className="w-4 h-4 mr-2" /> Obriši
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={canManageLoyalty && isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTier ? "Izmeni Loyalty Nivo" : "Novi Loyalty Nivo"}</DialogTitle>
            <DialogDescription>
              Definišite pravila i benefite za ovaj nivo. B2B saloni koji pređu prag automatski dobijaju ove benefite.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Naziv nivoa</Label>
                <Input id="name" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="npr. Gold Partner" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sortOrder">Redosled (1 je najniži)</Label>
                <Input id="sortOrder" type="number" min="1" value={formData.sortOrder} onChange={e => setFormData({...formData, sortOrder: Number(e.target.value)})} />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="spendThreshold">Prag potrošnje (RSD)</Label>
                <Input id="spendThreshold" type="number" min="0" value={formData.spendThreshold} onChange={e => setFormData({...formData, spendThreshold: Number(e.target.value)})} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="period">Period obračuna</Label>
                <select id="period" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" value={formData.period} onChange={e => setFormData({...formData, period: e.target.value as LoyaltyTierInputPeriod})}>
                  <option value="monthly">Mesečno</option>
                  <option value="quarterly">Kvartalno</option>
                  <option value="yearly">Godišnje</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="subDisc">Popust na pretplatu (%)</Label>
                <Input id="subDisc" type="number" min="0" max="100" value={formData.subscriptionDiscountPercent} onChange={e => setFormData({...formData, subscriptionDiscountPercent: Number(e.target.value)})} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prodDisc">Popust na opremu (%)</Label>
                <Input id="prodDisc" type="number" min="0" max="100" value={formData.productDiscountPercent} onChange={e => setFormData({...formData, productDiscountPercent: Number(e.target.value)})} />
              </div>
            </div>

            <div className="space-y-4 border rounded-xl p-4 bg-muted/20">
              <h4 className="text-sm font-medium">Dodatni Benefiti</h4>
              <div className="flex items-center justify-between">
                <Label htmlFor="freeSub" className="cursor-pointer">Besplatna pretplata</Label>
                <Switch id="freeSub" checked={formData.freeSubscription} onCheckedChange={c => setFormData({...formData, freeSubscription: c})} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="premList" className="cursor-pointer">Premium pozicija u pretrazi</Label>
                <Switch id="premList" checked={formData.premiumListing} onCheckedChange={c => setFormData({...formData, premiumListing: c})} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="freeShip" className="cursor-pointer">Besplatna dostava B2B</Label>
                <Switch id="freeShip" checked={formData.freeShipping} onCheckedChange={c => setFormData({...formData, freeShipping: c})} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Prilagođeni benefiti (prikazuju se u listi)</Label>
              <div className="flex gap-2">
                <Input value={benefitInput} onChange={e => setBenefitInput(e.target.value)} placeholder="Upiši benefit..." onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddBenefit())} />
                <Button type="button" variant="secondary" onClick={handleAddBenefit}>Dodaj</Button>
              </div>
              {formData.benefits && formData.benefits.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {formData.benefits.map((b, i) => (
                    <li key={i} className="flex justify-between items-center text-sm bg-card border rounded-md px-3 py-2">
                      <span className="flex items-center gap-2"><ChevronRight className="w-3 h-3 text-primary" /> {b}</span>
                      <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => handleRemoveBenefit(i)}><XCircle className="w-4 h-4" /></Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <Label htmlFor="activeTier" className="cursor-pointer font-bold">Nivo je aktivan</Label>
              <Switch id="activeTier" checked={formData.active} onCheckedChange={c => setFormData({...formData, active: c})} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>Odustani</Button>
            <Button onClick={handleSave} disabled={!canManageLoyalty || createTier.isPending || updateTier.isPending}>
              {(createTier.isPending || updateTier.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj Nivo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
