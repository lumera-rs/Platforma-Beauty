import { useState } from "react";
import { AdminLayout } from "./layout";
import { useDebounce } from "@/hooks/use-debounce";
import { extractApiError } from "@/lib/admin-form-utils";
import { OptimizedImage } from "@/components/optimized-image";
import {
  useAdminListBrands,
  useAdminCreateBrand,
  useAdminUpdateBrand,
  useAdminDeleteBrand,
  getAdminListBrandsQueryKey,
} from "@workspace/api-client-react";
import type { AdminBrand, AdminBrandInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Plus, Edit2, Trash2, Tags, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const emptyForm: AdminBrandInput = { name: "", description: "", logoUrl: null, active: true };

export default function AdminBrands() {
  const { data: brands = [], isLoading, error } = useAdminListBrands();
  const createBrand = useAdminCreateBrand();
  const updateBrand = useAdminUpdateBrand();
  const deleteBrand = useAdminDeleteBrand();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  // Debounce the value driving the client-side filter so typing stays smooth
  // while the input itself updates immediately.
  const debouncedSearch = useDebounce(search, 300);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminBrand | null>(null);
  const [form, setForm] = useState<AdminBrandInput>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<AdminBrand | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getAdminListBrandsQueryKey() });

  const filtered = brands.filter((b) => !debouncedSearch || b.name.toLowerCase().includes(debouncedSearch.toLowerCase()));

  const openNew = () => { setEditing(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (brand: AdminBrand) => {
    setEditing(brand);
    setForm({ name: brand.name, description: brand.description, logoUrl: brand.logoUrl ?? null, active: brand.active });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast.error("Greška", { description: "Naziv je obavezan." }); return; }
    if (createBrand.isPending || updateBrand.isPending) return;
    const opts = {
      onSuccess: () => {
        toast.success(editing ? "Sačuvano" : "Kreirano", { description: `Brend je uspešno ${editing ? "ažuriran" : "kreiran"}.` });
        invalidate();
        setModalOpen(false);
      },
      onError: (err: unknown) => {
        toast.error("Greška", { description: extractApiError(err, "Brend nije sačuvan.") });
      },
    };
    if (editing) updateBrand.mutate({ brandId: editing.id, data: form }, opts);
    else createBrand.mutate({ data: form }, opts);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteBrand.mutate({ brandId: deleteTarget.id }, {
      onSuccess: (result) => {
        toast.success(result.active ? "Deaktivirano" : "Obrisano", {
          description: result.active === false && result.productCount === 0
            ? "Brend je obrisan."
            : "Brend je deaktiviran jer je povezan sa proizvodima ili salonima.",
        });
        invalidate();
        setDeleteTarget(null);
      },
      onError: () => toast.error("Greška", { description: "Brend nije obrisan." }),
    });
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">Brendovi</h1>
            <p className="text-muted-foreground text-sm">Brendovi profesionalnih proizvoda u B2B shopu.</p>
          </div>
          <Button onClick={openNew} className="shrink-0 gap-2" data-testid="btn-new-brand">
            <Plus className="w-4 h-4" /> Novi brend
          </Button>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Pretraži brendove..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-brands" />
        </div>

        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">Došlo je do greške pri učitavanju brendova.</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-muted-foreground">
              <Tags className="w-12 h-12 mb-4 opacity-20" />
              <p>{search ? "Nema brendova za ovu pretragu." : "Nema kreiranih brendova."}</p>
              {!search && <Button variant="outline" className="mt-4" onClick={openNew}>Kreiraj prvi brend</Button>}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-border/50">
              {filtered.map((brand) => (
                <div key={brand.id} className={`bg-card p-5 flex flex-col gap-3 ${!brand.active ? "opacity-50" : ""}`} data-testid={`brand-card-${brand.id}`}>
                  <div className="flex items-center gap-3">
                    {brand.logoUrl ? (
                      <OptimizedImage src={brand.logoUrl} alt="" width={48} height={48} className="w-12 h-12 rounded-xl object-cover border shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center font-bold text-muted-foreground shrink-0">
                        {brand.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold line-clamp-1 flex items-center gap-2">
                        {brand.name}
                        {!brand.active && <Badge variant="secondary" className="text-[10px]">Neaktivan</Badge>}
                      </h3>
                      <p className="text-xs text-muted-foreground">{brand.productCount} proizvoda</p>
                    </div>
                  </div>
                  {brand.description && <p className="text-sm text-muted-foreground line-clamp-2">{brand.description}</p>}
                  <div className="flex gap-2 mt-auto pt-1">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(brand)} data-testid={`btn-edit-brand-${brand.id}`}>
                      <Edit2 className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" /> Izmeni
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteTarget(brand)} data-testid={`btn-delete-brand-${brand.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create / edit */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Izmeni brend" : "Novi brend"}</DialogTitle>
            <DialogDescription>Brend se prikazuje uz proizvode u B2B shopu i u javnom imeniku brendova.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Naziv *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="npr. Wella Professionals" data-testid="input-brand-name" />
            </div>
            <div className="space-y-2">
              <Label>Kratak opis</Label>
              <textarea
                className="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={form.description ?? ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Kratak opis brenda..."
              />
            </div>
            <div className="space-y-2">
              <Label>Logo (URL, opciono)</Label>
              <Input value={form.logoUrl ?? ""} onChange={(e) => setForm({ ...form, logoUrl: e.target.value || null })} placeholder="/lumera-media/..." />
              {form.logoUrl && <OptimizedImage src={form.logoUrl} alt="" width={64} height={64} className="w-16 h-16 rounded-xl object-cover border mt-1" />}
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <Label className="cursor-pointer">Brend je aktivan</Label>
              <Switch checked={form.active ?? true} onCheckedChange={(c) => setForm({ ...form, active: c })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Odustani</Button>
            <Button onClick={handleSave} disabled={createBrand.isPending || updateBrand.isPending} data-testid="btn-save-brand">
              {(createBrand.isPending || updateBrand.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Obriši brend?</DialogTitle>
            <DialogDescription>
              „{deleteTarget?.name}" će biti obrisan. Ako je povezan sa proizvodima ili salonima, biće samo deaktiviran kako bi postojeće veze ostale netaknute.
              {deleteTarget && deleteTarget.productCount > 0 && (
                <span className="block mt-2 text-destructive font-medium">Ovaj brend je povezan sa {deleteTarget.productCount} proizvoda.</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Odustani</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteBrand.isPending} data-testid="btn-confirm-delete-brand">
              {deleteBrand.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Obriši
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
