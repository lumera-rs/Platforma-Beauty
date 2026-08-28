import { useState, useMemo } from "react";
import { AdminLayout } from "./layout";
import {
  useAdminListBulkSaleCampaigns,
  useAdminCreateBulkSaleCampaign,
  useAdminUpdateBulkSaleCampaign,
  useAdminDeleteBulkSaleCampaign,
  getAdminListBulkSaleCampaignsQueryKey,
  useAdminListAutomaticXyPromotions,
  useAdminCreateAutomaticXyPromotion,
  useAdminUpdateAutomaticXyPromotion,
  useAdminDeleteAutomaticXyPromotion,
  getAdminListAutomaticXyPromotionsQueryKey,
  useAdminListProducts,
  useAdminListProductCategories,
  useGetCurrentUser
} from "@workspace/api-client-react";
import type {
  BulkSaleCampaign,
  BulkSaleCampaignInput,
  AutomaticXyPromotion,
  AutomaticXyPromotionInput,
  RuleTarget
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Edit2, Trash2, Tag, Percent, ArrowRight, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { extractApiError, parseStrictInt } from "@/lib/admin-form-utils";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function toLocalDateString(iso: string | null) {
  if (!iso) return "";
  return iso.split("T")[0];
}

function toIsoDateString(local: string | null) {
  if (!local) return null;
  return new Date(local).toISOString();
}

function TargetsEditor({ targets, setTargets, products, categories }: { targets: RuleTarget[], setTargets: (t: RuleTarget[]) => void, products: any[], categories: any[] }) {
  const productOptions = products.map(p => ({ value: `p:${p.id}`, label: `Proizvod: ${p.name} (${p.sku})` }));
  const categoryOptions = categories.map(c => ({ value: `c:${c.id}`, label: `Kategorija: ${c.name}` }));
  const allOptions = [...productOptions, ...categoryOptions];

  const handleSelect = (val: string | undefined) => {
    if (!val) return;
    const isProduct = val.startsWith("p:");
    const id = val.substring(2);
    if (targets.some(t => ('productId' in t && t.productId === id) || ('categoryId' in t && t.categoryId === id))) return;
    setTargets([...targets, isProduct ? { productId: id } : { categoryId: id }]);
  };

  const removeTarget = (idx: number) => {
    setTargets(targets.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <SearchableCombobox
        value=""
        onValueChange={handleSelect}
        options={allOptions}
        placeholder="Dodaj proizvod ili kategoriju..."
        searchPlaceholder="Pretraži..."
      />
      {targets.length > 0 && (
        <ul className="mt-2 space-y-1">
          {targets.map((t, i) => {
            const isProduct = 'productId' in t;
            const id = isProduct ? t.productId : (t as any).categoryId;
            const name = isProduct
              ? products.find(p => p.id === id)?.name || id
              : categories.find(c => c.id === id)?.name || id;
            return (
              <li key={i} className="flex justify-between items-center text-sm bg-muted/30 border rounded-md px-3 py-1.5">
                <span className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{isProduct ? 'Proizvod' : 'Kategorija'}</Badge>
                  {name}
                </span>
                <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => removeTarget(i)}><X className="w-3 h-3" /></Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Badge({ children, variant = "default", className = "" }: { children: React.ReactNode, variant?: "default" | "outline", className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${variant === 'outline' ? 'border text-muted-foreground' : 'bg-primary/10 text-primary'} ${className}`}>
      {children}
    </span>
  );
}

export default function AdminMarketingCampaigns() {
  const { data: bulkCampaigns = [], isLoading: loadingBulk } = useAdminListBulkSaleCampaigns();
  const { data: xyPromotions = [], isLoading: loadingXy } = useAdminListAutomaticXyPromotions();
  const { data: currentUserResponse } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  const canManage = currentUserResponse?.user?.role === "SUPER_ADMIN" || currentUserResponse?.user?.role === "ADMIN";

  const { data: productsData } = useAdminListProducts({ page: 1, pageSize: 100 });
  const { data: categories = [] } = useAdminListProductCategories();
  const products = productsData?.items || [];

  // Bulk Sale State
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [editingBulk, setEditingBulk] = useState<BulkSaleCampaign | null>(null);
  const [bulkForm, setBulkForm] = useState<{
    name: string; market: "B2B" | "B2C" | "BOTH"; discountType: "PERCENT" | "FIXED_RSD"; discountValue: string;
    startsAt: string; endsAt: string; status: "DRAFT" | "ACTIVE"; targets: RuleTarget[];
  }>({ name: "", market: "BOTH", discountType: "PERCENT", discountValue: "", startsAt: "", endsAt: "", status: "DRAFT", targets: [] });

  // X+Y State
  const [xyModalOpen, setXyModalOpen] = useState(false);
  const [editingXy, setEditingXy] = useState<AutomaticXyPromotion | null>(null);
  const [xyForm, setXyForm] = useState<{
    name: string; market: "B2B" | "B2C" | "BOTH"; buyQuantity: string; rewardQuantity: string; rewardPercent: string;
    perOrderRewardUnitCap: string; startsAt: string; endsAt: string; status: "DRAFT" | "ACTIVE";
    buyTargets: RuleTarget[]; rewardTargets: RuleTarget[];
  }>({ name: "", market: "BOTH", buyQuantity: "2", rewardQuantity: "1", rewardPercent: "100", perOrderRewardUnitCap: "", startsAt: "", endsAt: "", status: "DRAFT", buyTargets: [], rewardTargets: [] });

  const createBulk = useAdminCreateBulkSaleCampaign();
  const updateBulk = useAdminUpdateBulkSaleCampaign();
  const deleteBulk = useAdminDeleteBulkSaleCampaign();
  const createXy = useAdminCreateAutomaticXyPromotion();
  const updateXy = useAdminUpdateAutomaticXyPromotion();
  const deleteXy = useAdminDeleteAutomaticXyPromotion();

  // Handlers for Bulk Sale
  const openNewBulk = () => {
    if (!canManage) return;
    setEditingBulk(null);
    setBulkForm({ name: "", market: "BOTH", discountType: "PERCENT", discountValue: "", startsAt: "", endsAt: "", status: "ACTIVE", targets: [] });
    setBulkModalOpen(true);
  };
  const openEditBulk = (c: BulkSaleCampaign) => {
    if (!canManage) return;
    setEditingBulk(c);
    setBulkForm({ name: c.name, market: c.market as any, discountType: c.discountType as any, discountValue: String(c.discountValue), startsAt: toLocalDateString(c.startsAt), endsAt: toLocalDateString(c.endsAt), status: c.status as any, targets: c.targets || [] });
    setBulkModalOpen(true);
  };
  const saveBulk = () => {
    if (!bulkForm.name.trim()) { toast.error("Ime je obavezno."); return; }
    if (bulkForm.targets.length === 0) { toast.error("Izaberite bar jedan cilj."); return; }
    const valParsed = parseStrictInt(bulkForm.discountValue, { label: "Popust", allowNegative: false, allowZero: false, max: bulkForm.discountType === 'PERCENT' ? 100 : undefined });
    if (!valParsed.ok) { toast.error(valParsed.message); return; }

    const payload: BulkSaleCampaignInput = {
      name: bulkForm.name.trim(), market: bulkForm.market, discountType: bulkForm.discountType, discountValue: valParsed.value,
      startsAt: toIsoDateString(bulkForm.startsAt) || new Date().toISOString(), endsAt: toIsoDateString(bulkForm.endsAt),
      status: bulkForm.status, targets: bulkForm.targets
    };

    if (!actionGuard.begin("save-bulk")) return;
    const opts = {
      onSuccess: () => { toast.success("Sačuvano."); queryClient.invalidateQueries({ queryKey: getAdminListBulkSaleCampaignsQueryKey() }); setBulkModalOpen(false); actionGuard.end("save-bulk"); },
      onError: (err: any) => { toast.error(extractApiError(err, "Greška pri čuvanju.")); actionGuard.end("save-bulk"); }
    };
    if (editingBulk) updateBulk.mutate({ id: editingBulk.id, data: { ...payload, version: editingBulk.version } }, opts);
    else createBulk.mutate({ data: payload }, opts);
  };

  // Handlers for X+Y
  const openNewXy = () => {
    if (!canManage) return;
    setEditingXy(null);
    setXyForm({ name: "", market: "BOTH", buyQuantity: "2", rewardQuantity: "1", rewardPercent: "100", perOrderRewardUnitCap: "", startsAt: "", endsAt: "", status: "ACTIVE", buyTargets: [], rewardTargets: [] });
    setXyModalOpen(true);
  };
  const openEditXy = (c: AutomaticXyPromotion) => {
    if (!canManage) return;
    setEditingXy(c);
    setXyForm({ name: c.name, market: c.market as any, buyQuantity: String(c.buyQuantity), rewardQuantity: String(c.rewardQuantity), rewardPercent: String(c.rewardPercent), perOrderRewardUnitCap: c.perOrderRewardUnitCap ? String(c.perOrderRewardUnitCap) : "", startsAt: toLocalDateString(c.startsAt), endsAt: toLocalDateString(c.endsAt), status: c.status as any, buyTargets: c.buyTargets || [], rewardTargets: c.rewardTargets || [] });
    setXyModalOpen(true);
  };
  const saveXy = () => {
    if (!xyForm.name.trim()) { toast.error("Ime je obavezno."); return; }
    if (xyForm.buyTargets.length === 0 || xyForm.rewardTargets.length === 0) { toast.error("Izaberite bar jedan cilj za uslov i nagradu."); return; }

    const bq = parseStrictInt(xyForm.buyQuantity, { label: "Kupi količinu", min: 1 });
    const rq = parseStrictInt(xyForm.rewardQuantity, { label: "Nagrada količina", min: 1 });
    const rp = parseStrictInt(xyForm.rewardPercent, { label: "Nagrada popust", min: 1, max: 100 });
    if (!bq.ok) { toast.error(bq.message); return; }
    if (!rq.ok) { toast.error(rq.message); return; }
    if (!rp.ok) { toast.error(rp.message); return; }

    const cap = xyForm.perOrderRewardUnitCap.trim() ? parseStrictInt(xyForm.perOrderRewardUnitCap, { label: "Maksimalno jedinica", min: 1 }) : null;
    if (cap && !cap.ok) { toast.error(cap.message); return; }

    const payload: AutomaticXyPromotionInput = {
      name: xyForm.name.trim(), market: xyForm.market, buyQuantity: bq.value, rewardQuantity: rq.value, rewardPercent: rp.value,
      perOrderRewardUnitCap: cap ? cap.value : null, startsAt: toIsoDateString(xyForm.startsAt), endsAt: toIsoDateString(xyForm.endsAt),
      status: xyForm.status, buyTargets: xyForm.buyTargets, rewardTargets: xyForm.rewardTargets
    };

    if (!actionGuard.begin("save-xy")) return;
    const opts = {
      onSuccess: () => { toast.success("Sačuvano."); queryClient.invalidateQueries({ queryKey: getAdminListAutomaticXyPromotionsQueryKey() }); setXyModalOpen(false); actionGuard.end("save-xy"); },
      onError: (err: any) => { toast.error(extractApiError(err, "Greška pri čuvanju.")); actionGuard.end("save-xy"); }
    };
    if (editingXy) updateXy.mutate({ id: editingXy.id, data: { ...payload, version: editingXy.version } }, opts);
    else createXy.mutate({ data: payload }, opts);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-serif font-bold text-foreground">Marketinške Kampanje</h1>
          <p className="text-muted-foreground text-sm">Masovna sniženja i automatske akcije (Npr. Kupi 2, 3. gratis).</p>
        </div>

        <Tabs defaultValue="bulk" className="w-full">
          <TabsList>
            <TabsTrigger value="bulk">Masovna sniženja</TabsTrigger>
            <TabsTrigger value="xy">X+Y Akcije</TabsTrigger>
          </TabsList>

          <TabsContent value="bulk" className="mt-4">
            <div className="flex justify-end mb-4">
              <Button onClick={openNewBulk} disabled={!canManage}><Plus className="w-4 h-4 mr-2" /> Nova kampanja</Button>
            </div>
            <div className="bg-card rounded-xl border shadow-sm divide-y">
              {loadingBulk ? <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div> :
               bulkCampaigns.length === 0 ? <div className="p-12 text-center text-muted-foreground">Nema masovnih sniženja.</div> :
               bulkCampaigns.map(c => (
                 <div key={c.id} className={`p-5 flex items-center justify-between ${c.status !== 'ACTIVE' ? 'opacity-60' : ''}`}>
                   <div>
                     <h3 className="font-bold flex items-center gap-2">{c.name} {c.status !== 'ACTIVE' && <Badge variant="outline">Neaktivno</Badge>}</h3>
                     <p className="text-sm text-muted-foreground mt-1">Popust: <strong className="text-primary">{c.discountValue}{c.discountType === 'PERCENT' ? '%' : ' RSD'}</strong> | Meta: {c.targets?.length} kom.</p>
                   </div>
                   <div className="flex gap-2">
                     <Button variant="outline" size="sm" onClick={() => openEditBulk(c)} disabled={!canManage}><Edit2 className="w-4 h-4 mr-2" /> Izmeni</Button>
                     <Button variant="outline" size="sm" className="text-destructive" onClick={() => { if(window.confirm('Brisati?')) deleteBulk.mutate({ id: c.id, params: { version: c.version } }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getAdminListBulkSaleCampaignsQueryKey() }) })}} disabled={!canManage}><Trash2 className="w-4 h-4" /></Button>
                   </div>
                 </div>
               ))}
            </div>
          </TabsContent>

          <TabsContent value="xy" className="mt-4">
            <div className="flex justify-end mb-4">
              <Button onClick={openNewXy} disabled={!canManage}><Plus className="w-4 h-4 mr-2" /> Nova X+Y akcija</Button>
            </div>
            <div className="bg-card rounded-xl border shadow-sm divide-y">
              {loadingXy ? <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div> :
               xyPromotions.length === 0 ? <div className="p-12 text-center text-muted-foreground">Nema X+Y akcija.</div> :
               xyPromotions.map(c => (
                 <div key={c.id} className={`p-5 flex items-center justify-between ${c.status !== 'ACTIVE' ? 'opacity-60' : ''}`}>
                   <div>
                     <h3 className="font-bold flex items-center gap-2">{c.name} {c.status !== 'ACTIVE' && <Badge variant="outline">Neaktivno</Badge>}</h3>
                     <p className="text-sm text-muted-foreground mt-1">
                       Kupi {c.buyQuantity} → Dobij {c.rewardQuantity} uz {c.rewardPercent === 100 ? '100% (Besplatno)' : `${c.rewardPercent}% popusta`}
                     </p>
                   </div>
                   <div className="flex gap-2">
                     <Button variant="outline" size="sm" onClick={() => openEditXy(c)} disabled={!canManage}><Edit2 className="w-4 h-4 mr-2" /> Izmeni</Button>
                     <Button variant="outline" size="sm" className="text-destructive" onClick={() => { if(window.confirm('Brisati?')) deleteXy.mutate({ id: c.id, params: { version: c.version } }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getAdminListAutomaticXyPromotionsQueryKey() }) })}} disabled={!canManage}><Trash2 className="w-4 h-4" /></Button>
                   </div>
                 </div>
               ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Bulk Campaign Modal */}
      <Dialog open={bulkModalOpen} onOpenChange={setBulkModalOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingBulk ? 'Izmeni Masovno Sniženje' : 'Novo Masovno Sniženje'}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Naziv</Label><Input value={bulkForm.name} onChange={e => setBulkForm({...bulkForm, name: e.target.value})} /></div>
              <div className="space-y-2">
                <Label>Tržište</Label>
                <Select value={bulkForm.market} onValueChange={(v: any) => setBulkForm({...bulkForm, market: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="BOTH">Svi</SelectItem><SelectItem value="B2B">Samo B2B</SelectItem><SelectItem value="B2C">Samo B2C</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tip Popusta</Label>
                <Select value={bulkForm.discountType} onValueChange={(v: any) => setBulkForm({...bulkForm, discountType: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="PERCENT">Procenat (%)</SelectItem><SelectItem value="FIXED_RSD">Fiksni iznos (RSD)</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Vrednost Popusta</Label><Input type="number" value={bulkForm.discountValue} onChange={e => setBulkForm({...bulkForm, discountValue: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Početak</Label><Input type="date" value={bulkForm.startsAt} onChange={e => setBulkForm({...bulkForm, startsAt: e.target.value})} /></div>
              <div className="space-y-2"><Label>Kraj (Opciono)</Label><Input type="date" value={bulkForm.endsAt} onChange={e => setBulkForm({...bulkForm, endsAt: e.target.value})} /></div>
            </div>
            <div className="space-y-2 border rounded-xl p-4 bg-muted/20">
              <Label>Ciljevi (Proizvodi ili Kategorije na koje se primenjuje)</Label>
              <TargetsEditor targets={bulkForm.targets} setTargets={t => setBulkForm({...bulkForm, targets: t})} products={products} categories={categories} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={bulkForm.status} onValueChange={(v: any) => setBulkForm({...bulkForm, status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ACTIVE">Aktivno</SelectItem><SelectItem value="DRAFT">Nacrt (Neaktivno)</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setBulkModalOpen(false)}>Odustani</Button><Button onClick={saveBulk}>Sačuvaj</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* X+Y Modal */}
      <Dialog open={xyModalOpen} onOpenChange={setXyModalOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingXy ? 'Izmeni X+Y Akciju' : 'Nova X+Y Akcija'}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Naziv</Label><Input value={xyForm.name} onChange={e => setXyForm({...xyForm, name: e.target.value})} /></div>
              <div className="space-y-2">
                <Label>Tržište</Label>
                <Select value={xyForm.market} onValueChange={(v: any) => setXyForm({...xyForm, market: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="BOTH">Svi</SelectItem><SelectItem value="B2B">Samo B2B</SelectItem><SelectItem value="B2C">Samo B2C</SelectItem></SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 border rounded-xl p-4 bg-primary/5">
              <div className="space-y-2"><Label>Kupi (Količina)</Label><Input type="number" min="1" value={xyForm.buyQuantity} onChange={e => setXyForm({...xyForm, buyQuantity: e.target.value})} /></div>
              <div className="space-y-2"><Label>Dobij (Količina)</Label><Input type="number" min="1" value={xyForm.rewardQuantity} onChange={e => setXyForm({...xyForm, rewardQuantity: e.target.value})} /></div>
              <div className="space-y-2"><Label>Popust (%) na nagradu</Label><Input type="number" min="1" max="100" value={xyForm.rewardPercent} onChange={e => setXyForm({...xyForm, rewardPercent: e.target.value})} /></div>
              <div className="col-span-3 text-xs text-muted-foreground">Kupi {xyForm.buyQuantity}, dobij {xyForm.rewardQuantity} sa {xyForm.rewardPercent}% popusta (100% = Besplatno).</div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 border rounded-xl p-4 bg-muted/20">
                <Label>Šta mora da kupi (Uslov)</Label>
                <TargetsEditor targets={xyForm.buyTargets} setTargets={t => setXyForm({...xyForm, buyTargets: t})} products={products} categories={categories} />
              </div>
              <div className="space-y-2 border rounded-xl p-4 bg-muted/20">
                <Label>Šta može da dobije (Nagrada)</Label>
                <TargetsEditor targets={xyForm.rewardTargets} setTargets={t => setXyForm({...xyForm, rewardTargets: t})} products={products} categories={categories} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Limit po porudžbini (Max kom.)</Label><Input type="number" min="1" value={xyForm.perOrderRewardUnitCap} onChange={e => setXyForm({...xyForm, perOrderRewardUnitCap: e.target.value})} placeholder="Bez limita" /></div>
              <div className="space-y-2"><Label>Početak</Label><Input type="date" value={xyForm.startsAt} onChange={e => setXyForm({...xyForm, startsAt: e.target.value})} /></div>
              <div className="space-y-2"><Label>Kraj (Opciono)</Label><Input type="date" value={xyForm.endsAt} onChange={e => setXyForm({...xyForm, endsAt: e.target.value})} /></div>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={xyForm.status} onValueChange={(v: any) => setXyForm({...xyForm, status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ACTIVE">Aktivno</SelectItem><SelectItem value="DRAFT">Nacrt (Neaktivno)</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setXyModalOpen(false)}>Odustani</Button><Button onClick={saveXy}>Sačuvaj</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
