import { useState, useMemo } from "react";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Plus, Edit2, Trash2, Search, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminListServiceTemplates,
  useAdminCreateServiceTemplate,
  useAdminUpdateServiceTemplate,
  useAdminDeleteServiceTemplate,
  getAdminListServiceTemplatesQueryKey,
} from "@workspace/api-client-react";

// Local types until the client is updated
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

interface ServiceTemplateFormDraft {
  name: string;
  mainCategory: string;
  subcategory: string;
  typicalDurationMinutes: string;
  priceMin: string;
  priceMax: string;
  description: string;
  active: boolean;
}

const emptyForm: ServiceTemplateFormDraft = {
  name: "",
  mainCategory: "",
  subcategory: "",
  typicalDurationMinutes: "",
  priceMin: "",
  priceMax: "",
  description: "",
  active: true,
};

export default function AdminServiceTemplates() {
  const { data: templates = [], isLoading, error } = useAdminListServiceTemplates();
  const createTemplate = useAdminCreateServiceTemplate();
  const updateTemplate = useAdminUpdateServiceTemplate();
  const deleteTemplate = useAdminDeleteServiceTemplate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceTemplate | null>(null);
  const [form, setForm] = useState<ServiceTemplateFormDraft>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<ServiceTemplate | null>(null);

  const invalidate = () => {
    try { queryClient.invalidateQueries({ queryKey: getAdminListServiceTemplatesQueryKey() }); } catch {}
  };

  const filteredTemplates = useMemo(() => {
    if (!Array.isArray(templates)) return [];
    return templates.filter((t: ServiceTemplate) => 
      (category === "all" || t.mainCategory === category) && (
        t.name.toLowerCase().includes(search.toLowerCase()) || 
        t.mainCategory.toLowerCase().includes(search.toLowerCase())
      )
    );
  }, [templates, search, category]);

  const categories = useMemo(() => [...new Set((templates as ServiceTemplate[]).map((item) => item.mainCategory))].sort(), [templates]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setModalOpen(true);
  };

  const openEdit = (t: ServiceTemplate) => {
    setEditing(t);
    setForm({
      name: t.name,
      mainCategory: t.mainCategory,
      subcategory: t.subcategory,
      typicalDurationMinutes: String(t.typicalDurationMinutes),
      priceMin: String(t.priceMin),
      priceMax: String(t.priceMax),
      description: t.description || "",
      active: t.active,
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    const name = form.name.trim();
    const mainCategory = form.mainCategory.trim();
    if (!name) { toast.error("Greška", { description: "Naziv je obavezan." }); return; }
    if (!mainCategory) { toast.error("Greška", { description: "Glavna kategorija je obavezna." }); return; }
    const duration = Number(form.typicalDurationMinutes);
    if (form.typicalDurationMinutes === "" || !Number.isFinite(duration) || duration < 5) {
      toast.error("Greška", { description: "Trajanje mora biti najmanje 5 minuta." }); return;
    }
    const priceMin = form.priceMin === "" ? NaN : Number(form.priceMin);
    const priceMax = form.priceMax === "" ? NaN : Number(form.priceMax);
    if (!Number.isFinite(priceMin) || priceMin < 0) { toast.error("Greška", { description: "Minimalna cena nije validna (unesite 0 ili više)." }); return; }
    if (!Number.isFinite(priceMax) || priceMax < 0) { toast.error("Greška", { description: "Maksimalna cena nije validna (unesite 0 ili više)." }); return; }
    if (priceMax > 0 && priceMin > priceMax) { toast.error("Greška", { description: "Minimalna cena ne može biti veća od maksimalne." }); return; }

    const payload = {
      name,
      mainCategory,
      subcategory: form.subcategory.trim(),
      typicalDurationMinutes: Math.round(duration),
      priceMin: Math.round(priceMin),
      priceMax: Math.round(priceMax),
      description: form.description.trim() || null,
      active: form.active,
    };
    
    const opts = {
      onSuccess: () => {
        toast.success(editing ? "Sačuvano" : "Kreirano", { description: `Predložak je uspešno ${editing ? "ažuriran" : "kreiran"}.` });
        invalidate();
        setModalOpen(false);
      },
      onError: (err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast.error("Greška", { description: msg ?? "Pokušajte ponovo." });
      },
    };

    if (editing) {
      updateTemplate.mutate({ templateId: editing.id, data: payload as any }, opts);
    } else {
      createTemplate.mutate({ data: payload as any }, opts);
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteTemplate.mutate({ templateId: deleteTarget.id }, {
      onSuccess: () => {
        toast.success("Obrisano", { description: "Predložak je uklonjen." });
        invalidate();
        setDeleteTarget(null);
      },
      onError: () => {
        toast.error("Greška", { description: "Nije moguće obrisati predložak." });
        setDeleteTarget(null);
      },
    });
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">Predlošci usluga</h1>
            <p className="text-muted-foreground text-sm">Centralna biblioteka usluga za lakše dodavanje u salonima.</p>
          </div>
          <Button onClick={openNew} className="shrink-0 gap-2">
            <Plus className="w-4 h-4" /> Novi predložak
          </Button>
        </div>

        <div className="bg-card rounded-xl border shadow-sm p-4 flex gap-4 items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Pretraži predloške..." 
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
          <Badge variant="secondary" className="hidden sm:flex">{filteredTemplates.length} ukupno</Badge>
        </div>

        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">Došlo je do greške pri učitavanju predložaka.</div>
          ) : filteredTemplates.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-muted-foreground">
              <FileText className="w-12 h-12 mb-4 opacity-20" />
              <p>Nema pronađenih predložaka.</p>
              {search && <Button variant="link" onClick={() => setSearch("")}>Poništi pretragu</Button>}
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {filteredTemplates.map((t: ServiceTemplate) => (
                <div key={t.id} className={`flex items-center gap-4 px-4 py-4 hover:bg-muted/10 transition-colors ${!t.active ? "opacity-60" : ""}`}>
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-primary shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold line-clamp-1 text-foreground">{t.name}</p>
                      {!t.active && <Badge variant="secondary" className="text-[10px]">Neaktivan</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{t.mainCategory} {t.subcategory ? `> ${t.subcategory}` : ""}</p>
                  </div>
                  <div className="hidden sm:block text-sm text-right shrink-0">
                    <p className="font-medium text-foreground">{t.priceMin} - {t.priceMax} RSD</p>
                    <p className="text-muted-foreground">~{t.typicalDurationMinutes} min</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-4">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(t)}>
                      <Edit2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => setDeleteTarget(t)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md custom-scrollbar max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Izmeni predložak" : "Novi predložak"}</DialogTitle>
            <DialogDescription>
              Ovaj predložak će biti dostupan salonima u biblioteci usluga.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Naziv usluge *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="npr. Klasično šišanje" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Glavna kategorija *</Label>
                <Input value={form.mainCategory} onChange={(e) => setForm({ ...form, mainCategory: e.target.value })} placeholder="npr. Kosa" />
              </div>
              <div className="space-y-2">
                <Label>Podkategorija (opciono)</Label>
                <Input value={form.subcategory} onChange={(e) => setForm({ ...form, subcategory: e.target.value })} placeholder="npr. Šišanje" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Tipično trajanje (min)</Label>
              <Input type="number" min="5" step="5" value={form.typicalDurationMinutes} onChange={(e) => setForm({ ...form, typicalDurationMinutes: e.target.value })} placeholder="npr. 30" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min. cena (RSD)</Label>
                <Input type="number" min="0" value={form.priceMin} onChange={(e) => setForm({ ...form, priceMin: e.target.value })} placeholder="npr. 1000" />
              </div>
              <div className="space-y-2">
                <Label>Max. cena (RSD)</Label>
                <Input type="number" min="0" value={form.priceMax} onChange={(e) => setForm({ ...form, priceMax: e.target.value })} placeholder="npr. 2000" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Opis usluge (opciono)</Label>
              <Textarea 
                value={form.description} 
                onChange={(e) => setForm({ ...form, description: e.target.value })} 
                placeholder="Kratak opis koji saloni mogu preuzeti..."
                className="resize-none"
                rows={3}
              />
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <Label className="cursor-pointer">Predložak je aktivan</Label>
              <Switch checked={form.active} onCheckedChange={(c) => setForm({ ...form, active: c })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Odustani</Button>
            <Button onClick={handleSave} disabled={createTemplate?.isPending || updateTemplate?.isPending}>
              {(createTemplate?.isPending || updateTemplate?.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Obriši predložak?</DialogTitle>
            <DialogDescription>
              Da li ste sigurni da želite da obrišete predložak „{deleteTarget?.name}“? Saloni koji su već preuzeli ovaj predložak neće biti pogođeni.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Odustani</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteTemplate?.isPending}>
              {deleteTemplate?.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Obriši
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}