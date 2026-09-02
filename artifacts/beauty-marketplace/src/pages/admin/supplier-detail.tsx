import { useState, useMemo, ChangeEvent } from "react";
import { AdminLayout } from "./layout";
import { Link, useRoute } from "wouter";
import {
  useAdminGetSupplier,
  useAdminUpdateSupplier,
  SupplierUpdateScope,
  useAdminListProductCategories,
  useAdminCreateProductCategory,
  useAdminUpdateProductCategory,
  getAdminGetSupplierQueryKey,
  getAdminListProductCategoriesQueryKey,
} from "@workspace/api-client-react";
import type { AdminProductCategory, AdminProductCategoryInput, AdminProductCategoryUpdate } from "@workspace/api-client-react";
import { extractApiError, parseStrictInt } from "@/lib/admin-form-utils";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Edit2, ChevronLeft, ChevronRight, ChevronDown, FolderTree, Building2, ImagePlus, ArrowUp, ArrowDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { OptimizedImage } from "@/components/optimized-image";
import { uploadOptimizedImage } from "@/lib/media-upload";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

export default function AdminSupplierDetail() {
  const [, params] = useRoute("/admin/dobavljaci/:supplierId");
  const supplierId = params?.supplierId ?? "";

  const { data: supplier, isLoading: supplierLoading, error: supplierError } = useAdminGetSupplier(supplierId, { query: { enabled: !!supplierId, queryKey: getAdminGetSupplierQueryKey(supplierId) } });
  const updateSupplier = useAdminUpdateSupplier();

  const { data: allCategories = [], isLoading: categoriesLoading } = useAdminListProductCategories();
  const createCategory = useAdminCreateProductCategory();
  const updateCategory = useAdminUpdateProductCategory();

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();

  // Categories filtered by this supplier
  const supplierCategories = useMemo(() => allCategories.filter((c) => c.supplierId === supplierId), [allCategories, supplierId]);
  
  // Build category tree
  const { tree, flatSorted } = useMemo(() => {
    const map = new Map<string, AdminProductCategory & { children: any[] }>();
    supplierCategories.forEach(c => map.set(c.id, { ...c, children: [] }));
    const roots: (AdminProductCategory & { children: any[] })[] = [];
    
    // Sort all by sortOrder first
    const sorted = [...supplierCategories].sort((a, b) => a.sortOrder - b.sortOrder);
    
    sorted.forEach(c => {
      const node = map.get(c.id)!;
      if (c.parentId && map.has(c.parentId)) {
        map.get(c.parentId)!.children.push(node);
        // keep children sorted
        map.get(c.parentId)!.children.sort((a, b) => a.sortOrder - b.sortOrder);
      } else {
        roots.push(node);
      }
    });
    
    // Create a flat sorted array for the table/list representation
    const flat: (AdminProductCategory & { depth: number })[] = [];
    const traverse = (nodes: any[], depth: number) => {
      nodes.forEach(n => {
        flat.push({ ...n, depth });
        traverse(n.children, depth + 1);
      });
    };
    traverse(roots.sort((a, b) => a.sortOrder - b.sortOrder), 0);
    
    return { tree: roots, flatSorted: flat };
  }, [supplierCategories]);

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const toggleNode = (id: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // State
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: "", scope: "BOTH", active: true });
  const [logoUploading, setLogoUploading] = useState(false);
  
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryEditing, setCategoryEditing] = useState<AdminProductCategory | null>(null);
  const [categoryForm, setCategoryForm] = useState<AdminProductCategoryInput & { sortOrderRaw: string }>({ name: "", parentId: null, sortOrder: 0, sortOrderRaw: "0", icon: null, imageUrl: null, active: true });
  const [categoryImageUploading, setCategoryImageUploading] = useState(false);

  const [confirmStatusModal, setConfirmStatusModal] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<boolean>(false);

  const invalidateSupplier = () => queryClient.invalidateQueries({ queryKey: getAdminGetSupplierQueryKey(supplierId) });
  const invalidateCategories = () => queryClient.invalidateQueries({ queryKey: getAdminListProductCategoriesQueryKey() });

  const openProfileEdit = () => {
    if (!supplier) return;
    setProfileForm({ name: supplier.name, scope: supplier.scope, active: supplier.active });
    setProfileModalOpen(true);
  };

  const saveProfile = () => {
    if (!profileForm.name.trim()) return;
    if (!actionGuard.begin("save-profile")) return;
    updateSupplier.mutate(
      { supplierId, data: { name: profileForm.name, scope: profileForm.scope as any } },
      {
        onSuccess: () => {
          toast.success("Sačuvano", { description: "Profil dobavljača je ažuriran." });
          invalidateSupplier();
          setProfileModalOpen(false);
          actionGuard.end("save-profile");
        },
        onError: (err) => {
          toast.error("Greška", { description: extractApiError(err, "Profil nije sačuvan.") });
          actionGuard.end("save-profile");
        }
      }
    );
  };

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLogoUploading(true);
    try {
      const asset = await uploadOptimizedImage(file, "supplier", supplierId);
      await updateSupplier.mutateAsync({ supplierId, data: { logoUrl: asset.imageUrl } });
      invalidateSupplier();
      toast.success("Logo je ažuriran.");
    } catch (error) {
      toast.error("Greška", { description: error instanceof Error ? error.message : "Logo nije otpremljen." });
    } finally {
      setLogoUploading(false);
    }
  };

  const openStatusConfirm = (nextStatus: boolean) => {
    setPendingStatus(nextStatus);
    setConfirmStatusModal(true);
  };

  const confirmStatusChange = () => {
    if (!actionGuard.begin("status-change")) return;
    updateSupplier.mutate(
      { supplierId, data: { active: pendingStatus } },
      {
        onSuccess: () => {
          toast.success("Sačuvano", { description: `Dobavljač je sada ${pendingStatus ? 'aktivan' : 'neaktivan'}.` });
          invalidateSupplier();
          setConfirmStatusModal(false);
          actionGuard.end("status-change");
        },
        onError: (err) => {
          toast.error("Greška", { description: extractApiError(err, "Status nije promenjen.") });
          actionGuard.end("status-change");
        }
      }
    );
  };

  // Categories

  const openCategoryNew = (parentId: string | null = null) => {
    setCategoryEditing(null);
    const siblings = supplierCategories.filter(c => c.parentId === parentId);
    const sortOrder = siblings.length + 1;
    setCategoryForm({ name: "", parentId, sortOrder, sortOrderRaw: String(sortOrder), icon: null, imageUrl: null, active: true, supplierId });
    setCategoryModalOpen(true);
    if (parentId && !expandedNodes.has(parentId)) toggleNode(parentId);
  };

  const openCategoryEdit = (cat: AdminProductCategory) => {
    setCategoryEditing(cat);
    setCategoryForm({
      supplierId,
      name: cat.name,
      parentId: cat.parentId ?? null,
      sortOrder: cat.sortOrder,
      sortOrderRaw: String(cat.sortOrder),
      icon: cat.icon ?? null,
      imageUrl: cat.imageUrl ?? null,
      active: cat.active,
    });
    setCategoryModalOpen(true);
  };

  const uploadCategoryImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setCategoryImageUploading(true);
    try {
      const asset = await uploadOptimizedImage(file, "product-category", categoryEditing?.id);
      setCategoryForm((current) => ({ ...current, imageUrl: asset.imageUrl }));
      toast.success("Fotografija kategorije je obrađena.");
    } catch (error) {
      toast.error("Greška", { description: error instanceof Error ? error.message : "Pokušajte ponovo." });
    } finally {
      setCategoryImageUploading(false);
    }
  };

  const saveCategory = () => {
    if (!categoryForm.name.trim()) { toast.error("Greška", { description: "Naziv je obavezan." }); return; }
    const sortParsed = parseStrictInt(categoryForm.sortOrderRaw, { label: "Redosled", allowNegative: false, allowZero: true });
    if (!sortParsed.ok) { toast.error("Greška", { description: sortParsed.message }); return; }
    
    // Prevent setting parent to itself or its descendants
    if (categoryEditing && categoryForm.parentId) {
      let currentParent = categoryForm.parentId;
      let invalid = currentParent === categoryEditing.id;
      while (!invalid && currentParent) {
        const p = supplierCategories.find(c => c.id === currentParent);
        if (p?.parentId === categoryEditing.id) invalid = true;
        currentParent = p?.parentId || "";
      }
      if (invalid) {
        toast.error("Neispravan nadređeni", { description: "Kategorija ne može biti podkategorija same sebe ili svojih podkategorija." });
        return;
      }
    }

    const { sortOrderRaw, ...rest } = categoryForm;
    const data: AdminProductCategoryInput = { ...rest, sortOrder: sortParsed.value, supplierId };
    
    if (!actionGuard.begin("save-category")) return;
    const opts = {
      onSuccess: () => {
        toast.success("Sačuvano", { description: `Kategorija je ${categoryEditing ? "ažurirana" : "kreirana"}.` });
        invalidateCategories();
        setCategoryModalOpen(false);
        actionGuard.end("save-category");
      },
      onError: (err: unknown) => {
        toast.error("Greška", { description: extractApiError(err, "Kategorija nije sačuvana.") });
        actionGuard.end("save-category");
      }
    };
    if (categoryEditing) updateCategory.mutate({ categoryId: categoryEditing.id, data }, opts);
    else createCategory.mutate({ data }, opts);
  };

  const moveCategory = async (cat: AdminProductCategory, dir: -1 | 1) => {
    const siblings = supplierCategories.filter(c => c.parentId === cat.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = siblings.findIndex(s => s.id === cat.id);
    const swap = siblings[idx + dir];
    if (!swap) return;
    
    const actionKey = `reorder:${cat.id}`;
    if (!actionGuard.begin(actionKey)) return;
    
    try {
      await Promise.all([
        updateCategory.mutateAsync({ categoryId: cat.id, data: { sortOrder: swap.sortOrder } }),
        updateCategory.mutateAsync({ categoryId: swap.id, data: { sortOrder: cat.sortOrder } })
      ]);
      invalidateCategories();
    } catch {
      toast.error("Greška", { description: "Redosled nije promenjen." });
    } finally {
      actionGuard.end(actionKey);
    }
  };


  if (supplierLoading) return <AdminLayout><div className="flex justify-center p-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></AdminLayout>;
  if (supplierError || !supplier) return <AdminLayout><div className="p-8 text-center text-destructive bg-destructive/10 rounded-xl">Dobavljač nije pronađen.</div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <Link href="/admin/dobavljaci" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4 mr-1" /> Nazad na dobavljače
        </Link>

        {/* Profile Header */}
        <section className="bg-card rounded-xl border shadow-sm p-6">
          <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
            <div className="relative group shrink-0">
              <div className="w-24 h-24 rounded-xl bg-muted border flex items-center justify-center overflow-hidden">
                {supplier.logoUrl ? (
                  <OptimizedImage src={supplier.logoUrl} alt={supplier.name} width={96} height={96} preferredSize="thumbnail" className="w-full h-full object-cover" />
                ) : (
                  <Building2 className="w-8 h-8 text-muted-foreground" />
                )}
              </div>
              <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white cursor-pointer rounded-xl">
                {logoUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5 mb-1" />}
                <span className="text-[10px] font-medium">{logoUploading ? "Slanje..." : "Promeni logo"}</span>
                <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" onChange={uploadLogo} disabled={logoUploading} />
              </label>
            </div>
            
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-serif font-bold tracking-tight text-foreground truncate">{supplier.name}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-sm">
                <span className="text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md font-mono text-xs">/shop/{supplier.slug}</span>
                <Badge variant="outline" className="uppercase">{supplier.scope}</Badge>
                {supplier.active ? (
                  <Badge className="bg-emerald-600 hover:bg-emerald-700">Aktivan</Badge>
                ) : (
                  <Badge variant="secondary">Neaktivan</Badge>
                )}
                <span className="text-muted-foreground">Kreiran: {new Date(supplier.createdAt).toLocaleDateString('sr-RS')}</span>
              </div>
            </div>
            
            <div className="flex flex-col gap-2 w-full sm:w-auto shrink-0">
              <Button variant="outline" onClick={openProfileEdit} className="w-full sm:w-auto">
                <Edit2 className="w-4 h-4 mr-2" /> Izmeni profil
              </Button>
              {supplier.active ? (
                <Button variant="outline" className="text-destructive w-full sm:w-auto hover:bg-destructive/10 hover:text-destructive" onClick={() => openStatusConfirm(false)}>
                  Deaktiviraj dobavljača
                </Button>
              ) : (
                <Button variant="outline" className="text-emerald-600 w-full sm:w-auto hover:bg-emerald-50" onClick={() => openStatusConfirm(true)}>
                  Aktiviraj dobavljača
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* Categories Tree */}
        <section className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="border-b border-border/70 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-serif text-xl font-bold text-foreground">Stablo kategorija</h2>
              <p className="mt-1 text-sm text-muted-foreground">Puna struktura kataloga za {supplier.name}. Proizvodi se vezuju za ove kategorije.</p>
            </div>
            <Button onClick={() => openCategoryNew(null)} className="shrink-0">
              <Plus className="w-4 h-4 mr-2" /> Glavna kategorija
            </Button>
          </div>
          
          {categoriesLoading ? (
            <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : flatSorted.length === 0 ? (
            <div className="p-12 flex flex-col items-center text-center text-muted-foreground">
              <FolderTree className="w-12 h-12 mb-4 opacity-20" />
              <p>Dobavljač još nema kategorije u katalogu.</p>
              <Button variant="outline" className="mt-4" onClick={() => openCategoryNew(null)}>Kreiraj prvu kategoriju</Button>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {flatSorted.map((cat) => {
                const hasChildren = supplierCategories.some(c => c.parentId === cat.id);
                const isExpanded = expandedNodes.has(cat.id);
                
                // If it's a child, only show if its parent is expanded
                if (cat.parentId && !expandedNodes.has(cat.parentId)) {
                  // Wait, we need to check all ancestors. A simple way:
                  let currentParent = cat.parentId;
                  let hidden = false;
                  while (currentParent) {
                    if (!expandedNodes.has(currentParent)) {
                      hidden = true;
                      break;
                    }
                    const p = supplierCategories.find(c => c.id === currentParent);
                    currentParent = p?.parentId || "";
                  }
                  if (hidden) return null;
                }

                return (
                  <div key={cat.id} className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/10 transition-colors ${!cat.active ? "opacity-60" : ""}`} style={{ paddingLeft: `${Math.max(1, cat.depth * 2)}rem` }}>
                    <div className="flex items-center justify-center w-6 h-6 shrink-0">
                      {hasChildren ? (
                        <button onClick={() => toggleNode(cat.id)} className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground transition-colors">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      ) : <span className="w-4 h-4 inline-block border-l-2 border-b-2 border-muted-foreground/30 rounded-bl-sm ml-2 -mt-2"></span>}
                    </div>
                    
                    {cat.imageUrl ? (
                      <OptimizedImage src={cat.imageUrl} alt={cat.name} width={64} height={64} preferredSize="thumbnail" className="w-8 h-8 rounded-md object-cover border shrink-0 bg-muted" />
                    ) : (
                      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-xs shrink-0 border">{cat.icon ?? "▣"}</div>
                    )}
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`line-clamp-1 ${cat.depth === 0 ? "font-semibold" : "font-medium"}`}>{cat.name}</p>
                        {!cat.active && <Badge variant="secondary" className="text-[10px]">Neaktivna</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{cat.productCount} proizvoda</p>
                    </div>
                    
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 sm:opacity-100 transition-opacity">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveCategory(cat, -1)} title="Pomeri gore" disabled={actionGuard.isActive(`reorder:${cat.id}`)}>
                        <ArrowUp className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveCategory(cat, 1)} title="Pomeri dole" disabled={actionGuard.isActive(`reorder:${cat.id}`)}>
                        <ArrowDown className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hidden sm:flex" onClick={() => openCategoryNew(cat.id)}>
                        <Plus className="w-3 h-3 mr-0.5" /> Podkat.
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openCategoryEdit(cat)}>
                        <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Profile Edit Modal */}
      <Dialog open={profileModalOpen} onOpenChange={setProfileModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Izmeni profil dobavljača</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Naziv *</Label>
              <Input value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Dostupnost (Scope) *</Label>
              <Select value={profileForm.scope} onValueChange={(v) => setProfileForm({ ...profileForm, scope: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="B2B">Samo B2B</SelectItem>
                  <SelectItem value="B2C">Samo B2C</SelectItem>
                  <SelectItem value="BOTH">Oba (B2B i B2C)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileModalOpen(false)}>Odustani</Button>
            <Button onClick={saveProfile} disabled={updateSupplier.isPending || actionGuard.isActive("save-profile")}>
              {updateSupplier.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Edit Modal */}
      <Dialog open={categoryModalOpen} onOpenChange={setCategoryModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{categoryEditing ? "Izmeni kategoriju" : categoryForm.parentId ? "Nova podkategorija" : "Nova glavna kategorija"}</DialogTitle>
            <DialogDescription>
              Kategorija u katalogu dobavljača {supplier.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Naziv *</Label>
              <Input value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} placeholder="npr. Nega kose" />
            </div>
            <div className="space-y-2">
              <Label>Pripada kategoriji</Label>
              <Select 
                value={categoryForm.parentId ?? "__root__"} 
                onValueChange={(v) => setCategoryForm({ ...categoryForm, parentId: v === "__root__" ? null : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">Glavna kategorija (bez nadređene)</SelectItem>
                  {supplierCategories
                    .filter(c => c.id !== categoryEditing?.id)
                    .map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
                  }
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Redosled</Label>
                <Input type="number" min="0" value={categoryForm.sortOrderRaw} onChange={(e) => setCategoryForm({ ...categoryForm, sortOrderRaw: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Ikonica (emoji, opciono)</Label>
                <Input value={categoryForm.icon ?? ""} onChange={(e) => setCategoryForm({ ...categoryForm, icon: e.target.value || null })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Fotografija (opciono)</Label>
              <div className="flex items-center gap-3 rounded-lg border border-dashed p-3">
                {categoryForm.imageUrl ? <OptimizedImage src={categoryForm.imageUrl} alt="Pregled" width={160} height={160} preferredSize="thumbnail" className="h-16 w-16 rounded-md object-cover" /> : null}
                <Button asChild type="button" variant="outline" size="sm" disabled={categoryImageUploading}>
                  <label className="cursor-pointer">
                    {categoryImageUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
                    {categoryForm.imageUrl ? "Promeni" : "Izaberi sliku"}
                    <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={categoryImageUploading} onChange={uploadCategoryImage} />
                  </label>
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <Label className="cursor-pointer">Aktivna</Label>
              <Switch checked={categoryForm.active ?? true} onCheckedChange={(c) => setCategoryForm({ ...categoryForm, active: c })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryModalOpen(false)}>Odustani</Button>
            <Button onClick={saveCategory} disabled={createCategory.isPending || updateCategory.isPending || actionGuard.isActive("save-category")}>
              {(createCategory.isPending || updateCategory.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Confirm Modal */}
      <Dialog open={confirmStatusModal} onOpenChange={setConfirmStatusModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingStatus ? "Aktiviraj dobavljača?" : "Deaktiviraj dobavljača?"}</DialogTitle>
            <DialogDescription>
              {pendingStatus ? (
                "Katalog će postati vidljiv kupcima u zavisnosti od podešenog dometa (B2B/B2C). Proizvodi i istorija nisu izmenjeni."
              ) : (
                "Katalog ovog dobavljača će odmah biti skriven sa javnog i B2B shopa. Kupci neće moći da dodaju proizvode u korpu. Podaci, istorija porudžbina i sami proizvodi ostaju sačuvani u bazi — nijedan podatak se ne briše. Dobavljača možete ponovo aktivirati u bilo kom trenutku."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmStatusModal(false)}>Odustani</Button>
            <Button variant={pendingStatus ? "default" : "destructive"} onClick={confirmStatusChange} disabled={updateSupplier.isPending || actionGuard.isActive("status-change")}>
              {updateSupplier.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {pendingStatus ? "Aktiviraj" : "Deaktiviraj"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}