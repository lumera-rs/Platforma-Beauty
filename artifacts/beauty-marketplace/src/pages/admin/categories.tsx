import { useState } from "react";
import { AdminLayout } from "./layout";
import {
  useAdminListProductCategories,
  useAdminCreateProductCategory,
  useAdminUpdateProductCategory,
  useAdminDeleteProductCategory,
  getAdminListProductCategoriesQueryKey,
} from "@workspace/api-client-react";
import type { AdminProductCategory, AdminProductCategoryInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Edit2, Trash2, FolderTree, ArrowUp, ArrowDown, CornerDownRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const emptyForm: AdminProductCategoryInput = { name: "", parentId: null, sortOrder: 0, icon: null, imageUrl: null, active: true };

export default function AdminCategories() {
  const { data: categories = [], isLoading, error } = useAdminListProductCategories();
  const createCategory = useAdminCreateProductCategory();
  const updateCategory = useAdminUpdateProductCategory();
  const deleteCategory = useAdminDeleteProductCategory();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProductCategory | null>(null);
  const [form, setForm] = useState<AdminProductCategoryInput>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<AdminProductCategory | null>(null);

  const parents = categories.filter((c) => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getAdminListProductCategoriesQueryKey() });

  const openNew = (parentId: string | null = null) => {
    setEditing(null);
    const siblings = parentId ? childrenOf(parentId) : parents;
    setForm({ ...emptyForm, parentId, sortOrder: siblings.length + 1 });
    setModalOpen(true);
  };

  const openEdit = (cat: AdminProductCategory) => {
    setEditing(cat);
    setForm({
      name: cat.name,
      parentId: cat.parentId ?? null,
      sortOrder: cat.sortOrder,
      icon: cat.icon ?? null,
      imageUrl: cat.imageUrl ?? null,
      active: cat.active,
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast.error("Greška", { description: "Naziv je obavezan." }); return; }
    const opts = {
      onSuccess: () => {
        toast.success(editing ? "Sačuvano" : "Kreirano", { description: `Kategorija je uspešno ${editing ? "ažurirana" : "kreirana"}.` });
        invalidate();
        setModalOpen(false);
      },
      onError: (err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast.error("Greška", { description: msg ?? "Kategorija nije sačuvana." });
      },
    };
    if (editing) updateCategory.mutate({ categoryId: editing.id, data: form }, opts);
    else createCategory.mutate({ data: form }, opts);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteCategory.mutate({ categoryId: deleteTarget.id }, {
      onSuccess: () => {
        toast.success("Obrisano", { description: "Kategorija je uklonjena." });
        invalidate();
        setDeleteTarget(null);
      },
      onError: (err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast.error("Nije moguće obrisati", { description: msg ?? "Kategorija nije obrisana." });
        setDeleteTarget(null);
      },
    });
  };

  const move = (cat: AdminProductCategory, dir: -1 | 1) => {
    const siblings = cat.parentId ? childrenOf(cat.parentId) : parents;
    const idx = siblings.findIndex((s) => s.id === cat.id);
    const swap = siblings[idx + dir];
    if (!swap) return;
    Promise.all([
      updateCategory.mutateAsync({ categoryId: cat.id, data: { sortOrder: swap.sortOrder } }),
      updateCategory.mutateAsync({ categoryId: swap.id, data: { sortOrder: cat.sortOrder } }),
    ])
      .then(() => invalidate())
      .catch(() => toast.error("Greška", { description: "Redosled nije promenjen." }));
  };

  const CategoryRow = ({ cat, isChild }: { cat: AdminProductCategory; isChild: boolean }) => (
    <div className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/10 transition-colors ${!cat.active ? "opacity-50" : ""} ${isChild ? "pl-12" : ""}`} data-testid={`category-row-${cat.id}`}>
      {isChild && <CornerDownRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      {cat.imageUrl ? (
        <img src={cat.imageUrl} alt="" className="w-8 h-8 rounded-lg object-cover border shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-xs shrink-0">{cat.icon ?? (isChild ? "•" : "▣")}</div>
      )}
      <div className="flex-1 min-w-0">
        <p className={`${isChild ? "text-sm" : "font-semibold"} line-clamp-1`}>{cat.name}</p>
        <p className="text-xs text-muted-foreground">{cat.productCount} proizvoda{!cat.active ? " · neaktivna" : ""}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => move(cat, -1)} title="Pomeri gore">
          <ArrowUp className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => move(cat, 1)} title="Pomeri dole">
          <ArrowDown className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
        {!isChild && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => openNew(cat.id)} data-testid={`btn-add-sub-${cat.id}`}>
            <Plus className="w-3 h-3 mr-0.5" /> Podkat.
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(cat)} data-testid={`btn-edit-category-${cat.id}`}>
          <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => setDeleteTarget(cat)} data-testid={`btn-delete-category-${cat.id}`}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">Kategorije proizvoda</h1>
            <p className="text-muted-foreground text-sm">Glavne kategorije i podkategorije B2B shopa. Redosled određuje prikaz u shopu.</p>
          </div>
          <Button onClick={() => openNew(null)} className="shrink-0 gap-2" data-testid="btn-new-category">
            <Plus className="w-4 h-4" /> Nova kategorija
          </Button>
        </div>

        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">Došlo je do greške pri učitavanju kategorija.</div>
          ) : parents.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-muted-foreground">
              <FolderTree className="w-12 h-12 mb-4 opacity-20" />
              <p>Nema kreiranih kategorija.</p>
              <Button variant="outline" className="mt-4" onClick={() => openNew(null)}>Kreiraj prvu kategoriju</Button>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {parents.map((parent) => (
                <div key={parent.id}>
                  <CategoryRow cat={parent} isChild={false} />
                  {childrenOf(parent.id).map((child) => (
                    <CategoryRow key={child.id} cat={child} isChild />
                  ))}
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
            <DialogTitle>{editing ? "Izmeni kategoriju" : form.parentId ? "Nova podkategorija" : "Nova kategorija"}</DialogTitle>
            <DialogDescription>
              {form.parentId
                ? `Podkategorija unutar: ${parents.find((p) => p.id === form.parentId)?.name ?? ""}`
                : "Glavna kategorija u B2B shopu."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Naziv *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="npr. KOSA" data-testid="input-category-name" />
            </div>
            <div className="space-y-2">
              <Label>Pripada kategoriji</Label>
              <Select
                value={form.parentId ?? "__root__"}
                onValueChange={(v) => setForm({ ...form, parentId: v === "__root__" ? null : v })}
                disabled={!!editing && categories.some((c) => c.parentId === editing.id)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">Glavna kategorija (bez nadređene)</SelectItem>
                  {parents.filter((p) => p.id !== editing?.id).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Redosled</Label>
                <Input type="number" min="0" value={form.sortOrder ?? 0} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Ikonica (emoji, opciono)</Label>
                <Input value={form.icon ?? ""} onChange={(e) => setForm({ ...form, icon: e.target.value || null })} placeholder="💇" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Slika (URL, opciono)</Label>
              <Input value={form.imageUrl ?? ""} onChange={(e) => setForm({ ...form, imageUrl: e.target.value || null })} placeholder="/lumera-media/..." />
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <Label className="cursor-pointer">Kategorija je aktivna</Label>
              <Switch checked={form.active ?? true} onCheckedChange={(c) => setForm({ ...form, active: c })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Odustani</Button>
            <Button onClick={handleSave} disabled={createCategory.isPending || updateCategory.isPending} data-testid="btn-save-category">
              {(createCategory.isPending || updateCategory.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Obriši kategoriju?</DialogTitle>
            <DialogDescription>
              „{deleteTarget?.name}" će biti obrisana. Kategorije sa proizvodima ili podkategorijama nije moguće obrisati dok se sadržaj ne premesti.
              {deleteTarget && deleteTarget.productCount > 0 && (
                <span className="block mt-2 text-destructive font-medium">Ova kategorija sadrži {deleteTarget.productCount} proizvoda.</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Odustani</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteCategory.isPending} data-testid="btn-confirm-delete-category">
              {deleteCategory.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Obriši
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inactive badge legend */}
      {categories.some((c) => !c.active) && (
        <p className="mt-4 text-xs text-muted-foreground flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">Neaktivna</Badge> kategorije se ne prikazuju u B2B shopu.
        </p>
      )}
    </AdminLayout>
  );
}
