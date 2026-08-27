import { useState } from "react";
import { AdminLayout } from "./layout";
import { 
  useAdminListB2cBanners,
  useAdminCreateB2cBanner,
  useAdminUpdateB2cBanner,
  useAdminDeleteB2cBanner,
  useAdminReorderB2cBanners,
  getAdminListB2cBannersQueryKey,
  useAdminListSuppliers
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, GripVertical, Trash2, Edit2, Check, X, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractApiError } from "@/lib/admin-form-utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export default function AdminB2cBannersPage() {
  const { data: suppliers = [], isLoading: loadingSuppliers } = useAdminListSuppliers();
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("__all__");

  const queryParams = selectedSupplierId === "__all__" ? undefined : { supplierId: selectedSupplierId };
  const { data: responseData, isLoading } = useAdminListB2cBanners(queryParams, { query: { enabled: !loadingSuppliers, queryKey: getAdminListB2cBannersQueryKey(queryParams) } });
  
  // The API returns void in the types, but actually returns a list from the DB
  const items: any[] = (Array.isArray(responseData) ? responseData : []) as any[];
  
  const createReq = useAdminCreateB2cBanner();
  const updateReq = useAdminUpdateB2cBanner();
  const deleteReq = useAdminDeleteB2cBanner();
  const reorderReq = useAdminReorderB2cBanners();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBanner, setEditingBanner] = useState<any>(null);

  const emptyForm = {
    internalName: "",
    supplierId: "",
    desktopImageUrl: "",
    mobileImageUrl: null,
    headline: "",
    text: null,
    ctaLabel: null,
    placement: "HERO",
    destinationKind: "CUSTOM_INTERNAL_PATH",
    destinationCategoryId: null,
    destinationProductId: null,
    filteredListing: null,
    customInternalPath: "",
    startsAt: null,
    endsAt: null,
    active: true
  };

  const [form, setForm] = useState<any>(emptyForm);

  const handleOpenDialog = (banner?: any) => {
    if (banner) {
      setEditingBanner(banner);
      setForm({
        internalName: banner.internalName || banner.headline,
        supplierId: banner.supplierId,
        desktopImageUrl: banner.desktopImageUrl,
        mobileImageUrl: banner.mobileImageUrl,
        headline: banner.headline,
        text: banner.text,
        ctaLabel: banner.ctaLabel,
        placement: banner.placement,
        destinationKind: banner.destinationKind || "CUSTOM_INTERNAL_PATH",
        destinationCategoryId: banner.destinationCategoryId,
        destinationProductId: banner.destinationProductId,
        filteredListing: banner.filteredListing ? JSON.stringify(banner.filteredListing) : null,
        customInternalPath: banner.customInternalPath || "",
        startsAt: banner.startsAt ? new Date(banner.startsAt).toISOString().slice(0, 16) : null,
        endsAt: banner.endsAt ? new Date(banner.endsAt).toISOString().slice(0, 16) : null,
        active: banner.active
      });
    } else {
      setEditingBanner(null);
      setForm({ ...emptyForm, supplierId: selectedSupplierId !== "__all__" ? selectedSupplierId : "" });
    }
    setIsDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.supplierId) { toast.error("Greška", { description: "Dobavljač je obavezan." }); return; }
    if (!form.internalName.trim()) { toast.error("Greška", { description: "Interni naziv je obavezan." }); return; }
    if (!form.headline.trim()) { toast.error("Greška", { description: "Naslov je obavezan." }); return; }
    if (!form.desktopImageUrl.trim()) { toast.error("Greška", { description: "Desktop slika je obavezna." }); return; }
    if (!form.destinationKind) { toast.error("Greška", { description: "Vrsta destinacije je obavezna." }); return; }
    
    if (form.destinationKind === 'CATEGORY' && !form.destinationCategoryId) { toast.error("Greška", { description: "Kategorija je obavezna." }); return; }
    if (form.destinationKind === 'PRODUCT' && !form.destinationProductId) { toast.error("Greška", { description: "Proizvod je obavezan." }); return; }
    if (form.destinationKind === 'CUSTOM_INTERNAL_PATH' && !form.customInternalPath) { toast.error("Greška", { description: "Putanja je obavezna." }); return; }

    let parsedFilteredListing = null;
    if (form.destinationKind === 'FILTERED_LISTING' && form.filteredListing) {
      try {
        parsedFilteredListing = JSON.parse(form.filteredListing);
      } catch {
        toast.error("Greška", { description: "Neispravan JSON format za filter." });
        return;
      }
    }

    const payload = {
      supplierId: form.supplierId,
      internalName: form.internalName.trim(),
      desktopImageUrl: form.desktopImageUrl,
      mobileImageUrl: form.mobileImageUrl || null,
      headline: form.headline,
      text: form.text || null,
      ctaLabel: form.ctaLabel || null,
      placement: form.placement,
      destinationKind: form.destinationKind,
      destinationCategoryId: form.destinationKind === 'CATEGORY' ? form.destinationCategoryId : null,
      destinationProductId: form.destinationKind === 'PRODUCT' ? form.destinationProductId : null,
      filteredListing: parsedFilteredListing,
      customInternalPath: form.destinationKind === 'CUSTOM_INTERNAL_PATH' ? form.customInternalPath : null,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      active: form.active,
      sortOrder: editingBanner ? editingBanner.sortOrder : items.length,
    };

    if (editingBanner) {
      updateReq.mutate({ id: editingBanner.id, data: { ...payload, expectedVersion: editingBanner.version } as any }, {
        onSuccess: () => {
          toast.success("Baner ažuriran");
          setIsDialogOpen(false);
          qc.invalidateQueries({ queryKey: getAdminListB2cBannersQueryKey() });
        },
        onError: (err) => toast.error("Greška", { description: extractApiError(err) })
      });
    } else {
      createReq.mutate({ data: payload as any }, {
        onSuccess: () => {
          toast.success("Baner kreiran");
          setIsDialogOpen(false);
          qc.invalidateQueries({ queryKey: getAdminListB2cBannersQueryKey() });
        },
        onError: (err) => toast.error("Greška", { description: extractApiError(err) })
      });
    }
  };

  const handleUpdateActive = (item: any, active: boolean) => {
    updateReq.mutate({ id: item.id, data: { active, expectedVersion: item.version } as any }, {
      onSuccess: () => {
        toast.success(active ? "Aktivirano" : "Deaktivirano");
        qc.invalidateQueries({ queryKey: getAdminListB2cBannersQueryKey() });
      },
      onError: (err) => toast.error("Greška", { description: extractApiError(err) })
    });
  };

  const handleDelete = (item: any) => {
    if (!window.confirm(`Brisanje banera "${item.headline}"?`)) return;
    deleteReq.mutate({ id: item.id, params: { expectedVersion: item.version } }, {
      onSuccess: () => {
        toast.success("Obrisano");
        qc.invalidateQueries({ queryKey: getAdminListB2cBannersQueryKey() });
      },
      onError: (err) => toast.error("Greška", { description: extractApiError(err) })
    });
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === items.length - 1) return;
    const newItems = [...items];
    const target = direction === 'up' ? index - 1 : index + 1;
    [newItems[index], newItems[target]] = [newItems[target], newItems[index]];
    
    reorderReq.mutate({
      data: {
        items: newItems.map((it, i) => ({ id: it.id, expectedVersion: it.version, sortOrder: i }))
      }
    }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAdminListB2cBannersQueryKey() }),
      onError: (err) => toast.error("Greška", { description: extractApiError(err) })
    });
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-serif font-bold tracking-tight text-foreground">B2C Baneri</h1>
            <p className="text-muted-foreground mt-2">Upravljajte promotivnim banerima na maloprodajnom izlogu dobavljača.</p>
          </div>
          <Button onClick={() => handleOpenDialog()} className="shrink-0">
            <Plus className="w-4 h-4 mr-2" /> Novi Baner
          </Button>
        </div>

        <div className="flex gap-4 bg-card p-4 rounded-xl border shadow-sm items-center">
          <Label>Prikaži za dobavljača:</Label>
          <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
            <SelectTrigger className="w-[300px]">
              <SelectValue placeholder="Svi dobavljači" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Svi dobavljači</SelectItem>
              {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="bg-card rounded-xl border shadow-sm divide-y">
          {isLoading || loadingSuppliers ? (
            <div className="p-12 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
              <ImageIcon className="w-12 h-12 mb-4 opacity-20" />
              Nema unetih banera za ovog dobavljača.
            </div>
          ) : (
            items.map((item, idx) => (
              <div key={item.id} className="flex flex-col sm:flex-row gap-4 p-4 items-center">
                <div className="flex flex-col gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(idx, 'up')} disabled={idx === 0 || selectedSupplierId === "__all__"}><GripVertical className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(idx, 'down')} disabled={idx === items.length - 1 || selectedSupplierId === "__all__"}><GripVertical className="w-4 h-4" /></Button>
                </div>
                
                <div className="w-32 h-16 bg-muted rounded overflow-hidden shrink-0 border relative">
                  {item.desktopImageUrl ? <img src={item.desktopImageUrl} alt={item.headline} className="w-full h-full object-cover" /> : <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Nema slike</div>}
                </div>
                
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-sm truncate">{item.headline}</h4>
                  <div className="text-xs text-muted-foreground truncate max-w-md">{item.text}</div>
                  <div className="text-[10px] uppercase font-bold text-primary mt-1">{item.placement}</div>
                </div>

                <div className="flex-1 text-xs text-muted-foreground">
                  <div><span className="font-medium">Dobavljač:</span> {suppliers.find(s => s.id === item.supplierId)?.name || 'Nepoznato'}</div>
                  {item.startsAt && <div><span className="font-medium">Od:</span> {new Date(item.startsAt).toLocaleString('sr-RS')}</div>}
                  {item.endsAt && <div><span className="font-medium">Do:</span> {new Date(item.endsAt).toLocaleString('sr-RS')}</div>}
                </div>
                
                <div className="flex items-center gap-4 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{item.active ? 'Aktivno' : 'Neaktivno'}</span>
                    <Switch checked={item.active} onCheckedChange={(v) => handleUpdateActive(item, v)} disabled={updateReq.isPending} />
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => handleOpenDialog(item)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="destructive" onClick={() => handleDelete(item)} disabled={deleteReq.isPending}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingBanner ? "Izmeni baner" : "Novi baner"}</DialogTitle>
              <DialogDescription>
                Unesite detalje za B2C baner. Slika, dobavljač, interni naziv i naslov su obavezni.
              </DialogDescription>
            </DialogHeader>

            <div className="grid sm:grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label>Dobavljač *</Label>
                <Select value={form.supplierId || "__none__"} onValueChange={(v) => setForm({ ...form, supplierId: v === "__none__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Izaberi dobavljača" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Izaberi —</SelectItem>
                    {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Interni naziv (Samo za admine) *</Label>
                <Input value={form.internalName} onChange={e => setForm({ ...form, internalName: e.target.value })} placeholder="npr. Prolećna kampanja 2024" />
              </div>

              <div className="space-y-2">
                <Label>Desktop slika (URL) *</Label>
                <Input value={form.desktopImageUrl} onChange={e => setForm({ ...form, desktopImageUrl: e.target.value })} placeholder="https://..." />
                {form.desktopImageUrl && (
                  <div className="w-full aspect-[3/1] bg-muted border rounded mt-2 overflow-hidden">
                    <img src={form.desktopImageUrl} className="w-full h-full object-cover" alt="Preview" />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Mobile slika (URL)</Label>
                <Input value={form.mobileImageUrl || ""} onChange={e => setForm({ ...form, mobileImageUrl: e.target.value || null })} placeholder="https://..." />
                {form.mobileImageUrl && (
                  <div className="w-[120px] aspect-[4/5] bg-muted border rounded mt-2 overflow-hidden">
                    <img src={form.mobileImageUrl} className="w-full h-full object-cover" alt="Preview" />
                  </div>
                )}
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Naslov (Headline) *</Label>
                <Input value={form.headline} onChange={e => setForm({ ...form, headline: e.target.value })} />
              </div>
              
              <div className="space-y-2 sm:col-span-2">
                <Label>Podnaslov / Tekst</Label>
                <Input value={form.text || ""} onChange={e => setForm({ ...form, text: e.target.value || null })} />
              </div>

              <div className="space-y-2">
                <Label>Pozicija (Placement)</Label>
                <Select value={form.placement} onValueChange={(v) => setForm({ ...form, placement: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HERO">Hero (Vrh stranice)</SelectItem>
                    <SelectItem value="BELOW_CATEGORIES">Ispod kategorija</SelectItem>
                    <SelectItem value="IN_RESULTS">U listingu</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>CTA Dugme tekst</Label>
                <Input value={form.ctaLabel || ""} onChange={e => setForm({ ...form, ctaLabel: e.target.value || null })} placeholder="npr. Saznaj više" />
              </div>

              <div className="space-y-2 sm:col-span-2 bg-muted/20 p-4 rounded-lg border">
                <Label className="text-sm font-semibold mb-3 block">Destinacija (Klik na baner) *</Label>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Vrsta destinacije</Label>
                    <Select value={form.destinationKind} onValueChange={(v) => setForm({ ...form, destinationKind: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CUSTOM_INTERNAL_PATH">Prilagođena URL putanja</SelectItem>
                        <SelectItem value="PRODUCT">Određeni proizvod</SelectItem>
                        <SelectItem value="CATEGORY">Kategorija</SelectItem>
                        <SelectItem value="FILTERED_LISTING">Filtrirana pretraga</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {form.destinationKind === 'CUSTOM_INTERNAL_PATH' && (
                    <div className="space-y-2">
                      <Label>Putanja</Label>
                      <Input value={form.customInternalPath} onChange={e => setForm({ ...form, customInternalPath: e.target.value })} placeholder="/proizvodi?..." />
                    </div>
                  )}
                  {form.destinationKind === 'PRODUCT' && (
                    <div className="space-y-2">
                      <Label>ID Proizvoda</Label>
                      <Input value={form.destinationProductId || ""} onChange={e => setForm({ ...form, destinationProductId: e.target.value })} placeholder="uuid" />
                    </div>
                  )}
                  {form.destinationKind === 'CATEGORY' && (
                    <div className="space-y-2">
                      <Label>ID Kategorije</Label>
                      <Input value={form.destinationCategoryId || ""} onChange={e => setForm({ ...form, destinationCategoryId: e.target.value })} placeholder="uuid" />
                    </div>
                  )}
                  {form.destinationKind === 'FILTERED_LISTING' && (
                    <div className="space-y-2">
                      <Label>Filter (JSON)</Label>
                      <Input value={form.filteredListing || ""} onChange={e => setForm({ ...form, filteredListing: e.target.value })} placeholder='{"brand": "Loreal"}' />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Prikaži od (opciono)</Label>
                <Input type="datetime-local" value={form.startsAt || ""} onChange={e => setForm({ ...form, startsAt: e.target.value || null })} />
              </div>
              <div className="space-y-2">
                <Label>Prikaži do (opciono)</Label>
                <Input type="datetime-local" value={form.endsAt || ""} onChange={e => setForm({ ...form, endsAt: e.target.value || null })} />
              </div>

              <div className="space-y-2 sm:col-span-2 flex items-center gap-2 mt-2">
                <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                <Label className="cursor-pointer" onClick={() => setForm({ ...form, active: !form.active })}>Aktivno</Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Otkaži</Button>
              <Button onClick={handleSave} disabled={createReq.isPending || updateReq.isPending}>
                {(createReq.isPending || updateReq.isPending) ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                Sačuvaj
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </AdminLayout>
  );
}
