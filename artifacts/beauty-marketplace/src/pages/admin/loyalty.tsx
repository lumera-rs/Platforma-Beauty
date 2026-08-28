import { useState } from "react";
import { AdminLayout } from "./layout";
import {
  useAdminListLoyaltyTiers,
  useAdminCreateLoyaltyTier,
  useAdminUpdateLoyaltyTier,
  useAdminDeleteLoyaltyTier,
  getAdminListLoyaltyTiersQueryKey,
  useAdminListLoyaltyPricingTiers,
  useAdminCreateLoyaltyPricingTier,
  useAdminUpdateLoyaltyPricingTier,
  useAdminDeleteLoyaltyPricingTier,
  getAdminListLoyaltyPricingTiersQueryKey,
  useGetCurrentUser
} from "@workspace/api-client-react";
import type { LoyaltyTier, LoyaltyTierInput, PricingLoyaltyTier, PricingLoyaltyTierInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Edit2, Trash2, Crown, ChevronRight, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { extractApiError, parseStrictInt } from "@/lib/admin-form-utils";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function AdminLoyalty() {
  const { data: tiers, isLoading, error } = useAdminListLoyaltyTiers();
  const createTier = useAdminCreateLoyaltyTier();
  const updateTier = useAdminUpdateLoyaltyTier();
  const deleteTier = useAdminDeleteLoyaltyTier();
  const { data: currentUserResponse } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  const canManageLoyalty = currentUserResponse?.user?.role === "SUPER_ADMIN" || currentUserResponse?.user?.role === "ADMIN";

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<LoyaltyTier | null>(null);
  const [formData, setFormData] = useState<LoyaltyTierInput>({
    name: "",
    sortOrder: 1,
    spendThreshold: 0,
    period: "monthly",
    subscriptionDiscountPercent: 0,
    productDiscountPercent: 0,
    freeSubscription: false,
    premiumListing: false,
    freeShipping: false,
    benefits: [],
    active: true
  });
  const [rawNums, setRawNums] = useState({ sortOrder: "1", spendThreshold: "0", subscriptionDiscountPercent: "0", productDiscountPercent: "0" });
  const [benefitInput, setBenefitInput] = useState("");

  // --- Pricing Tiers State ---
  const { data: pricingTiers, isLoading: isLoadingPricing } = useAdminListLoyaltyPricingTiers();
  const createPricingTier = useAdminCreateLoyaltyPricingTier();
  const updatePricingTier = useAdminUpdateLoyaltyPricingTier();
  const deletePricingTier = useAdminDeleteLoyaltyPricingTier();

  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [editingPricingTier, setEditingPricingTier] = useState<PricingLoyaltyTier | null>(null);
  const [pricingFormData, setPricingFormData] = useState<{
    name: string;
    market: "B2B" | "B2C" | "BOTH";
    spendThresholdRsd: string;
    discountPercent: string;
    active: boolean;
  }>({ name: "", market: "BOTH", spendThresholdRsd: "0", discountPercent: "", active: true });

  const handleOpenNewPricing = () => {
    if (!canManageLoyalty) return;
    setEditingPricingTier(null);
    setPricingFormData({ name: "", market: "BOTH", spendThresholdRsd: "0", discountPercent: "", active: true });
    setIsPricingModalOpen(true);
  };

  const handleOpenEditPricing = (tier: PricingLoyaltyTier) => {
    if (!canManageLoyalty) return;
    setEditingPricingTier(tier);
    setPricingFormData({
      name: tier.name, market: tier.market as any, spendThresholdRsd: String(tier.spendThresholdRsd),
      discountPercent: String(tier.discountPercent), active: tier.active
    });
    setIsPricingModalOpen(true);
  };

  const handleSavePricing = () => {
    if (!canManageLoyalty) return;
    if (!pricingFormData.name.trim()) { toast.error("Ime je obavezno."); return; }

    const thresh = parseStrictInt(pricingFormData.spendThresholdRsd, { label: "Prag potrošnje", allowNegative: false, allowZero: true });
    const disc = parseStrictInt(pricingFormData.discountPercent, { label: "Procenat popusta", min: 1, max: 100 });
    if (!thresh.ok) { toast.error(thresh.message); return; }
    if (!disc.ok) { toast.error(disc.message); return; }

    const payload: PricingLoyaltyTierInput = {
      name: pricingFormData.name.trim(), market: pricingFormData.market,
      spendThresholdRsd: thresh.value, discountPercent: disc.value, active: pricingFormData.active
    };

    if (!actionGuard.begin("save-pricing")) return;
    const opts = {
      onSuccess: () => {
        toast.success("Sačuvano.");
        queryClient.invalidateQueries({ queryKey: getAdminListLoyaltyPricingTiersQueryKey() });
        setIsPricingModalOpen(false);
        actionGuard.end("save-pricing");
      },
      onError: (err: any) => {
        toast.error(extractApiError(err, "Greška pri čuvanju."));
        actionGuard.end("save-pricing");
      }
    };
    if (editingPricingTier) {
      updatePricingTier.mutate({ id: editingPricingTier.id, data: { ...payload, version: editingPricingTier.version } }, opts);
    } else {
      createPricingTier.mutate({ data: payload }, opts);
    }
  };

  const handleDeletePricing = (tier: PricingLoyaltyTier) => {
    if (!canManageLoyalty || !window.confirm("Brisati?")) return;
    deletePricingTier.mutate({ id: tier.id, params: { version: tier.version } }, {
      onSuccess: () => { toast.success("Obrisano."); queryClient.invalidateQueries({ queryKey: getAdminListLoyaltyPricingTiersQueryKey() }); },
      onError: (err: any) => toast.error(extractApiError(err, "Greška pri brisanju."))
    });
  };
  // ---------------------------

  const handleOpenNew = () => {
    if (!canManageLoyalty) return;
    setEditingTier(null);
    const sortOrder = tiers ? tiers.length + 1 : 1;
    setFormData({
      name: "", sortOrder, spendThreshold: 0, period: "monthly",
      subscriptionDiscountPercent: 0, productDiscountPercent: 0, freeSubscription: false,
      premiumListing: false, freeShipping: false, benefits: [], active: true
    });
    setRawNums({ sortOrder: String(sortOrder), spendThreshold: "0", subscriptionDiscountPercent: "0", productDiscountPercent: "0" });
    setBenefitInput("");
    setIsModalOpen(true);
  };

  const handleOpenEdit = (tier: LoyaltyTier) => {
    if (!canManageLoyalty) return;
    setEditingTier(tier);
    setFormData({
      name: tier.name, sortOrder: tier.sortOrder, spendThreshold: tier.spendThreshold, period: tier.period,
      subscriptionDiscountPercent: tier.subscriptionDiscountPercent, productDiscountPercent: tier.productDiscountPercent,
      freeSubscription: tier.freeSubscription, premiumListing: tier.premiumListing, freeShipping: tier.freeShipping,
      benefits: tier.benefits || [], active: tier.active
    });
    setRawNums({
      sortOrder: String(tier.sortOrder),
      spendThreshold: String(tier.spendThreshold),
      subscriptionDiscountPercent: String(tier.subscriptionDiscountPercent),
      productDiscountPercent: String(tier.productDiscountPercent),
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
    if (createTier.isPending || updateTier.isPending) return;
    if (!formData.name?.trim()) {
      toast.error("Greška", { description: "Ime je obavezno." });
      return;
    }
    const sortParsed = parseStrictInt(rawNums.sortOrder, { label: "Redosled", allowNegative: false, allowZero: false, min: 1 });
    if (!sortParsed.ok) { toast.error("Greška", { description: sortParsed.message }); return; }
    const thresholdParsed = parseStrictInt(rawNums.spendThreshold, { label: "Prag potrošnje", allowNegative: false, allowZero: true });
    if (!thresholdParsed.ok) { toast.error("Greška", { description: thresholdParsed.message }); return; }
    const subDiscParsed = parseStrictInt(rawNums.subscriptionDiscountPercent, { label: "Popust na pretplatu", allowNegative: false, allowZero: true, max: 100 });
    if (!subDiscParsed.ok) { toast.error("Greška", { description: subDiscParsed.message }); return; }
    const prodDiscParsed = parseStrictInt(rawNums.productDiscountPercent, { label: "Popust na opremu", allowNegative: false, allowZero: true, max: 100 });
    if (!prodDiscParsed.ok) { toast.error("Greška", { description: prodDiscParsed.message }); return; }

    const payload: LoyaltyTierInput = {
      ...formData,
      sortOrder: sortParsed.value,
      spendThreshold: thresholdParsed.value,
      subscriptionDiscountPercent: subDiscParsed.value,
      productDiscountPercent: prodDiscParsed.value,
    };
    if (!actionGuard.begin("save")) return;

    if (editingTier) {
      updateTier.mutate({ tierId: editingTier.id, data: payload }, {
        onSuccess: () => {
          toast.success("Sačuvano", { description: "Loyalty nivo je uspešno ažuriran." });
          queryClient.invalidateQueries({ queryKey: getAdminListLoyaltyTiersQueryKey() });
          setIsModalOpen(false);
          actionGuard.end("save");
        },
        onError: (err: unknown) => {
          toast.error("Greška", { description: extractApiError(err, "Loyalty nivo nije sačuvan.") });
          actionGuard.end("save");
        },
      });
    } else {
      createTier.mutate({ data: payload }, {
        onSuccess: () => {
          toast.success("Kreirano", { description: "Novi loyalty nivo je uspešno kreiran." });
          queryClient.invalidateQueries({ queryKey: getAdminListLoyaltyTiersQueryKey() });
          setIsModalOpen(false);
          actionGuard.end("save");
        },
        onError: (err: unknown) => {
          toast.error("Greška", { description: extractApiError(err, "Loyalty nivo nije kreiran.") });
          actionGuard.end("save");
        },
      });
    }
  };

  const handleDelete = (id: string) => {
    if (!canManageLoyalty) return;
    const actionKey = `delete:${id}`;
    if (!actionGuard.begin(actionKey)) return;
    if (!window.confirm("Da li ste sigurni da želite obrisati ovaj nivo? Ovo može uticati na salone koji su trenutno u ovom nivou.")) {
      actionGuard.end(actionKey);
      return;
    }

    deleteTier.mutate({ tierId: id }, {
      onSuccess: () => {
        toast.success("Obrisano", { description: "Loyalty nivo je uklonjen." });
        queryClient.invalidateQueries({ queryKey: getAdminListLoyaltyTiersQueryKey() });
        actionGuard.end(actionKey);
      },
      onError: () => {
        toast.error("Greška", { description: "Loyalty nivo nije uklonjen." });
        actionGuard.end(actionKey);
      },
    });
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">Loyalty Program</h1>
            <p className="text-muted-foreground text-sm">
              {canManageLoyalty
                ? "Konfiguracija loyalty nivoa i cena."
                : "Pregled loyalty nivoa. Izmene su dostupne samo administratorima."}
            </p>
          </div>
        </div>

        <Tabs defaultValue="b2b" className="w-full">
          <TabsList>
            <TabsTrigger value="b2b">B2B Loyalty Nivoi (Saloni)</TabsTrigger>
            <TabsTrigger value="pricing">Loyalty Cene (B2B i B2C)</TabsTrigger>
          </TabsList>

          <TabsContent value="b2b" className="mt-4 space-y-4">
            <div className="flex justify-end">
              <Button onClick={handleOpenNew} disabled={!canManageLoyalty} className="shrink-0 gap-2" data-testid="btn-new-tier">
                <Plus className="w-4 h-4" /> Novi B2B Nivo
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
                        <Button variant="outline" size="sm" className="flex-1 lg:flex-none justify-start text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(tier.id)} disabled={!canManageLoyalty || actionGuard.isActive(`delete:${tier.id}`)} data-testid={`btn-delete-${tier.id}`}>
                          <Trash2 className="w-4 h-4 mr-2" /> Obriši
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="pricing" className="mt-4 space-y-4">
            <div className="flex justify-end">
              <Button onClick={handleOpenNewPricing} disabled={!canManageLoyalty} className="shrink-0 gap-2">
                <Plus className="w-4 h-4" /> Novi Nivo Cene
              </Button>
            </div>
            <div className="bg-card rounded-xl border shadow-sm divide-y">
              {isLoadingPricing ? (
                <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : !pricingTiers || pricingTiers.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">Nema loyalty nivoa cena.</div>
              ) : (
                pricingTiers.sort((a, b) => a.spendThresholdRsd - b.spendThresholdRsd).map(pt => (
                  <div key={pt.id} className={`p-5 flex items-center justify-between ${!pt.active ? 'opacity-60' : ''}`}>
                    <div>
                      <h3 className="font-bold flex items-center gap-2">{pt.name} {!pt.active && <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-normal">Neaktivno</span>}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Tržište: <strong className="text-foreground">{pt.market === 'BOTH' ? 'B2B & B2C' : pt.market}</strong> |
                        Prag: <strong className="text-foreground">{pt.spendThresholdRsd.toLocaleString()} RSD</strong> |
                        Popust: <strong className="text-primary">{pt.discountPercent}%</strong>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleOpenEditPricing(pt)} disabled={!canManageLoyalty}><Edit2 className="w-4 h-4 mr-2" /> Izmeni</Button>
                      <Button variant="outline" size="sm" className="text-destructive" onClick={() => handleDeletePricing(pt)} disabled={!canManageLoyalty}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Existing B2B Dialog */}
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
                <Input id="sortOrder" type="number" min="1" value={rawNums.sortOrder} onChange={e => setRawNums({ ...rawNums, sortOrder: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="spendThreshold">Prag potrošnje (RSD)</Label>
                <Input id="spendThreshold" type="number" min="0" value={rawNums.spendThreshold} onChange={e => setRawNums({ ...rawNums, spendThreshold: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="period">Period obračuna</Label>
                <select id="period" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" value={formData.period} onChange={e => setFormData({...formData, period: e.target.value})}>
                  <option value="monthly">Mesečno</option>
                  <option value="quarterly">Kvartalno</option>
                  <option value="yearly">Godišnje</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="subDisc">Popust na pretplatu (%)</Label>
                <Input id="subDisc" type="number" min="0" max="100" value={rawNums.subscriptionDiscountPercent} onChange={e => setRawNums({ ...rawNums, subscriptionDiscountPercent: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prodDisc">Popust na opremu (%)</Label>
                <Input id="prodDisc" type="number" min="0" max="100" value={rawNums.productDiscountPercent} onChange={e => setRawNums({ ...rawNums, productDiscountPercent: e.target.value })} />
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
            <Button onClick={handleSave} disabled={!canManageLoyalty || createTier.isPending || updateTier.isPending || actionGuard.isActive("save")}>
              {(createTier.isPending || updateTier.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj Nivo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pricing Tier Dialog */}
      <Dialog open={canManageLoyalty && isPricingModalOpen} onOpenChange={setIsPricingModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingPricingTier ? "Izmeni Nivo Cene" : "Novi Nivo Cene"}</DialogTitle>
            <DialogDescription>Automatski dodeljuje procentualni popust na osnovu prethodne potrošnje.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Naziv nivoa</Label>
              <Input value={pricingFormData.name} onChange={e => setPricingFormData({...pricingFormData, name: e.target.value})} placeholder="Npr. Platinum" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tržište</Label>
                <Select value={pricingFormData.market} onValueChange={(v: any) => setPricingFormData({...pricingFormData, market: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BOTH">Svi</SelectItem>
                    <SelectItem value="B2B">B2B</SelectItem>
                    <SelectItem value="B2C">B2C</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Popust (%)</Label>
                <Input type="number" value={pricingFormData.discountPercent} onChange={e => setPricingFormData({...pricingFormData, discountPercent: e.target.value})} min="1" max="100" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Prag potrošnje (RSD)</Label>
              <Input type="number" value={pricingFormData.spendThresholdRsd} onChange={e => setPricingFormData({...pricingFormData, spendThresholdRsd: e.target.value})} min="0" />
            </div>
            <div className="flex items-center justify-between pt-2">
              <Label className="font-bold">Aktivan</Label>
              <Switch checked={pricingFormData.active} onCheckedChange={c => setPricingFormData({...pricingFormData, active: c})} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPricingModalOpen(false)}>Odustani</Button>
            <Button onClick={handleSavePricing}>Sačuvaj</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
