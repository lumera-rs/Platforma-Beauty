import { useState, useMemo } from "react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { 
  useListSalonServices, 
  useCreateSalonService, 
  useUpdateSalonService, 
  useDeleteSalonService,
  useGetCurrentUser, 
  getListSalonServicesQueryKey,
  useListServiceTemplates,
  useCreateSalonServicesBatch,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Trash2, Loader2, Image as ImageIcon, House, Library, Search, FileText, Check, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ServiceTemplate {
  id: string;
  name: string;
  mainCategory: string;
  subcategory: string;
  typicalDurationMinutes: number;
  priceMin: number;
  priceMax: number;
  description: string | null;
  active: boolean;
}

function TemplateLibrary({ onBatchCreated }: { onBatchCreated: () => void }) {
  const { data: templates = [], isLoading } = useListServiceTemplates();
  const createBatch = useCreateSalonServicesBatch();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [configOpen, setConfigOpen] = useState(false);
  const [configs, setConfigs] = useState<Record<string, { price: string; duration: string }>>({});

  const activeTemplates = useMemo(() => {
    if (!Array.isArray(templates)) return [];
    return templates.filter((t: ServiceTemplate) => t.active);
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    return activeTemplates.filter(t => 
      (category === "all" || t.mainCategory === category) && (
        t.name.toLowerCase().includes(search.toLowerCase()) || 
        t.mainCategory.toLowerCase().includes(search.toLowerCase()) ||
        (t.subcategory && t.subcategory.toLowerCase().includes(search.toLowerCase()))
      )
    );
  }, [activeTemplates, search, category]);

  const categories = useMemo(() => [...new Set(activeTemplates.map((t: ServiceTemplate) => t.mainCategory))].sort(), [activeTemplates]);

  const toggleSelection = (t: ServiceTemplate) => {
    const next = new Set(selectedIds);
    if (next.has(t.id)) {
      next.delete(t.id);
      const nextConfigs = { ...configs };
      delete nextConfigs[t.id];
      setConfigs(nextConfigs);
    } else {
      next.add(t.id);
      setConfigs(prev => ({
        ...prev,
        [t.id]: { price: "", duration: t.typicalDurationMinutes.toString() }
      }));
    }
    setSelectedIds(next);
  };

  const handleBatchSubmit = () => {
    const items = Array.from(selectedIds).map(id => {
      const conf = configs[id];
      return {
        templateId: id,
        price: Number(conf.price),
        durationMinutes: Number(conf.duration)
      };
    });

    if (items.some(i => !i.price || i.price <= 0)) {
      toast.error("Greška", { description: "Unesite validnu cenu za sve izabrane usluge." });
      return;
    }

    createBatch.mutate({ data: { items } } as any, {
      onSuccess: () => {
        toast.success("Usluge dodate", { description: `Uspešno ste dodali ${items.length} novih usluga.` });
        setSelectedIds(new Set());
        setConfigs({});
        setConfigOpen(false);
        onBatchCreated();
      },
      onError: () => {
        toast.error("Greška", { description: "Došlo je do greške pri dodavanju usluga." });
      }
    });
  };

  const selectedTemplates = activeTemplates.filter(t => selectedIds.has(t.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-card p-4 rounded-xl border shadow-sm">
        <div className="relative flex-1 w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Pretraži biblioteku šablona..." 
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Filtriraj po kategoriji"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          <option value="all">Sve kategorije</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        {selectedIds.size > 0 && (
          <Button onClick={() => setConfigOpen(true)} className="w-full sm:w-auto animate-in fade-in zoom-in duration-200">
            Konfiguriši i dodaj ({selectedIds.size})
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : filteredTemplates.length === 0 ? (
        <div className="p-12 text-center border rounded-xl bg-card text-muted-foreground">
          <Library className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p>Nema pronađenih šablona.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map(t => {
            const isSelected = selectedIds.has(t.id);
            return (
              <div 
                key={t.id} 
                onClick={() => toggleSelection(t)}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  isSelected 
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20" 
                    : "bg-card hover:border-primary/50 hover:shadow-sm"
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1 pr-2">
                    <h3 className="font-semibold text-foreground line-clamp-1">{t.name}</h3>
                    <p className="text-xs text-muted-foreground">{t.mainCategory}{t.subcategory ? ` • ${t.subcategory}` : ""}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${isSelected ? 'bg-primary border-primary' : 'border-input'}`}>
                    {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                  </div>
                </div>
                {t.description && <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{t.description}</p>}
                <div className="mt-auto pt-3 border-t flex justify-between text-sm">
                  <span className="font-medium text-foreground">{t.priceMin} - {t.priceMax} RSD</span>
                  <span className="text-muted-foreground">{t.typicalDurationMinutes} min</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Konfiguracija izabranih usluga</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Unesite cenu i prilagodite trajanje za usluge koje dodajete u svoj cenovnik.
            </p>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto pr-2 space-y-4 py-4 custom-scrollbar">
            {selectedTemplates.map(t => (
              <div key={t.id} className="p-4 rounded-lg border bg-card space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold">{t.name}</h4>
                    <p className="text-xs text-muted-foreground">Preporučena cena: {t.priceMin} - {t.priceMax} RSD</p>
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => toggleSelection(t)}>
                    Ukloni
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Vaša cena (RSD) *</Label>
                    <Input 
                      type="number" 
                      min="0"
                      value={configs[t.id]?.price || ""}
                      onChange={(e) => setConfigs(prev => ({ ...prev, [t.id]: { ...prev[t.id], price: e.target.value } }))}
                      placeholder="Unesite cenu..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Trajanje (min) *</Label>
                    <Input 
                      type="number" 
                      min="5"
                      step="5"
                      value={configs[t.id]?.duration || ""}
                      onChange={(e) => setConfigs(prev => ({ ...prev, [t.id]: { ...prev[t.id], duration: e.target.value } }))}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter className="border-t pt-4 mt-auto">
            <Button variant="outline" onClick={() => setConfigOpen(false)}>Nazad</Button>
            <Button onClick={handleBatchSubmit} disabled={createBatch?.isPending}>
              {createBatch?.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Dodaj usluge ({selectedIds.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function OwnerServices() {
  const { data: userResp } = useGetCurrentUser();
  const { data: services, isLoading, refetch } = useListSalonServices({ query: { enabled: !!userResp?.user, queryKey: getListSalonServicesQueryKey() }});
  const createMutation = useCreateSalonService();
  const updateMutation = useUpdateSalonService();
  const deleteMutation = useDeleteSalonService();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("my-services");
  const [deleteTarget, setDeleteTarget] = useState<NonNullable<typeof services>[number] | null>(null);
  
  const activeHomeServiceCount = services?.filter((service) => service.active && service.homeServiceAvailable).length ?? 0;

  const [formData, setFormData] = useState({
    name: "",
    category: "Frizura",
    durationMinutes: 30,
    price: 1500,
    description: "",
    imageUrl: "https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=200",
    active: true, homeServiceAvailable: false, homeServiceFee: 0, homeServiceMinimumOrder: ""
  });

  const resetForm = () => {
    setEditingId(null);
    setFormData({ name: "", category: "Frizura", durationMinutes: 30, price: 1500, description: "", imageUrl: "https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=200", active: true, homeServiceAvailable: false, homeServiceFee: 0, homeServiceMinimumOrder: "" });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...formData,
      durationMinutes: Number(formData.durationMinutes),
      price: Number(formData.price),
      homeServiceFee: formData.homeServiceAvailable ? Number(formData.homeServiceFee) : 0,
      homeServiceMinimumOrder: formData.homeServiceAvailable && formData.homeServiceMinimumOrder !== "" ? Number(formData.homeServiceMinimumOrder) : null,
    };
    const callbacks = {
      onSuccess: () => {
        toast.success(editingId ? "Usluga izmenjena" : "Usluga dodata");
        setOpen(false);
        resetForm();
        refetch();
      }
    };
    if (editingId) updateMutation.mutate({ serviceId: editingId, data: payload }, callbacks);
    else createMutation.mutate({ data: payload }, callbacks);
  };

  const editService = (service: NonNullable<typeof services>[number]) => {
    setEditingId(service.id);
    setFormData({ name: service.name, category: service.category, durationMinutes: service.durationMinutes, price: service.price, description: service.description, imageUrl: service.imageUrl, active: service.active, homeServiceAvailable: service.homeServiceAvailable, homeServiceFee: service.homeServiceFee, homeServiceMinimumOrder: service.homeServiceMinimumOrder?.toString() ?? "" });
    setOpen(true);
  };

  const handleBatchCreated = () => {
    refetch();
    setActiveTab("my-services");
  };

  const handleDelete = () => {
    if (!deleteTarget || !deleteTarget.canBePermanentlyDeleted) return;
    deleteMutation.mutate({ serviceId: deleteTarget.id }, {
      onSuccess: () => {
        toast.success("Usluga obrisana", { description: "Usluga je trajno uklonjena sa cenovnika i javnog profila." });
        setDeleteTarget(null);
        refetch();
      },
      onError: (error) => {
        const message = error instanceof Error
          ? error.message.replace(/^HTTP \d+[^:]*:\s*/, "")
          : "Brisanje usluge nije uspelo. Pokušajte ponovo.";
        toast.error("Brisanje nije uspelo", { description: message });
        setDeleteTarget(null);
      },
    });
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/usluge" />
        
        <div className="flex-1 space-y-6 w-full min-w-0">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">Usluge salona</h1>
            <p className="text-muted-foreground mt-1">Upravljajte tretmanima i cenovnikom</p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <TabsList className="bg-muted/50 p-1">
                <TabsTrigger value="my-services" className="data-[state=active]:bg-background data-[state=active]:shadow-sm">Moje usluge</TabsTrigger>
                <TabsTrigger value="library" className="data-[state=active]:bg-background data-[state=active]:shadow-sm flex items-center gap-1.5">
                  <Library className="w-3.5 h-3.5" /> Biblioteka šablona
                </TabsTrigger>
              </TabsList>

              {activeTab === "my-services" && (
                <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) resetForm(); }}>
                  <DialogTrigger asChild>
                    <Button onClick={resetForm}><Plus className="w-4 h-4 mr-2" /> Nova usluga ručno</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto custom-scrollbar">
                    <DialogHeader>
                      <DialogTitle>{editingId ? "Izmeni uslugu" : "Nova usluga"}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label>Naziv usluge</Label>
                        <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Trajanje (min)</Label>
                          <Input type="number" value={formData.durationMinutes} onChange={e => setFormData({...formData, durationMinutes: Number(e.target.value)})} required min="5" step="5" />
                        </div>
                        <div className="space-y-2">
                          <Label>Cena (RSD)</Label>
                          <Input type="number" value={formData.price} onChange={e => setFormData({...formData, price: Number(e.target.value)})} required min="0" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Kategorija</Label>
                        <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                          <option>Frizura</option>
                          <option>Kozmetika</option>
                          <option>Masaža</option>
                          <option>Nokti</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label>Kratak opis</Label>
                        <Input value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <Label className="cursor-pointer">Usluga je aktivna</Label>
                        <Switch checked={formData.active} onCheckedChange={(checked) => setFormData({ ...formData, active: checked })} />
                      </div>
                      <div className="rounded-xl border bg-muted/30 p-4 space-y-3 mt-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <Label className="flex items-center gap-2"><House className="h-4 w-4 text-primary" /> Dolazak na adresu</Label>
                            <p className="mt-1 text-xs text-muted-foreground">Omogućite samo za ovu uslugu.</p>
                          </div>
                          <Switch checked={formData.homeServiceAvailable} onCheckedChange={(checked) => setFormData({ ...formData, homeServiceAvailable: checked })} />
                        </div>
                        {formData.homeServiceAvailable && (
                          <div className="grid grid-cols-2 gap-3 pt-2">
                            <div className="space-y-1.5"><Label className="text-xs">Naknada za dolazak (RSD)</Label><Input type="number" min="0" value={formData.homeServiceFee} onChange={e => setFormData({ ...formData, homeServiceFee: Number(e.target.value) })} /></div>
                            <div className="space-y-1.5"><Label className="text-xs">Minimum usluge (opciono)</Label><Input type="number" min="0" placeholder="Bez minimuma" value={formData.homeServiceMinimumOrder} onChange={e => setFormData({ ...formData, homeServiceMinimumOrder: e.target.value })} /></div>
                          </div>
                        )}
                      </div>
                      <Button type="submit" className="w-full mt-6" disabled={createMutation.isPending || updateMutation.isPending}>
                        {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        {editingId ? "Sačuvaj izmene" : "Sačuvaj"}
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>
              )}
            </div>

            <TabsContent value="my-services" className="space-y-6 mt-0">
              <div data-testid="home-service-availability" className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
                <House className="h-4 w-4 shrink-0 text-primary" />
                {activeHomeServiceCount > 0
                  ? <span>Dolazak na adresu je dostupan za {activeHomeServiceCount} {activeHomeServiceCount === 1 ? "aktivnu uslugu" : "aktivne usluge"} i automatski se prikazuje na profilu salona.</span>
                  : <span>Dolazak na adresu nije dostupan ni za jednu aktivnu uslugu i ne prikazuje se na profilu salona.</span>}
              </div>

              <Card>
                <div className="divide-y">
                  {isLoading ? (
                    <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /></div>
                  ) : services?.length === 0 ? (
                    <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
                      <FileText className="w-12 h-12 mb-4 opacity-20" />
                      <p>Još niste dodali nijednu uslugu.</p>
                      <Button variant="link" onClick={() => setActiveTab("library")} className="mt-2">Pregledajte biblioteku šablona</Button>
                    </div>
                  ) : services?.map(service => (
                    <div key={service.id} className={`p-4 sm:p-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between hover:bg-muted/10 transition-colors ${!service.active ? 'opacity-60 grayscale-[30%]' : ''}`}>
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden border">
                          {service.imageUrl ? <img src={service.imageUrl} className="w-full h-full object-cover" /> : <ImageIcon className="w-6 h-6 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h4 className="font-bold text-lg text-foreground truncate">{service.name}</h4>
                            {!service.active && <Badge variant="secondary" className="text-xs">Neaktivno</Badge>}
                            {service.active && service.homeServiceAvailable && <Badge className="text-[10px] gap-1 bg-primary/10 text-primary border-primary/20"><House className="h-3 w-3" /> Na adresi</Badge>}
                             {!service.canBePermanentlyDeleted && <Badge variant="secondary" className="text-[10px] gap-1"><AlertCircle className="h-3 w-3" /> Istorija termina</Badge>}
                          </div>
                          <p className="text-sm text-muted-foreground mb-1">{service.category} • {service.durationMinutes} min</p>
                          <div className="flex items-baseline gap-2">
                            <p className="font-semibold text-primary">{service.price} RSD</p>
                            {service.promoPrice && <p className="text-sm line-through text-muted-foreground">{service.promoPrice} RSD</p>}
                          </div>
                          {service.active && service.homeServiceAvailable && <p className="text-xs text-muted-foreground mt-1">Dolazak: {service.homeServiceFee} RSD{service.homeServiceMinimumOrder ? ` • min. ${service.homeServiceMinimumOrder} RSD` : ""}</p>}
                           {!service.canBePermanentlyDeleted && <p className="mt-1 text-xs text-muted-foreground">Ova usluga ostaje na cenovniku jer je povezana sa prethodnim terminima.</p>}
                        </div>
                      </div>
                      <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                        <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => editService(service)}><Edit2 className="w-4 h-4 mr-2" /> Izmeni</Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-destructive hover:bg-destructive/10 hover:text-destructive sm:flex-none"
                          aria-label={`Obriši uslugu ${service.name}`}
                          onClick={() => setDeleteTarget(service)}
                        >
                          <Trash2 className="w-4 h-4 mr-2" /> Obriši
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="library" className="mt-0">
              <TemplateLibrary onBatchCreated={handleBatchCreated} />
            </TabsContent>
          </Tabs>

          <AlertDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(nextOpen) => {
              if (!nextOpen && !deleteMutation.isPending) setDeleteTarget(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {deleteTarget?.canBePermanentlyDeleted ? "Trajno obrišite uslugu?" : "Uslugu nije moguće trajno obrisati"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {deleteTarget?.canBePermanentlyDeleted
                    ? <>Usluga „{deleteTarget?.name}“ biće trajno uklonjena sa cenovnika i javnog profila. Ovu radnju nije moguće poništiti.</>
                    : <>Usluga „{deleteTarget?.name}“ ima istoriju termina i mora ostati na cenovniku radi evidencije. Po potrebi je možete označiti kao neaktivnu, ali je nije moguće trajno obrisati.</>}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                {deleteTarget?.canBePermanentlyDeleted ? (
                  <>
                    <AlertDialogCancel disabled={deleteMutation.isPending}>Otkaži</AlertDialogCancel>
                    <AlertDialogAction asChild>
                      <Button variant="destructive" disabled={deleteMutation.isPending} onClick={handleDelete}>
                        {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Obriši uslugu
                      </Button>
                    </AlertDialogAction>
                  </>
                ) : (
                  <AlertDialogAction onClick={() => setDeleteTarget(null)}>Razumem</AlertDialogAction>
                )}
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </BusinessLayout>
  );
}