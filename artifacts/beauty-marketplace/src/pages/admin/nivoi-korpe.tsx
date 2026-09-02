import { useState } from "react";
import { AdminLayout } from "./layout";
import {
  useAdminListCartThresholdRewards,
  useAdminCreateCartThresholdReward,
  useAdminUpdateCartThresholdReward,
  useAdminDeleteCartThresholdReward,
  getAdminListCartThresholdRewardsQueryKey,
  useAdminListProducts,
  getAdminListProductsQueryKey,
  useGetCurrentUser
} from "@workspace/api-client-react";
import type { CartThresholdReward, CartThresholdRewardInput, AdminListProductsParams } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Edit2, Trash2, ShoppingBag, ChevronRight, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { extractApiError, parseStrictInt } from "@/lib/admin-form-utils";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";
import { useDebouncedSearch } from "@/hooks/use-debounce";

export default function AdminCartThresholdRewards() {
  const { data: rewards, isLoading, error } = useAdminListCartThresholdRewards();
  const createReward = useAdminCreateCartThresholdReward();
  const updateReward = useAdminUpdateCartThresholdReward();
  const deleteReward = useAdminDeleteCartThresholdReward();
  const { data: currentUserResponse } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  const canManage = currentUserResponse?.user?.role === "SUPER_ADMIN" || currentUserResponse?.user?.role === "ADMIN";

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReward, setEditingReward] = useState<CartThresholdReward | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    market: "B2B" | "B2C" | "BOTH";
    spendThresholdRsd: string;
    rewardKind: "FREE_SHIPPING" | "GIFT_PRODUCT" | "PERCENT_DISCOUNT";
    discountPercent: string;
    giftProductId: string;
    giftQuantity: string;
    active: boolean;
  }>({
    name: "",
    market: "BOTH",
    spendThresholdRsd: "0",
    rewardKind: "FREE_SHIPPING",
    discountPercent: "",
    giftProductId: "",
    giftQuantity: "1",
    active: true
  });

  const [productSearch, setProductSearch] = useState("");
  const debouncedProductSearch = useDebouncedSearch(productSearch);
  const { data: productsData } = useAdminListProducts(
    { search: debouncedProductSearch, page: 1, pageSize: 50 },
    { query: { enabled: formData.rewardKind === "GIFT_PRODUCT", queryKey: getAdminListProductsQueryKey({ search: debouncedProductSearch, page: 1, pageSize: 50 }) } }
  );

  const handleOpenNew = () => {
    if (!canManage) return;
    setEditingReward(null);
    setFormData({
      name: "", market: "BOTH", spendThresholdRsd: "0",
      rewardKind: "FREE_SHIPPING", discountPercent: "", giftProductId: "", giftQuantity: "1", active: true
    });
    setProductSearch("");
    setIsModalOpen(true);
  };

  const handleOpenEdit = (reward: CartThresholdReward) => {
    if (!canManage) return;
    setEditingReward(reward);
    setFormData({
      name: reward.name,
      market: reward.market as any,
      spendThresholdRsd: String(reward.spendThresholdRsd),
      rewardKind: reward.rewardKind as any,
      discountPercent: reward.discountPercent ? String(reward.discountPercent) : "",
      giftProductId: reward.giftProductId || "",
      giftQuantity: reward.giftQuantity ? String(reward.giftQuantity) : "1",
      active: reward.active
    });
    setProductSearch("");
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (!canManage) return;
    if (createReward.isPending || updateReward.isPending) return;

    if (!formData.name?.trim()) {
      toast.error("Greška", { description: "Ime je obavezno." });
      return;
    }
    const thresholdParsed = parseStrictInt(formData.spendThresholdRsd, { label: "Prag potrošnje", allowNegative: false, allowZero: false });
    if (!thresholdParsed.ok) { toast.error("Greška", { description: thresholdParsed.message }); return; }

    let payload: CartThresholdRewardInput;
    if (formData.rewardKind === "FREE_SHIPPING") {
      payload = { name: formData.name.trim(), market: formData.market, spendThresholdRsd: thresholdParsed.value, rewardKind: "FREE_SHIPPING", active: formData.active };
    } else if (formData.rewardKind === "GIFT_PRODUCT") {
      if (!formData.giftProductId) { toast.error("Greška", { description: "Morate izabrati poklon proizvod." }); return; }
      const qtyParsed = parseStrictInt(formData.giftQuantity, { label: "Količina poklona", allowNegative: false, allowZero: false, min: 1 });
      if (!qtyParsed.ok) { toast.error("Greška", { description: qtyParsed.message }); return; }
      payload = { name: formData.name.trim(), market: formData.market, spendThresholdRsd: thresholdParsed.value, rewardKind: "GIFT_PRODUCT", giftProductId: formData.giftProductId, giftQuantity: qtyParsed.value, active: formData.active };
    } else {
      const discParsed = parseStrictInt(formData.discountPercent, { label: "Procenat popusta", allowNegative: false, allowZero: false, min: 1, max: 100 });
      if (!discParsed.ok) { toast.error("Greška", { description: discParsed.message }); return; }
      payload = { name: formData.name.trim(), market: formData.market, spendThresholdRsd: thresholdParsed.value, rewardKind: "PERCENT_DISCOUNT", discountPercent: discParsed.value, active: formData.active };
    }

    if (!actionGuard.begin("save")) return;

    if (editingReward) {
      updateReward.mutate({ id: editingReward.id, data: { ...payload, version: editingReward.version } }, {
        onSuccess: () => {
          toast.success("Sačuvano", { description: "Pravilo je uspešno ažurirano." });
          queryClient.invalidateQueries({ queryKey: getAdminListCartThresholdRewardsQueryKey() });
          setIsModalOpen(false);
          actionGuard.end("save");
        },
        onError: (err: unknown) => {
          toast.error("Greška", { description: extractApiError(err, "Pravilo nije sačuvano.") });
          actionGuard.end("save");
        },
      });
    } else {
      createReward.mutate({ data: payload }, {
        onSuccess: () => {
          toast.success("Kreirano", { description: "Novo pravilo je uspešno kreirano." });
          queryClient.invalidateQueries({ queryKey: getAdminListCartThresholdRewardsQueryKey() });
          setIsModalOpen(false);
          actionGuard.end("save");
        },
        onError: (err: unknown) => {
          toast.error("Greška", { description: extractApiError(err, "Pravilo nije kreirano.") });
          actionGuard.end("save");
        },
      });
    }
  };

  const handleDelete = (reward: CartThresholdReward) => {
    if (!canManage) return;
    const actionKey = `delete:${reward.id}`;
    if (!actionGuard.begin(actionKey)) return;
    if (!window.confirm("Da li ste sigurni da želite obrisati ovo pravilo?")) {
      actionGuard.end(actionKey);
      return;
    }

    deleteReward.mutate({ id: reward.id, params: { version: reward.version } }, {
      onSuccess: () => {
        toast.success("Obrisano", { description: "Pravilo je uklonjeno." });
        queryClient.invalidateQueries({ queryKey: getAdminListCartThresholdRewardsQueryKey() });
        actionGuard.end(actionKey);
      },
      onError: () => {
        toast.error("Greška", { description: "Pravilo nije uklonjeno." });
        actionGuard.end(actionKey);
      },
    });
  };

  const productOptions = (productsData?.items || []).map(p => ({ value: p.id, label: `${p.name} (${p.sku})` }));
  if (editingReward && editingReward.giftProductId && !productOptions.find(o => o.value === editingReward.giftProductId)) {
    productOptions.push({ value: editingReward.giftProductId, label: "Izabrani proizvod (učitavanje...)" });
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">Nivoi Korpe (Threshold Rewards)</h1>
            <p className="text-muted-foreground text-sm">
              Upravljajte nagradama na osnovu potrošnje u korpi (npr. besplatna dostava iznad 5000 RSD).
            </p>
          </div>
          <Button onClick={handleOpenNew} disabled={!canManage} className="shrink-0 gap-2">
            <Plus className="w-4 h-4" /> Novo Pravilo
          </Button>
        </div>

        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">Došlo je do greške pri učitavanju.</div>
          ) : !rewards || rewards.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-muted-foreground">
              <ShoppingBag className="w-12 h-12 mb-4 opacity-20" />
              <p>Nema kreiranih pravila.</p>
              <Button variant="outline" className="mt-4" onClick={handleOpenNew} disabled={!canManage}>Kreiraj prvo pravilo</Button>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {rewards.sort((a, b) => a.spendThresholdRsd - b.spendThresholdRsd).map(reward => (
                <div key={reward.id} className={`p-6 flex flex-col lg:flex-row gap-6 hover:bg-muted/10 transition-colors ${!reward.active ? 'opacity-60' : ''}`}>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
                        {reward.name}
                        {!reward.active && <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-normal">Neaktivno</span>}
                      </h3>
                      <span className="text-xs font-semibold bg-primary/10 text-primary px-2 py-1 rounded">
                        {reward.market === 'BOTH' ? 'B2B & B2C' : reward.market}
                      </span>
                    </div>
                    <p className="text-sm">
                      Prag: <strong className="text-primary">{reward.spendThresholdRsd.toLocaleString()} RSD</strong>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Nagrada:
                      {reward.rewardKind === 'FREE_SHIPPING' && ' Besplatna dostava'}
                      {reward.rewardKind === 'PERCENT_DISCOUNT' && ` Popust na celokupnu porudžbinu (${reward.discountPercent}%)`}
                      {reward.rewardKind === 'GIFT_PRODUCT' && ` Poklon proizvod (${reward.giftQuantity} kom.)`}
                    </p>
                  </div>

                  <div className="flex flex-row lg:flex-col gap-2 justify-end shrink-0 border-t lg:border-t-0 lg:border-l pt-4 lg:pt-0 lg:pl-6 border-border/50">
                    <Button variant="outline" size="sm" className="flex-1 lg:flex-none justify-start" onClick={() => handleOpenEdit(reward)} disabled={!canManage}>
                      <Edit2 className="w-4 h-4 mr-2 text-muted-foreground" /> Izmeni
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 lg:flex-none justify-start text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(reward)} disabled={!canManage || actionGuard.isActive(`delete:${reward.id}`)}>
                      <Trash2 className="w-4 h-4 mr-2" /> Obriši
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={canManage && isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingReward ? "Izmeni Nivo Korpe" : "Novi Nivo Korpe"}</DialogTitle>
            <DialogDescription>
              Pravilo se automatski primenjuje u korpi kada ukupna vrednost dostigne prag.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Naziv pravila (interno)</Label>
                <Input id="name" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="npr. Besplatna dostava > 5000" />
              </div>
              <div className="space-y-2">
                <Label>Tržište</Label>
                <Select value={formData.market} onValueChange={(v: any) => setFormData({...formData, market: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BOTH">Svi kupci (B2B i B2C)</SelectItem>
                    <SelectItem value="B2B">Samo B2B (Saloni)</SelectItem>
                    <SelectItem value="B2C">Samo B2C (Fizička lica)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="spendThreshold">Prag potrošnje (RSD)</Label>
                <Input id="spendThreshold" type="number" min="0" value={formData.spendThresholdRsd} onChange={e => setFormData({ ...formData, spendThresholdRsd: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Vrsta Nagrade</Label>
                <Select value={formData.rewardKind} onValueChange={(v: any) => setFormData({...formData, rewardKind: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FREE_SHIPPING">Besplatna dostava</SelectItem>
                    <SelectItem value="PERCENT_DISCOUNT">Procentualni popust na korpu</SelectItem>
                    <SelectItem value="GIFT_PRODUCT">Poklon proizvod</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.rewardKind === "PERCENT_DISCOUNT" && (
              <div className="space-y-2">
                <Label htmlFor="disc">Popust (%)</Label>
                <Input id="disc" type="number" min="1" max="100" value={formData.discountPercent} onChange={e => setFormData({ ...formData, discountPercent: e.target.value })} />
              </div>
            )}

            {formData.rewardKind === "GIFT_PRODUCT" && (
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-2">
                  <Label>Poklon Proizvod</Label>
                  <SearchableCombobox
                    value={formData.giftProductId}
                    onValueChange={(val) => setFormData({ ...formData, giftProductId: val || "" })}
                    options={productOptions}
                    placeholder="Pretraži proizvode..."
                    searchPlaceholder="Ime ili SKU..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Količina poklona</Label>
                  <Input type="number" min="1" value={formData.giftQuantity} onChange={e => setFormData({ ...formData, giftQuantity: e.target.value })} />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t">
              <Label htmlFor="activeRule" className="cursor-pointer font-bold">Pravilo je aktivno</Label>
              <Switch id="activeRule" checked={formData.active} onCheckedChange={c => setFormData({...formData, active: c})} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>Odustani</Button>
            <Button onClick={handleSave} disabled={!canManage || createReward.isPending || updateReward.isPending || actionGuard.isActive("save")}>
              {(createReward.isPending || updateReward.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj Pravilo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
