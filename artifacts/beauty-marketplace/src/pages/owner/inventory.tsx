import { useState, useMemo } from "react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { 
  useListSalonInventory, 
  useUpdateSalonInventoryItem, 
  getListSalonInventoryQueryKey,
  useGetCurrentUser
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Package, Search, AlertCircle, ShoppingCart, Info, Edit2 } from "lucide-react";
import { Link } from "wouter";
import { OptimizedImage } from "@/components/optimized-image";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export default function OwnerInventory() {
  const { data: userResp } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: inventory, isLoading } = useListSalonInventory({
    query: {
      enabled: !!userResp?.user,
      queryKey: getListSalonInventoryQueryKey(),
    }
  });

  const updateMutation = useUpdateSalonInventoryItem();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL"); // ALL, LOW_STOCK
  
  const [editItem, setEditItem] = useState<any>(null);
  const [formData, setFormData] = useState({
    quantity: "",
    lowStockThreshold: "",
    unitContentAmount: "",
    usageUnit: ""
  });

  const filteredInventory = useMemo(() => {
    if (!inventory) return [];
    return inventory.filter((item: any) => {
      const matchesSearch = item.productName.toLowerCase().includes(search.toLowerCase()) ||
                            (item.productSku && item.productSku.toLowerCase().includes(search.toLowerCase()));
      const matchesFilter = filter === "ALL" || (filter === "LOW_STOCK" && item.lowStock);
      return matchesSearch && matchesFilter;
    });
  }, [inventory, search, filter]);

  const openEdit = (item: any) => {
    setEditItem(item);
    setFormData({
      quantity: item.quantity?.toString() || "0",
      lowStockThreshold: item.lowStockThreshold?.toString() || "",
      unitContentAmount: item.unitContentAmount?.toString() || "1",
      usageUnit: item.usageUnit || ""
    });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem) return;

    updateMutation.mutate({
      productId: editItem.productId,
      data: {
        quantity: Number(formData.quantity),
        lowStockThreshold: formData.lowStockThreshold === "" ? null : Number(formData.lowStockThreshold),
        unitContentAmount: Number(formData.unitContentAmount),
        usageUnit: formData.usageUnit || null,
      }
    }, {
      onSuccess: () => {
        toast.success("Zalihe su ažurirane.");
        setEditItem(null);
        queryClient.invalidateQueries({ queryKey: getListSalonInventoryQueryKey() });
      },
      onError: (err) => {
        toast.error("Greška pri čuvanju", { description: err instanceof Error ? err.message : "Pokušajte ponovo." });
      }
    });
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/inventar" />
        
        <div className="flex-1 space-y-6 w-full min-w-0" data-testid="page-owner-inventory">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">Inventar</h1>
            <p className="text-muted-foreground mt-1">Pratite zalihe radnog materijala i konfigurišite upozorenja.</p>
          </div>

          <div className="bg-primary/5 border border-primary/20 p-4 rounded-xl flex gap-3 text-sm">
            <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="text-muted-foreground space-y-1">
              <p><strong className="text-foreground">Kako ovo radi?</strong> Količina je izražena u <strong>jedinicama upotrebe</strong> (npr. ml, grami, komadi). Kupovinom u B2B prodavnici zalihe se automatski uvećavaju, a izvršavanjem tretmana (za koje ste podesili potrošnju) zalihe se automatski smanjuju.</p>
              <p><strong className="text-foreground">Sadržaj pakovanja</strong> označava koliko jedinica upotrebe (npr. 500ml) sadrži jedno kupljeno pakovanje proizvoda. <strong className="text-foreground">Prag za upozorenje</strong> određuje kada proizvod dobija oznaku "Pri kraju".</p>
            </div>
          </div>

          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4">
              <CardTitle className="text-lg">Stanje zaliha</CardTitle>
              <div className="flex items-center gap-3">
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input 
                    placeholder="Pretraži proizvode..." 
                    className="pl-9 h-9 text-sm"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                >
                  <option value="ALL">Svi proizvodi</option>
                  <option value="LOW_STOCK">Pri kraju zaliha</option>
                </select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : inventory?.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
                  <Package className="w-12 h-12 mb-4 opacity-20" />
                  <p>Nemate zalihe u inventaru.</p>
                  <p className="text-sm mt-1">Zalihe se pojavljuju nakon što kupite materijal u B2B prodavnici.</p>
                  <Button asChild variant="outline" className="mt-4">
                    <Link href="/vlasnik/shop"><ShoppingCart className="w-4 h-4 mr-2" /> Poseti B2B Prodavnicu</Link>
                  </Button>
                </div>
              ) : filteredInventory.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  Nema pronađenih proizvoda koji odgovaraju pretrazi.
                </div>
              ) : (
                <div className="divide-y">
                  {filteredInventory.map((item: any) => (
                    <div key={item.productId} className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${item.lowStock ? 'bg-orange-50/50' : 'hover:bg-muted/10'}`}>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white rounded-lg border overflow-hidden flex items-center justify-center shrink-0">
                          {item.productImageUrl ? (
                            <OptimizedImage src={item.productImageUrl} alt={item.productName} width={48} height={48} className="object-cover w-full h-full" />
                          ) : (
                            <Package className="w-6 h-6 text-muted-foreground/30" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold text-foreground">{item.productName}</h4>
                            {item.lowStock && (
                              <Badge variant="secondary" className="bg-orange-100 text-orange-700 flex items-center gap-1 border-orange-200">
                                <AlertCircle className="w-3 h-3" /> Pri kraju
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">SKU: {item.productSku} • Pakovanje: {item.unitContentAmount} {item.usageUnit || item.unit}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-6 sm:text-right">
                        <div className="text-sm min-w-[120px]">
                          <p className={`font-bold text-lg ${item.lowStock ? 'text-orange-600' : 'text-foreground'}`}>
                            {item.quantity} <span className="text-sm font-normal text-muted-foreground">{item.usageUnit || item.unit}</span>
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Prag: {item.effectiveThreshold} {item.usageUnit || item.unit}
                            {item.lowStockThreshold === null && " (auto)"}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => openEdit(item)}>
                          <Edit2 className="w-4 h-4 mr-2" /> Podesi
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Podešavanje zaliha</DialogTitle>
            <DialogDescription>
              {editItem?.productName}
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleUpdate} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Trenutno stanje zaliha ({formData.usageUnit || editItem?.unit})</Label>
              <Input 
                type="number" 
                step="0.01" 
                value={formData.quantity} 
                onChange={e => setFormData({...formData, quantity: e.target.value})} 
                required 
              />
              <p className="text-xs text-muted-foreground">Korekcija stvarnog stanja u salonu.</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Sadržaj 1 pakovanja</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  value={formData.unitContentAmount} 
                  onChange={e => setFormData({...formData, unitContentAmount: e.target.value})} 
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label>Jedinica mere</Label>
                <Input 
                  placeholder={editItem?.unit} 
                  value={formData.usageUnit} 
                  onChange={e => setFormData({...formData, usageUnit: e.target.value})} 
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Ako kupujete bocu od 500ml, sadržaj je 500 a jedinica je "ml".</p>
            
            <div className="space-y-2 pt-2 border-t mt-4">
              <Label>Prag za upozorenje o niskim zalihama</Label>
              <Input 
                type="number" 
                step="0.01"
                placeholder={`Automatski (10% max)`} 
                value={formData.lowStockThreshold} 
                onChange={e => setFormData({...formData, lowStockThreshold: e.target.value})} 
              />
              <p className="text-xs text-muted-foreground">Ostavite prazno za automatsko izračunavanje (10% od najveće ikad zabeležene količine).</p>
            </div>

            <Button type="submit" className="w-full mt-6" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Sačuvaj izmene
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </BusinessLayout>
  );
}
