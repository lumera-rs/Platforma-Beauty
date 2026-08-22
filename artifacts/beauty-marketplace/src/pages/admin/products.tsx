import { useMemo, useState } from "react";
import { AdminLayout } from "./layout";
import { OptimizedImage } from "@/components/optimized-image";
import {
  useAdminListProducts,
  useAdminCreateProduct,
  useAdminUpdateProduct,
  useAdminDeleteProduct,
  useAdminBulkUpdateProducts,
  useAdminListProductCategories,
  useAdminListBrands,
  useAdminCreateProductCategory,
  useAdminCreateBrand,
  getAdminListProductsQueryKey,
  getAdminListProductCategoriesQueryKey,
  getAdminListBrandsQueryKey,
} from "@workspace/api-client-react";
import type {
  AdminProduct,
  AdminProductInput,
  AdminListProductsParams,
  ProductVariant,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, Plus, Edit2, Trash2, Search, Package, ChevronLeft, ChevronRight,
  ArrowUpDown, X, ImagePlus, Star, Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { uploadOptimizedImage } from "@/lib/image-upload";

// ─── Helpers ───────────────────────────────────────────────────────────────

const emptyForm: AdminProductInput = {
  name: "",
  categoryId: null,
  categoryName: "",
  subcategoryName: null,
  brand: null,
  description: "",
  shortDescription: null,
  imageUrl: "",
  images: [],
  price: 0,
  discountPrice: null,
  stock: 0,
  sku: "",
  unit: "kom",
  weightGrams: 0,
  isNew: false,
  isBestseller: false,
  variantType: null,
  variants: null,
  active: true,
};

function formatRSD(v: number) {
  return `${v.toLocaleString("sr-RS")} RSD`;
}

// ─── Product Form Dialog ───────────────────────────────────────────────────

function ProductFormDialog({
  open, onClose, editing, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: AdminProduct | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createProduct = useAdminCreateProduct();
  const updateProduct = useAdminUpdateProduct();
  const createCategory = useAdminCreateProductCategory();
  const createBrand = useAdminCreateBrand();
  const { data: categories = [] } = useAdminListProductCategories();
  const { data: brands = [] } = useAdminListBrands();

  const parents = categories.filter((c) => !c.parentId);
  const [form, setForm] = useState<AdminProductInput>(
    editing
      ? {
          name: editing.name,
          categoryId: editing.categoryId ?? null,
          categoryName: editing.categoryName,
          subcategoryName: editing.subcategoryName ?? null,
          brand: editing.brand ?? null,
          description: editing.description,
          shortDescription: editing.shortDescription ?? null,
          imageUrl: editing.imageUrl,
          images: editing.images ?? [],
          price: editing.price,
          discountPrice: editing.discountPrice ?? null,
          stock: editing.stock,
          sku: editing.sku,
          unit: editing.unit,
          weightGrams: editing.weightGrams ?? 0,
          isNew: editing.isNew,
          isBestseller: editing.isBestseller,
           variantType: editing.variantType ?? editing.variants?.[0]?.label ?? null,
          variants: editing.variants ?? null,
          active: editing.active,
        }
      : emptyForm
  );
  const [weightUnit, setWeightUnit] = useState<"g" | "kg">("g");
  const [imageInput, setImageInput] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryParent, setNewCategoryParent] = useState<string>("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [showNewBrand, setShowNewBrand] = useState(false);
  const [variantInventoryMode, setVariantInventoryMode] = useState<"shared" | "per-variant">(
    editing?.variants?.length && editing.variants.every((variant) => variant.stock !== undefined)
      ? "per-variant"
      : "shared"
  );
  const [variantDraft, setVariantDraft] = useState<ProductVariant>({ label: "", value: "", priceAdjust: 0 });

  const selectedParent = parents.find((p) => p.name === form.categoryName);
  const subcategories = selectedParent
    ? categories.filter((c) => c.parentId === selectedParent.id)
    : [];

  const discountPercent =
    form.discountPrice != null && form.price > 0 && form.discountPrice < form.price
      ? Math.round((1 - form.discountPrice / form.price) * 100)
      : null;

  const displayWeight = weightUnit === "kg" ? (form.weightGrams ?? 0) / 1000 : form.weightGrams ?? 0;

  const isPending = createProduct.isPending || updateProduct.isPending;
  const variantStockTotal = (form.variants ?? []).reduce((sum, variant) => sum + (variant.stock ?? 0), 0);

  const addImage = () => {
    const url = imageInput.trim();
    if (!url) return;
    setForm((f) => ({
      ...f,
      images: [...(f.images ?? []), url],
      imageUrl: f.imageUrl || url,
    }));
    setImageInput("");
  };

  const uploadImage = async (file: File) => {
    setUploadingImage(true);
    try {
      const uploaded = await uploadOptimizedImage(file);
      setForm((current) => ({
        ...current,
        images: [...(current.images ?? []), uploaded.imageUrl],
        imageUrl: current.imageUrl || uploaded.imageUrl,
      }));
      toast.success("Slika je optimizovana", { description: "App Storage je sačuvao thumbnail, medium i large varijante." });
    } catch (error) {
      toast.error("Upload nije uspeo", { description: error instanceof Error ? error.message : "Pokušajte sa drugom slikom." });
    } finally {
      setUploadingImage(false);
    }
  };

  const removeImage = (idx: number) => {
    setForm((f) => {
      const images = (f.images ?? []).filter((_, i) => i !== idx);
      return { ...f, images, imageUrl: f.imageUrl && images.includes(f.imageUrl) ? f.imageUrl : images[0] ?? "" };
    });
  };

  const setMainImage = (url: string) => setForm((f) => ({ ...f, imageUrl: url }));

  const addVariant = () => {
    if (!variantDraft.label.trim() || !variantDraft.value.trim()) return;
    const label = form.variantType?.trim() || variantDraft.label.trim();
    if (!label) return;
    const nextVariant: ProductVariant = variantInventoryMode === "per-variant"
      ? { ...variantDraft, label, stock: variantDraft.stock ?? 0 }
      : { ...variantDraft, label };
    setForm((f) => {
      const variants: ProductVariant[] = [...(f.variants ?? []), nextVariant];
      return { ...f, variants, stock: variantInventoryMode === "per-variant" ? variants.reduce((sum, variant) => sum + (variant.stock ?? 0), 0) : f.stock };
    });
    setVariantDraft({ label, value: "", priceAdjust: 0, ...(variantInventoryMode === "per-variant" ? { stock: 0 } : {}) });
  };

  const removeVariant = (idx: number) => {
    setForm((f) => {
      const variants = (f.variants ?? []).filter((_, i) => i !== idx);
      return {
        ...f,
        variants: variants.length ? variants : null,
        stock: variantInventoryMode === "per-variant" ? variants.reduce((sum, variant) => sum + (variant.stock ?? 0), 0) : f.stock,
      };
    });
  };

  const changeVariantInventoryMode = (mode: "shared" | "per-variant") => {
    setVariantInventoryMode(mode);
    setForm((f) => {
      const variants: ProductVariant[] = (f.variants ?? []).map((variant) => {
        if (mode === "shared") {
          const { stock: _stock, ...sharedVariant } = variant;
          return sharedVariant;
        }
        return { ...variant, stock: variant.stock ?? 0 };
      });
      return { ...f, variants: variants.length ? variants : null, stock: mode === "per-variant" ? variants.reduce((sum, variant) => sum + (variant.stock ?? 0), 0) : f.stock };
    });
    setVariantDraft((draft) => mode === "per-variant" ? { ...draft, stock: draft.stock ?? 0 } : (() => {
      const { stock: _stock, ...sharedDraft } = draft;
      return sharedDraft;
    })());
  };

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) return;
    createCategory.mutate(
      { data: { name: newCategoryName.trim(), parentId: newCategoryParent || null } },
      {
        onSuccess: (cat) => {
          toast.success("Kategorija kreirana", { description: cat.name });
          queryClient.invalidateQueries({ queryKey: getAdminListProductCategoriesQueryKey() });
          if (cat.parentId) {
            const parent = parents.find((p) => p.id === cat.parentId);
            setForm((f) => ({ ...f, categoryId: cat.id, categoryName: parent?.name ?? f.categoryName, subcategoryName: cat.name }));
          } else {
            setForm((f) => ({ ...f, categoryId: cat.id, categoryName: cat.name, subcategoryName: null }));
          }
          setShowNewCategory(false);
          setNewCategoryName("");
          setNewCategoryParent("");
        },
        onError: () => toast.error("Greška", { description: "Kategorija nije kreirana." }),
      }
    );
  };

  const handleCreateBrand = () => {
    if (!newBrandName.trim()) return;
    createBrand.mutate(
      { data: { name: newBrandName.trim() } },
      {
        onSuccess: (brand) => {
          toast.success("Brend kreiran", { description: brand.name });
          queryClient.invalidateQueries({ queryKey: getAdminListBrandsQueryKey() });
          setForm((f) => ({ ...f, brand: brand.name }));
          setShowNewBrand(false);
          setNewBrandName("");
        },
        onError: () => toast.error("Greška", { description: "Brend nije kreiran." }),
      }
    );
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast.error("Greška", { description: "Naziv je obavezan." }); return; }
    if (!form.categoryName) { toast.error("Greška", { description: "Kategorija je obavezna." }); return; }
    if (!form.sku.trim()) { toast.error("Greška", { description: "SKU je obavezan." }); return; }
    if (!form.description.trim()) { toast.error("Greška", { description: "Opis je obavezan." }); return; }
    if (!form.imageUrl) { toast.error("Greška", { description: "Bar jedna slika je obavezna." }); return; }
    if (form.price <= 0) { toast.error("Greška", { description: "Cena mora biti veća od 0." }); return; }
    if (!form.weightGrams || form.weightGrams <= 0) { toast.error("Greška", { description: "Težina je obavezna (u gramima ili kilogramima)." }); return; }
    if (form.discountPrice != null && form.discountPrice >= form.price) {
      toast.error("Greška", { description: "Akcijska cena mora biti niža od redovne." }); return;
    }

    const payload = { ...form, images: form.images?.length ? form.images : [form.imageUrl] };
    const opts = {
      onSuccess: () => {
        toast.success(editing ? "Sačuvano" : "Kreirano", { description: `Proizvod je uspešno ${editing ? "ažuriran" : "kreiran"}.` });
        queryClient.invalidateQueries({ queryKey: getAdminListProductsQueryKey() });
        onSaved();
      },
      onError: (err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast.error("Greška", { description: msg ?? "Proizvod nije sačuvan." });
      },
    };
    if (editing) updateProduct.mutate({ productId: editing.id, data: payload }, opts);
    else createProduct.mutate({ data: payload }, opts);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[760px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Izmeni proizvod" : "Novi proizvod"}</DialogTitle>
          <DialogDescription>Popunite podatke o B2B proizvodu. Polja sa * su obavezna.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* ── Osnovni podaci ── */}
          <section className="space-y-4 border rounded-xl p-4">
            <h4 className="text-sm font-semibold text-foreground">Osnovni podaci</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Naziv proizvoda *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="npr. Wella Koleston Perfect 60ml" data-testid="input-product-name" />
              </div>
              <div className="space-y-2">
                <Label>Brend</Label>
                {showNewBrand ? (
                  <div className="flex gap-2">
                    <Input value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)} placeholder="Naziv novog brenda" />
                    <Button type="button" size="sm" onClick={handleCreateBrand} disabled={createBrand.isPending}>
                      {createBrand.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Dodaj"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setShowNewBrand(false)}><X className="w-4 h-4" /></Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Select value={form.brand ?? "__none__"} onValueChange={(v) => setForm({ ...form, brand: v === "__none__" ? null : v })}>
                      <SelectTrigger data-testid="select-product-brand"><SelectValue placeholder="Izaberi brend" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Bez brenda</SelectItem>
                        {brands.filter((b) => b.active).map((b) => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" size="sm" variant="outline" onClick={() => setShowNewBrand(true)} title="Novi brend"><Plus className="w-4 h-4" /></Button>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>SKU (šifra) *</Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="npr. WKP-001" data-testid="input-product-sku" />
              </div>
              <div className="space-y-2">
                <Label>Kategorija *</Label>
                <Select
                  value={form.categoryName || "__none__"}
                  onValueChange={(v) => {
                    if (v === "__none__") { setForm({ ...form, categoryId: null, categoryName: "", subcategoryName: null }); return; }
                    const parent = parents.find((p) => p.name === v);
                    setForm({ ...form, categoryId: parent?.id ?? null, categoryName: v, subcategoryName: null });
                  }}
                >
                  <SelectTrigger data-testid="select-product-category"><SelectValue placeholder="Izaberi kategoriju" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Izaberi —</SelectItem>
                    {parents.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Podkategorija</Label>
                <Select
                  value={form.subcategoryName ?? "__none__"}
                  onValueChange={(v) => {
                    if (v === "__none__") { setForm({ ...form, subcategoryName: null, categoryId: selectedParent?.id ?? form.categoryId }); return; }
                    const sub = subcategories.find((s) => s.name === v);
                    setForm({ ...form, subcategoryName: v, categoryId: sub?.id ?? form.categoryId });
                  }}
                  disabled={!selectedParent || subcategories.length === 0}
                >
                  <SelectTrigger data-testid="select-product-subcategory"><SelectValue placeholder="Izaberi podkategoriju" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Bez podkategorije</SelectItem>
                    {subcategories.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                {showNewCategory ? (
                  <div className="flex flex-col sm:flex-row gap-2 bg-muted/30 border rounded-lg p-3">
                    <Input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Naziv nove kategorije" className="flex-1" />
                    <Select value={newCategoryParent || "__root__"} onValueChange={(v) => setNewCategoryParent(v === "__root__" ? "" : v)}>
                      <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__root__">Glavna kategorija</SelectItem>
                        {parents.map((p) => <SelectItem key={p.id} value={p.id}>Podkategorija: {p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" size="sm" onClick={handleCreateCategory} disabled={createCategory.isPending}>
                      {createCategory.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Kreiraj"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setShowNewCategory(false)}><X className="w-4 h-4" /></Button>
                  </div>
                ) : (
                  <Button type="button" variant="link" size="sm" className="px-0 text-xs" onClick={() => setShowNewCategory(true)}>
                    <Plus className="w-3 h-3 mr-1" /> Kreiraj novu kategoriju direktno iz forme
                  </Button>
                )}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Kratki opis</Label>
                <Input value={form.shortDescription ?? ""} onChange={(e) => setForm({ ...form, shortDescription: e.target.value || null })} placeholder="Kratak opis za listu proizvoda (opciono)" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Puni opis *</Label>
                <textarea
                  className="flex min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Detaljan opis proizvoda..."
                  data-testid="input-product-description"
                />
              </div>
            </div>
          </section>

          {/* ── Cena i popust ── */}
          <section className="space-y-4 border rounded-xl p-4">
            <h4 className="text-sm font-semibold text-foreground">Cena i popust</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Redovna cena (RSD) *</Label>
                <Input type="number" min="0" step="1" value={form.price || ""} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} data-testid="input-product-price" />
              </div>
              <div className="space-y-2">
                <Label>Akcijska cena (RSD)</Label>
                <Input
                  type="number" min="0"
                  value={form.discountPrice ?? ""}
                  onChange={(e) => setForm({ ...form, discountPrice: e.target.value === "" ? null : Number(e.target.value) })}
                  placeholder="Bez akcije"
                  data-testid="input-product-discount"
                />
              </div>
              <div className="space-y-2">
                <Label>Popust</Label>
                <div className="h-10 flex items-center">
                  {discountPercent != null ? (
                    <Badge className="bg-destructive text-white border-none">-{discountPercent}%</Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">Automatski se računa</span>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Jedinica mere *</Label>
                <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="kom / 500 ml / set" />
              </div>
            </div>
          </section>

          {/* ── Zalihe i težina ── */}
          <section className="space-y-4 border rounded-xl p-4">
            <h4 className="text-sm font-semibold text-foreground">Zalihe i težina</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Stanje (kom) *</Label>
                <Input type="number" min="0" step="1" value={variantInventoryMode === "per-variant" ? variantStockTotal : form.stock} disabled={variantInventoryMode === "per-variant"} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} data-testid="input-product-stock" />
                {variantInventoryMode === "per-variant" && <p className="text-xs text-muted-foreground">Automatski zbir zaliha varijanti.</p>}
              </div>
              <div className="space-y-2">
                <Label>Težina proizvoda *</Label>
                <div className="flex gap-2">
                  <Input
                    type="number" min="0" step={weightUnit === "kg" ? "0.01" : "1"}
                    value={displayWeight || ""}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setForm({ ...form, weightGrams: weightUnit === "kg" ? Math.round(v * 1000) : Math.round(v) });
                    }}
                    data-testid="input-product-weight"
                  />
                  <Select value={weightUnit} onValueChange={(v) => setWeightUnit(v as "g" | "kg")}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="g">g</SelectItem>
                      <SelectItem value="kg">kg</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[11px] text-muted-foreground">Koristi se za obračun dostave po težini.</p>
              </div>
            </div>
          </section>

          {/* ── Slike ── */}
          <section className="space-y-4 border rounded-xl p-4">
            <h4 className="text-sm font-semibold text-foreground">Slike proizvoda</h4>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" asChild disabled={uploadingImage}>
                <label className="cursor-pointer">
                  {uploadingImage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
                  {uploadingImage ? "Optimizovanje..." : "Otpremi fotografiju"}
                  <input
                    type="file"
                    className="sr-only"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    disabled={uploadingImage}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void uploadImage(file);
                    }}
                  />
                </label>
              </Button>
              <span className="text-xs text-muted-foreground">JPG, PNG, WEBP ili GIF · do 8 MB</span>
            </div>
            <div className="flex gap-2">
              <Input value={imageInput} onChange={(e) => setImageInput(e.target.value)} placeholder="Legacy URL slike (opciono)" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addImage())} />
              <Button type="button" variant="secondary" onClick={addImage}><ImagePlus className="w-4 h-4 mr-1" /> Dodaj</Button>
            </div>
            {(form.images ?? []).length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                {(form.images ?? []).map((url, idx) => (
                  <div key={`${url}-${idx}`} className={`relative rounded-lg border-2 overflow-hidden group ${form.imageUrl === url ? "border-primary" : "border-transparent"}`}>
                    <OptimizedImage src={url} alt="" width={160} height={160} className="aspect-square object-cover w-full" sizes="(max-width: 640px) 33vw, 20vw" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                      <button type="button" onClick={() => setMainImage(url)} className="text-[10px] text-white flex items-center gap-1 hover:underline">
                        <Star className="w-3 h-3" /> Glavna
                      </button>
                      <button type="button" onClick={() => removeImage(idx)} className="text-[10px] text-red-300 flex items-center gap-1 hover:underline">
                        <Trash2 className="w-3 h-3" /> Ukloni
                      </button>
                    </div>
                    {form.imageUrl === url && (
                      <Badge className="absolute top-1 left-1 text-[9px] px-1.5 py-0 bg-primary">Glavna</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Varijante ── */}
          <section className="space-y-4 border rounded-xl p-4">
            <h4 className="text-sm font-semibold text-foreground">Varijante proizvoda</h4>
            <div className="space-y-1 max-w-sm">
              <Label className="text-xs">Tip varijante</Label>
              <Input
                value={form.variantType ?? ""}
                onChange={(e) => setForm({ ...form, variantType: e.target.value || null })}
                placeholder="npr. Zapremina, Boja/Nijansa, Veličina"
                data-testid="input-product-variant-type"
              />
              <p className="text-xs text-muted-foreground">Jedan tip važi za sve opcije ovog proizvoda.</p>
            </div>
            <div className="flex flex-wrap gap-2 items-center text-xs">
              <span className="font-medium">Model zaliha:</span>
              <Button type="button" size="sm" variant={variantInventoryMode === "shared" ? "default" : "outline"} onClick={() => changeVariantInventoryMode("shared")}>Zajednička zaliha</Button>
              <Button type="button" size="sm" variant={variantInventoryMode === "per-variant" ? "default" : "outline"} onClick={() => changeVariantInventoryMode("per-variant")}>Po varijanti</Button>
              <span className="text-muted-foreground">{variantInventoryMode === "shared" ? "Sve varijante koriste stanje proizvoda." : "Stanje proizvoda je zbir stanja varijanti."}</span>
            </div>
            <div className={`grid grid-cols-2 ${variantInventoryMode === "per-variant" ? "sm:grid-cols-6" : "sm:grid-cols-5"} gap-2 items-end`}>
              <div className="space-y-1">
                <Label className="text-xs">Vrednost</Label>
                <Input value={variantDraft.value} onChange={(e) => setVariantDraft({ ...variantDraft, value: e.target.value })} placeholder="6/0 Tamno plava" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">± Cena (RSD)</Label>
                <Input type="number" step="1" value={variantDraft.priceAdjust ?? 0} onChange={(e) => setVariantDraft({ ...variantDraft, priceAdjust: Number(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Posebna cena</Label>
                <Input type="number" min="0" step="1" value={variantDraft.price ?? ""} onChange={(e) => setVariantDraft({ ...variantDraft, price: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="Opciono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">SKU varijante</Label>
                <Input value={variantDraft.sku ?? ""} onChange={(e) => setVariantDraft({ ...variantDraft, sku: e.target.value || undefined })} placeholder="Opciono" />
              </div>
              {variantInventoryMode === "per-variant" && <div className="space-y-1">
                <Label className="text-xs">Stanje</Label>
                <Input type="number" min="0" step="1" value={variantDraft.stock ?? 0} onChange={(e) => setVariantDraft({ ...variantDraft, stock: Number(e.target.value) })} />
              </div>}
              <Button type="button" variant="secondary" size="sm" onClick={addVariant} data-testid="btn-add-product-variant">Dodaj</Button>
            </div>
            {(form.variants ?? []).length > 0 && (
              <ul className="space-y-1.5">
                {(form.variants ?? []).map((v, i) => (
                  <li key={i} className="flex items-center justify-between text-sm bg-muted/30 border rounded-md px-3 py-1.5">
                    <span>
                      <span className="text-muted-foreground text-xs mr-2">{form.variantType || v.label}:</span>
                      <span className="font-medium">{v.value}</span>
                      {v.price != null ? <span className="ml-2 text-xs text-muted-foreground">cena: {formatRSD(v.price)}</span> : v.priceAdjust ? <span className="ml-2 text-xs text-muted-foreground">({v.priceAdjust > 0 ? "+" : ""}{v.priceAdjust} RSD)</span> : null}
                      {v.sku ? <span className="ml-2 text-xs text-muted-foreground">SKU: {v.sku}</span> : null}
                      {v.stock != null ? <span className="ml-2 text-xs text-muted-foreground">stanje: {v.stock}</span> : null}
                    </span>
                    <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => removeVariant(i)}><X className="w-3.5 h-3.5" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Vidljivost ── */}
          <section className="space-y-3 border rounded-xl p-4">
            <h4 className="text-sm font-semibold text-foreground">Vidljivost i oznake</h4>
            <div className="flex items-center justify-between">
              <Label className="cursor-pointer">Proizvod je aktivan (vidljiv u B2B shopu)</Label>
              <Switch checked={form.active ?? true} onCheckedChange={(c) => setForm({ ...form, active: c })} data-testid="switch-product-active" />
            </div>
            <div className="flex items-center justify-between">
              <Label className="cursor-pointer">Oznaka „Novo"</Label>
              <Switch checked={form.isNew ?? false} onCheckedChange={(c) => setForm({ ...form, isNew: c })} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="cursor-pointer">Oznaka „Bestseller"</Label>
              <Switch checked={form.isBestseller ?? false} onCheckedChange={(c) => setForm({ ...form, isBestseller: c })} />
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Odustani</Button>
          <Button onClick={handleSave} disabled={isPending} data-testid="btn-save-product">
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Sačuvaj proizvod
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function AdminProducts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [brand, setBrand] = useState("");
  const [status, setStatus] = useState("");
  const [sortBy, setSortBy] = useState<NonNullable<AdminListProductsParams["sortBy"]>>("createdAt");
  const [sortDir, setSortDir] = useState<NonNullable<AdminListProductsParams["sortDir"]>>("desc");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const params: AdminListProductsParams = useMemo(() => ({
    ...(search ? { search } : {}),
    ...(category ? { category } : {}),
    ...(subcategory ? { subcategory } : {}),
    ...(brand ? { brand } : {}),
    ...(status ? { status: status as NonNullable<AdminListProductsParams["status"]> } : {}),
    sortBy, sortDir, page, pageSize,
  }), [search, category, subcategory, brand, status, sortBy, sortDir, page]);

  const { data, isLoading, error } = useAdminListProducts(params);
  const { data: categories = [] } = useAdminListProductCategories();
  const { data: brands = [] } = useAdminListBrands();
  const deleteProduct = useAdminDeleteProduct();
  const bulkUpdate = useAdminBulkUpdateProducts();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminProduct | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState("");
  const [bulkPercent, setBulkPercent] = useState(0);
  const [bulkCategoryId, setBulkCategoryId] = useState("");

  const parents = categories.filter((c) => !c.parentId);
  const subcats = category ? categories.filter((c) => c.parentId === parents.find((p) => p.name === category)?.id) : [];
  const items = data?.items ?? [];

  const toggleSort = (col: NonNullable<AdminListProductsParams["sortBy"]>) => {
    if (sortBy === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
    setPage(1);
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getAdminListProductsQueryKey() });

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteProduct.mutate({ productId: deleteTarget.id }, {
      onSuccess: (result) => {
        toast.success(result.active === false && result.id === deleteTarget.id ? "Uklonjeno" : "Obrisano", {
          description: "Proizvod je obrisan ili deaktiviran (ako postoji u porudžbinama).",
        });
        invalidate();
        setDeleteTarget(null);
      },
      onError: () => toast.error("Greška", { description: "Proizvod nije obrisan." }),
    });
  };

  const runBulk = () => {
    if (!bulkAction || selected.length === 0) return;
    const payload: Parameters<typeof bulkUpdate.mutate>[0] = {
      data: {
        productIds: selected,
        action: bulkAction as "activate" | "deactivate" | "set-category" | "adjust-price-percent" | "set-new" | "unset-new",
        ...(bulkAction === "set-category" ? { categoryId: bulkCategoryId } : {}),
        ...(bulkAction === "adjust-price-percent" ? { pricePercent: bulkPercent } : {}),
      },
    };
    bulkUpdate.mutate(payload, {
      onSuccess: (r) => {
        toast.success("Masovna izmena", { description: `Ažurirano proizvoda: ${r.updated}` });
        invalidate();
        setSelected([]);
        setBulkAction("");
      },
      onError: (err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast.error("Greška", { description: msg ?? "Masovna izmena nije uspela." });
      },
    });
  };

  const allOnPageSelected = items.length > 0 && items.every((p) => selected.includes(p.id));

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">B2B Proizvodi</h1>
            <p className="text-muted-foreground text-sm">Upravljanje proizvodima u profesionalnom shopu.</p>
          </div>
          <Button onClick={() => { setEditing(null); setModalOpen(true); }} className="shrink-0 gap-2" data-testid="btn-new-product">
            <Plus className="w-4 h-4" /> Novi proizvod
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Pretraži po nazivu, SKU, brendu..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" data-testid="input-search-products" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Select value={category || "__all__"} onValueChange={(v) => { setCategory(v === "__all__" ? "" : v); setSubcategory(""); setPage(1); }}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Kategorija" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Sve kategorije</SelectItem>
                {parents.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {subcats.length > 0 && (
              <Select value={subcategory || "__all__"} onValueChange={(v) => { setSubcategory(v === "__all__" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Podkategorija" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Sve podkategorije</SelectItem>
                  {subcats.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={brand || "__all__"} onValueChange={(v) => { setBrand(v === "__all__" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Brend" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Svi brendovi</SelectItem>
                {brands.map((b) => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status || "__all__"} onValueChange={(v) => { setStatus(v === "__all__" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Svi statusi</SelectItem>
                <SelectItem value="in-stock">Na stanju</SelectItem>
                <SelectItem value="out-of-stock">Nema na stanju</SelectItem>
                <SelectItem value="new">Novo</SelectItem>
                <SelectItem value="on-sale">Na akciji</SelectItem>
                <SelectItem value="inactive">Neaktivni</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Bulk bar */}
        {selected.length > 0 && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3" data-testid="bulk-actions-bar">
            <span className="text-sm font-medium">{selected.length} izabrano</span>
            <Select value={bulkAction || "__none__"} onValueChange={(v) => setBulkAction(v === "__none__" ? "" : v)}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Izaberi akciju" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Izaberi akciju —</SelectItem>
                <SelectItem value="activate">Aktiviraj</SelectItem>
                <SelectItem value="deactivate">Deaktiviraj</SelectItem>
                <SelectItem value="set-new">Označi kao Novo</SelectItem>
                <SelectItem value="unset-new">Ukloni oznaku Novo</SelectItem>
                <SelectItem value="set-category">Promeni kategoriju</SelectItem>
                <SelectItem value="adjust-price-percent">Promeni cene ±%</SelectItem>
              </SelectContent>
            </Select>
            {bulkAction === "adjust-price-percent" && (
              <div className="flex items-center gap-1">
                <Input type="number" className="w-24" value={bulkPercent || ""} onChange={(e) => setBulkPercent(Number(e.target.value))} placeholder="+10 / -5" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            )}
            {bulkAction === "set-category" && (
              <Select value={bulkCategoryId || "__none__"} onValueChange={(v) => setBulkCategoryId(v === "__none__" ? "" : v)}>
                <SelectTrigger className="w-52"><SelectValue placeholder="Nova kategorija" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Izaberi —</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.parentId ? `— ${c.name}` : c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" onClick={runBulk} disabled={!bulkAction || bulkUpdate.isPending} data-testid="btn-run-bulk">
              {bulkUpdate.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Primeni
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Poništi izbor</Button>
          </div>
        )}

        {/* Table */}
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">Došlo je do greške pri učitavanju proizvoda.</div>
          ) : items.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-muted-foreground">
              <Package className="w-12 h-12 mb-4 opacity-20" />
              <p>Nema proizvoda za izabrane filtere.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b text-left">
                  <tr>
                    <th className="p-3 w-10">
                      <Checkbox
                        checked={allOnPageSelected}
                        onCheckedChange={(c) => setSelected(c ? [...new Set([...selected, ...items.map((p) => p.id)])] : selected.filter((id) => !items.some((p) => p.id === id)))}
                        data-testid="checkbox-select-all"
                      />
                    </th>
                    <th className="p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("name")}>
                      <span className="flex items-center gap-1">Proizvod <ArrowUpDown className="w-3 h-3 opacity-50" /></span>
                    </th>
                    <th className="p-3 font-medium hidden md:table-cell">Kategorija</th>
                    <th className="p-3 font-medium hidden lg:table-cell">SKU</th>
                    <th className="p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("price")}>
                      <span className="flex items-center gap-1">Cena <ArrowUpDown className="w-3 h-3 opacity-50" /></span>
                    </th>
                    <th className="p-3 font-medium cursor-pointer select-none" onClick={() => toggleSort("stock")}>
                      <span className="flex items-center gap-1">Stanje <ArrowUpDown className="w-3 h-3 opacity-50" /></span>
                    </th>
                    <th className="p-3 font-medium hidden lg:table-cell">Težina</th>
                    <th className="p-3 font-medium hidden sm:table-cell">Status</th>
                    <th className="p-3 font-medium text-right">Akcije</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {items.map((p) => (
                    <tr key={p.id} className={`hover:bg-muted/10 transition-colors ${!p.active ? "opacity-50" : ""}`} data-testid={`product-row-${p.id}`}>
                      <td className="p-3">
                        <Checkbox checked={selected.includes(p.id)} onCheckedChange={(c) => setSelected(c ? [...selected, p.id] : selected.filter((id) => id !== p.id))} />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <OptimizedImage src={p.imageUrl} alt="" width={40} height={40} className="w-10 h-10 rounded-lg object-cover border shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium line-clamp-1">{p.name}</p>
                            <p className="text-xs text-muted-foreground line-clamp-1">{p.brand ?? "—"}{p.variants?.length ? ` · ${p.variants.length} varijanti` : ""}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <p className="text-xs">{p.categoryName}</p>
                        {p.subcategoryName && <p className="text-xs text-muted-foreground">{p.subcategoryName}</p>}
                      </td>
                      <td className="p-3 hidden lg:table-cell text-xs font-mono">{p.sku}</td>
                      <td className="p-3 whitespace-nowrap">
                        {p.discountPrice != null ? (
                          <>
                            <span className="text-xs text-muted-foreground line-through block">{formatRSD(p.price)}</span>
                            <span className="font-semibold text-primary">{formatRSD(p.discountPrice)}</span>
                          </>
                        ) : (
                          <span className="font-semibold">{formatRSD(p.price)}</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={p.stock <= 0 ? "text-destructive font-semibold" : p.stock < 10 ? "text-amber-600 font-medium" : ""}>{p.stock}</span>
                      </td>
                      <td className="p-3 hidden lg:table-cell text-xs text-muted-foreground">
                        {p.weightGrams != null ? (p.weightGrams >= 1000 ? `${(p.weightGrams / 1000).toLocaleString("sr-RS")} kg` : `${p.weightGrams} g`) : "—"}
                      </td>
                      <td className="p-3 hidden sm:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {!p.active && <Badge variant="secondary" className="text-[10px]">Neaktivan</Badge>}
                          {p.isNew && <Badge className="bg-sky-500 text-white border-none text-[10px]">Novo</Badge>}
                          {p.discountPercent != null && <Badge className="bg-destructive text-white border-none text-[10px]">-{p.discountPercent}%</Badge>}
                          {p.stock <= 0 && <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40">Nema</Badge>}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => { setEditing(p); setModalOpen(true); }} data-testid={`btn-edit-product-${p.id}`}>
                            <Edit2 className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => setDeleteTarget(p)} data-testid={`btn-delete-product-${p.id}`}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <span className="text-xs text-muted-foreground">
                Strana {data.page} od {data.totalPages} — ukupno {data.total} proizvoda
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="btn-prev-page">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)} data-testid="btn-next-page">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {data && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Layers className="w-3.5 h-3.5" /> Ukupno {data.total} proizvoda u bazi za izabrane filtere.
          </p>
        )}
      </div>

      {/* Create / Edit dialog */}
      {modalOpen && (
        <ProductFormDialog
          key={editing?.id ?? "new"}
          open={modalOpen}
          editing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => setModalOpen(false)}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Obriši proizvod?</DialogTitle>
            <DialogDescription>
              „{deleteTarget?.name}" će biti trajno obrisan. Ako postoji u porudžbinama, biće samo deaktiviran kako bi istorija porudžbina ostala netaknuta.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Odustani</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteProduct.isPending} data-testid="btn-confirm-delete">
              {deleteProduct.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Obriši
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
