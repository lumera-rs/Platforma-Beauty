import { useEffect, useMemo, useRef, useState } from "react";
import { AdminLayout } from "./layout";
import { Link, useLocation, useSearch } from "wouter";
import {
  useAdminListProducts,
  useAdminCreateProduct,
  useAdminUpdateProduct,
  useAdminDeleteProduct,
  useAdminAttachProductDocument,
  useAdminDeleteProductDocument,
  useListProductDocuments,
  getListProductDocumentsQueryKey,
  useAdminBulkUpdateProducts,
  useAdminListProductCategories,
  useAdminListBrands,
  useAdminCreateBrand,
  useAdminListSuppliers,
  useAdminListB2cProductTypes,
  useAdminListB2cNeedTags,
  useGetPublicProductUpsells,
  useAdminReplaceProductUpsells,
  getGetPublicProductUpsellsQueryKey,
  getAdminListProductsQueryKey,
  getAdminListProductCategoriesQueryKey,
  getAdminListBrandsQueryKey,
  getAdminListB2cProductTypesQueryKey,
  getAdminListB2cNeedTagsQueryKey,
} from "@workspace/api-client-react";
import type {
  AdminProduct,
  AdminProductInput,
  AdminListProductsParams,
  ProductVariant,
  QuantityPricingTier,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
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
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { OptimizedImage } from "@/components/optimized-image";
import { uploadOptimizedImage, uploadDocument } from "@/lib/media-upload";
import { FileText, Download } from "lucide-react";
import { extractApiError, parseStrictDecimal, parseStrictInt } from "@/lib/admin-form-utils";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

// ─── Helpers ───────────────────────────────────────────────────────────────

const emptyForm = {
  supplierId: "",
  market: "B2B",
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
  retailEnabled: false,
  professionalEnabled: true,
  publicDescription: null,
  publicPrice: null,
  publicDiscountPrice: null,
  stock: 0,
  sku: "",
  unit: "kom",
  weightGrams: 0,
  isNew: false,
  isBestseller: false,
  priceOnRequest: false,
  bulkMatrixEnabled: false,
  variantType: null,
  variants: null,
  active: true,
  similarProductsMode: "AUTO_CATEGORY",
  similarProductIds: [],
  crossSellProductIds: [],
  quantityPricingTiers: [],
  minimumOrderQuantity: 1,
  deliveryBusinessDaysOverride: null,
  subscriptionAllowed: false,
  subscriptionDiscountPercent: null,
  productTypeId: null,
  needTagIds: [],
  ingredients: null,
  usageInstructions: null,
  characteristics: [],
  searchSynonyms: [],
  discountPriceEndsAt: null,
  publicDiscountPriceEndsAt: null,
  loyaltyPricingExcluded: false,
} as unknown as AdminProductInput;

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
  const createBrand = useAdminCreateBrand();

  const attachDocument = useAdminAttachProductDocument();
  const deleteDocument = useAdminDeleteProductDocument();
  const { data: documents = [], refetch: refetchDocs } = useListProductDocuments(editing?.id || "", { audience: "B2C" }, { query: { enabled: !!editing?.id, queryKey: getListProductDocumentsQueryKey(editing?.id || "", { audience: "B2C" }) } });
  const [uploadingDocs, setUploadingDocs] = useState(false);

  // --- Upsells ---
  const { data: upsellsData } = useGetPublicProductUpsells(editing?.id || "", { query: { enabled: !!editing?.id, queryKey: getGetPublicProductUpsellsQueryKey(editing?.id || "") } });
  const replaceUpsells = useAdminReplaceProductUpsells();
  const [upsellIds, setUpsellIds] = useState<string[]>([]);
  const [hasUnsavedUpsells, setHasUnsavedUpsells] = useState(false);

  useEffect(() => {
    if (upsellsData?.items && !hasUnsavedUpsells) {
      setUpsellIds(upsellsData.items.map(u => u.id));
    }
  }, [upsellsData, hasUnsavedUpsells]);
  // ---------------

  const handleDocumentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!editing?.id) return;
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";

    setUploadingDocs(true);
    try {
      const { url, displayName } = await uploadDocument(file, "product-document", editing.id);
      await attachDocument.mutateAsync({ productId: editing.id, data: { mediaUrl: url, displayName, sortOrder: documents.length } });
      toast.success("Dokument uspešno dodat.");
      refetchDocs();
    } catch (err) {
      toast.error("Greška", { description: extractApiError(err, "Nije moguće dodati dokument.") });
    } finally {
      setUploadingDocs(false);
    }
  };

  const { data: categories = [] } = useAdminListProductCategories();
  const { data: brands = [] } = useAdminListBrands();
  const { data: suppliers = [] } = useAdminListSuppliers();
  const { data: productTypes = [] } = useAdminListB2cProductTypes();
  const { data: needTags = [] } = useAdminListB2cNeedTags();
  const actionGuard = useImmediateActionGuard();
  const [newBrandName, setNewBrandName] = useState("");

  const [form, setForm] = useState<AdminProductInput & { supplierId: string, market: "B2B" | "B2C" | "BOTH" }>(
    editing
      ? {
          supplierId: editing.supplierId,
          market: editing.professionalEnabled && editing.retailEnabled ? "BOTH" : editing.retailEnabled ? "B2C" : "B2B",
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
          retailEnabled: editing.retailEnabled,
          professionalEnabled: editing.professionalEnabled,
          publicDescription: editing.publicDescription ?? null,
          publicPrice: editing.publicPrice ?? null,
          publicDiscountPrice: editing.publicDiscountPrice ?? null,
          stock: editing.stock,
          sku: editing.sku,
          unit: editing.unit,
          weightGrams: editing.weightGrams ?? 0,
          isNew: editing.isNew,
          isBestseller: editing.isBestseller,
          priceOnRequest: (editing as any).priceOnRequest ?? false,
          bulkMatrixEnabled: (editing as any).bulkMatrixEnabled ?? false,
          variantType: editing.variantType ?? editing.variants?.[0]?.label ?? null,
          variants: editing.variants ?? null,
          active: editing.active,
          similarProductsMode: editing.similarProductsMode,
          similarProductIds: editing.similarProductIds,
          crossSellProductIds: editing.crossSellProductIds,
          quantityPricingTiers: editing.quantityPricingTiers,
          minimumOrderQuantity: editing.minimumOrderQuantity,
          deliveryBusinessDaysOverride: editing.deliveryBusinessDaysOverride,
          subscriptionAllowed: editing.subscriptionAllowed,
          subscriptionDiscountPercent: editing.subscriptionDiscountPercent,
          productTypeId: editing.productTypeId ?? null,
          needTagIds: (editing as any).needTagIds ?? [],
          ingredients: editing.ingredients ?? null,
          usageInstructions: editing.usageInstructions ?? null,
          characteristics: editing.characteristics ?? [],
          searchSynonyms: editing.searchSynonyms ?? [],
          discountPriceEndsAt: editing.discountPriceEndsAt ?? null,
          publicDiscountPriceEndsAt: (editing as any).publicDiscountPriceEndsAt ?? null,
          loyaltyPricingExcluded: (editing as any).loyaltyPricingExcluded ?? false,
        }
      : { ...(emptyForm as any), supplierId: "", market: "B2B" }
  );
  const [weightUnit, setWeightUnit] = useState<"g" | "kg">("g");
  // Raw string state so numeric inputs aren't clobbered while typing
  const [rawNums, setRawNums] = useState(() => ({
    price: editing ? String(editing.price) : "0",
    discountPrice: editing?.discountPrice != null ? String(editing.discountPrice) : "",
    publicPrice: editing?.publicPrice != null ? String(editing.publicPrice) : "",
    publicDiscountPrice: editing?.publicDiscountPrice != null ? String(editing.publicDiscountPrice) : "",
    stock: editing ? String(editing.stock) : "0",
    weightDisplay: editing ? (weightUnit === "kg" ? String((editing.weightGrams ?? 0) / 1000) : String(editing.weightGrams ?? 0)) : "0",
  }));
  const rawNumsRef = useRef(rawNums);
  const updateRawNums = (updater: (current: typeof rawNums) => typeof rawNums) => {
    const next = updater(rawNumsRef.current);
    rawNumsRef.current = next;
    setRawNums(next);
  };
  const [uploadingImages, setUploadingImages] = useState(false);
  const [variantInventoryMode, setVariantInventoryMode] = useState<"shared" | "per-variant">(
    editing?.variants?.length && editing.variants.every((variant) => variant.stock !== undefined)
      ? "per-variant"
      : "shared"
  );
  const [variantDraft, setVariantDraft] = useState<ProductVariant>({ label: "", value: "", priceAdjust: 0 });

  const selectedSupplier = suppliers.find(s => s.id === form.supplierId);
  const availableCategories = categories.filter(c => c.supplierId === form.supplierId);
  const relatedProductsParams = useMemo<AdminListProductsParams>(() => ({
    supplierId: form.supplierId || undefined,
    page: 1,
    pageSize: 100,
    sortBy: "name",
    sortDir: "asc",
  }), [form.supplierId]);
  const { data: relatedProductsData } = useAdminListProducts(relatedProductsParams, {
    query: {
      enabled: Boolean(form.supplierId),
      queryKey: getAdminListProductsQueryKey(relatedProductsParams),
    },
  });
  const selectedRelationshipIds = useMemo(
    () => [...new Set([...(form.similarProductIds ?? []), ...(form.crossSellProductIds ?? [])])],
    [form.similarProductIds, form.crossSellProductIds],
  );
  const selectedProductsParams = useMemo<AdminListProductsParams>(() => ({
    supplierId: form.supplierId || undefined,
    productIds: selectedRelationshipIds.join(","),
    page: 1,
    pageSize: 100,
    sortBy: "name",
    sortDir: "asc",
  }), [form.supplierId, selectedRelationshipIds]);
  const { data: selectedProductsData } = useAdminListProducts(selectedProductsParams, {
    query: {
      enabled: Boolean(form.supplierId && selectedRelationshipIds.length),
      queryKey: getAdminListProductsQueryKey(selectedProductsParams),
    },
  });
  const relatedProductOptions = useMemo(() => {
    const productsById = new Map(
      [...(relatedProductsData?.items ?? []), ...(selectedProductsData?.items ?? [])]
        .map((product) => [product.id, product] as const),
    );
    return [...productsById.values()]
    .filter((product) => product.id !== editing?.id && product.supplierId === form.supplierId)
    .map((product) => ({ value: product.id, label: product.name, keywords: `${product.sku} ${product.brand ?? ""}` }));
  }, [editing?.id, form.supplierId, relatedProductsData?.items, selectedProductsData?.items]);

  const createAndSelectBrand = () => {
    const name = newBrandName.trim();
    if (!name || createBrand.isPending) return;
    createBrand.mutate({ data: { name, description: "", logoUrl: null, active: true } }, {
      onSuccess: (brand) => {
        setForm((current) => ({ ...current, brand: brand.name }));
        setNewBrandName("");
        queryClient.invalidateQueries({ queryKey: getAdminListBrandsQueryKey() });
        toast.success("Brend je kreiran.");
      },
      onError: (error) => toast.error("Greška", { description: extractApiError(error, "Brend nije kreiran.") }),
    });
  };

  // Discount percent display — parsed from rawNums for live feedback
  const rawPrice = parseFloat(rawNums.price);
  const rawDiscount = rawNums.discountPrice.trim() !== "" ? parseFloat(rawNums.discountPrice) : NaN;
  const discountPercent =
    !isNaN(rawDiscount) && !isNaN(rawPrice) && rawPrice > 0 && rawDiscount < rawPrice
      ? Math.round((1 - rawDiscount / rawPrice) * 100)
      : null;

  const isPending = createProduct.isPending || updateProduct.isPending;
  const variantStockTotal = (form.variants ?? []).reduce((sum, variant) => sum + (variant.stock ?? 0), 0);

  const uploadImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])].slice(0, Math.max(0, 12 - (form.images?.length ?? 0)));
    event.target.value = "";
    if (!files.length) return;
    setUploadingImages(true);
    try {
      const uploaded: string[] = [];
      for (const file of files) {
        const asset = await uploadOptimizedImage(file, "product", editing?.id);
        uploaded.push(asset.imageUrl);
      }
      setForm((current) => {
        const images = [...(current.images ?? []), ...uploaded];
        return { ...current, images, imageUrl: current.imageUrl || images[0] || "" };
      });
      toast.success(files.length === 1 ? "Fotografija proizvoda je obrađena." : `${files.length} fotografije proizvoda su obrađene.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload fotografija nije uspeo.");
    } finally {
      setUploadingImages(false);
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


  const handleSave = () => {
    if (isPending) return;
    const submittedRawNums = rawNumsRef.current;
    if (!form.supplierId) { toast.error("Greška", { description: "Dobavljač je obavezan." }); return; }
    if (!form.name.trim()) { toast.error("Greška", { description: "Naziv je obavezan." }); return; }
    if (!form.categoryId) { toast.error("Greška", { description: "Kategorija je obavezna." }); return; }
    if (!form.sku.trim()) { toast.error("Greška", { description: "SKU je obavezan." }); return; }
    if (!form.description.trim()) { toast.error("Greška", { description: "Opis je obavezan." }); return; }
    if (!form.imageUrl) { toast.error("Greška", { description: "Bar jedna slika je obavezna." }); return; }

    const priceParsed = form.priceOnRequest ? { ok: true as const, value: 0 } : parseStrictInt(submittedRawNums.price, { label: "Redovna cena", allowNegative: false, allowZero: false });
    if (!priceParsed.ok) { toast.error("Greška", { description: priceParsed.message }); return; }

    const discountParsed = form.priceOnRequest || submittedRawNums.discountPrice.trim() === ""
      ? { ok: true as const, value: null }
      : parseStrictInt(submittedRawNums.discountPrice, { label: "Akcijska cena", allowNegative: false, allowZero: false });
    if (!discountParsed.ok) { toast.error("Greška", { description: discountParsed.message }); return; }
    if (discountParsed.value !== null && discountParsed.value >= priceParsed.value) {
      toast.error("Greška", { description: "Akcijska cena mora biti niža od redovne." }); return;
    }
    const publicPriceParsed = form.priceOnRequest || submittedRawNums.publicPrice.trim() === ""
      ? { ok: true as const, value: null }
      : parseStrictInt(submittedRawNums.publicPrice, { label: "Javna redovna cena", allowNegative: false, allowZero: false });
    if (!publicPriceParsed.ok) { toast.error("Greška", { description: publicPriceParsed.message }); return; }
    const publicDiscountParsed = form.priceOnRequest || submittedRawNums.publicDiscountPrice.trim() === ""
      ? { ok: true as const, value: null }
      : parseStrictInt(submittedRawNums.publicDiscountPrice, { label: "Javna akcijska cena", allowNegative: false, allowZero: false });
    if (!publicDiscountParsed.ok) { toast.error("Greška", { description: publicDiscountParsed.message }); return; }
    if (form.market === "B2C" || form.market === "BOTH") {
      if (!form.publicDescription?.trim()) {
        toast.error("Greška", { description: "Javni proizvod mora imati poseban opis za kupce." }); return;
      }
      if (!form.priceOnRequest && publicPriceParsed.value === null) {
        toast.error("Greška", { description: "Javni proizvod mora imati javnu cenu za kupce." }); return;
      }
    }
    if (!form.priceOnRequest && publicDiscountParsed.value !== null && (publicPriceParsed.value === null || publicDiscountParsed.value >= publicPriceParsed.value)) {
      toast.error("Greška", { description: "Javna akcijska cena mora biti niža od javne redovne cene." }); return;
    }

    let stockParsed = { ok: true as const, value: form.stock };
    if (variantInventoryMode !== "per-variant") {
      const sp = parseStrictInt(submittedRawNums.stock, { label: "Stanje", allowNegative: false, allowZero: true });
      if (!sp.ok) { toast.error("Greška", { description: sp.message }); return; }
      stockParsed = sp;
    }

    const weightParsed = parseStrictDecimal(submittedRawNums.weightDisplay, { label: "Težina", allowNegative: false, allowZero: false });
    if (!weightParsed.ok) { toast.error("Greška", { description: weightParsed.message }); return; }
    const weightGrams = weightUnit === "kg" ? Math.round(weightParsed.value * 1000) : Math.round(weightParsed.value);
    if (weightGrams <= 0) { toast.error("Greška", { description: "Težina je obavezna (u gramima ili kilogramima)." }); return; }

    const selectedCategory = availableCategories.find(c => c.id === form.categoryId);
    const crossSellCount = form.crossSellProductIds?.length ?? 0;
    if (crossSellCount !== 0 && (crossSellCount < 3 || crossSellCount > 5)) {
      toast.error("Greška", { description: "Često kupljeni proizvodi moraju biti prazni ili sadržati 3 do 5 proizvoda." }); return;
    }
    const minimumOrderQuantity = form.minimumOrderQuantity;
    if (!Number.isInteger(minimumOrderQuantity) || (minimumOrderQuantity ?? 0) < 1) {
      toast.error("Greška", { description: "Minimalna količina porudžbine mora biti ceo broj najmanje 1." }); return;
    }
    if (form.deliveryBusinessDaysOverride != null && (!Number.isInteger(form.deliveryBusinessDaysOverride) || form.deliveryBusinessDaysOverride < 1 || form.deliveryBusinessDaysOverride > 365)) {
      toast.error("Greška", { description: "Broj radnih dana do isporuke mora biti između 1 i 365." }); return;
    }
    if (form.subscriptionAllowed && (!Number.isInteger(form.subscriptionDiscountPercent) || (form.subscriptionDiscountPercent ?? 0) < 1 || (form.subscriptionDiscountPercent ?? 0) > 100)) {
      toast.error("Greška", { description: "Popust za pretplatu mora biti ceo broj između 1 i 100." }); return;
    }
    const tiers = form.quantityPricingTiers ?? [];
    for (let index = 0; index < tiers.length; index += 1) {
      const tier = tiers[index];
      if (!Number.isInteger(tier.minQuantity) || tier.minQuantity < 1 || !Number.isInteger(tier.unitPrice) || tier.unitPrice < 1 || (tier.maxQuantity != null && (!Number.isInteger(tier.maxQuantity) || tier.maxQuantity < tier.minQuantity))) {
        toast.error("Greška", { description: `Prag ${index + 1} mora imati pozitivne cele brojeve i ispravan raspon.` }); return;
      }
      if (tier.maxQuantity == null && index !== tiers.length - 1) {
        toast.error("Greška", { description: "Samo poslednji prag može biti bez gornje granice." }); return;
      }
    }
    const sortedTiers = [...tiers].sort((a, b) => a.minQuantity - b.minQuantity);
    for (let index = 1; index < sortedTiers.length; index += 1) {
      if (sortedTiers[index - 1].maxQuantity == null || sortedTiers[index].minQuantity <= sortedTiers[index - 1].maxQuantity!) {
        toast.error("Greška", { description: "Rasponi količinskih cena ne smeju da se preklapaju." }); return;
      }
    }

    const productForm = Object.fromEntries(
      Object.entries(form).filter(([key]) => key !== "market"),
    ) as AdminProductInput;
    const payload: AdminProductInput = {
      ...productForm,
      categoryName: selectedCategory ? selectedCategory.name : form.categoryName,
      professionalEnabled: form.market === "B2B" || form.market === "BOTH",
      retailEnabled: form.market === "B2C" || form.market === "BOTH",
      priceOnRequest: form.priceOnRequest,
      bulkMatrixEnabled: form.bulkMatrixEnabled,
      price: priceParsed.value,
      discountPrice: discountParsed.value,
      publicDescription: form.publicDescription?.trim() || null,
      publicPrice: publicPriceParsed.value,
      publicDiscountPrice: publicDiscountParsed.value,
      stock: variantInventoryMode === "per-variant" ? variantStockTotal : stockParsed.value,
      weightGrams,
      images: form.images?.length ? form.images : [form.imageUrl],
      brand: form.brand?.trim() || null,
      similarProductsMode: form.similarProductsMode ?? "AUTO_CATEGORY",
      similarProductIds: form.similarProductsMode === "MANUAL" ? (form.similarProductIds ?? []) : [],
      crossSellProductIds: form.crossSellProductIds ?? [],
      quantityPricingTiers: tiers,
      minimumOrderQuantity,
      deliveryBusinessDaysOverride: form.deliveryBusinessDaysOverride ?? null,
      subscriptionAllowed: form.subscriptionAllowed ?? false,
      subscriptionDiscountPercent: form.subscriptionAllowed ? (form.subscriptionDiscountPercent ?? null) : null,
      productTypeId: form.productTypeId || null,
      needTagIds: form.needTagIds || [],
      ingredients: form.ingredients?.trim() || null,
      usageInstructions: form.usageInstructions?.trim() || null,
      characteristics: form.characteristics || [],
      searchSynonyms: form.searchSynonyms || [],
      discountPriceEndsAt: form.discountPriceEndsAt || null,
      publicDiscountPriceEndsAt: (form as any).publicDiscountPriceEndsAt || null,
      loyaltyPricingExcluded: (form as any).loyaltyPricingExcluded ?? false,
    };
    if (!actionGuard.begin("save-product")) return;
    const opts = {
      onSuccess: (savedProduct: AdminProduct) => {
        const afterSave = () => {
          toast.success(editing ? "Sačuvano" : "Kreirano", { description: `Proizvod je uspešno ${editing ? "ažuriran" : "kreiran"}.` });
          queryClient.invalidateQueries({ queryKey: getAdminListProductsQueryKey() });
          onSaved();
          actionGuard.end("save-product");
        };

        if (hasUnsavedUpsells) {
          replaceUpsells.mutate(
            { productId: savedProduct.id, data: { alternativeProductIds: upsellIds } },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getGetPublicProductUpsellsQueryKey(savedProduct.id) });
                afterSave();
              },
              onError: (err) => {
                toast.error("Proizvod je sačuvan, ali Upsell alternative nisu ažurirane.");
                afterSave();
              }
            }
          );
        } else {
          afterSave();
        }
      },
      onError: (err: unknown) => {
        toast.error("Greška", { description: extractApiError(err, "Proizvod nije sačuvan.") });
        actionGuard.end("save-product");
      },
    };
    if (editing) updateProduct.mutate({ productId: editing.id, data: payload }, opts as any);
    else createProduct.mutate({ data: payload }, opts as any);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[760px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Izmeni proizvod" : "Novi proizvod"}</DialogTitle>
          <DialogDescription>Popunite podatke o B2B proizvodu. Polja sa * su obavezna.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* ── Dobavljač i Tržište ── */}
          <section className="space-y-4 border rounded-xl p-4">
            <h4 className="text-sm font-semibold text-foreground">Izvor proizvoda</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Dobavljač *</Label>
                <Select
                  value={form.supplierId || "__none__"}
                  onValueChange={(v) => {
                    const newSupplierId = v === "__none__" ? "" : v;
                    setForm({ ...form, supplierId: newSupplierId, categoryId: null, categoryName: "", similarProductIds: [], crossSellProductIds: [] });
                  }}
                  disabled={!!editing}
                >
                  <SelectTrigger><SelectValue placeholder="Izaberi dobavljača" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Izaberi —</SelectItem>
                    {suppliers.filter(s => s.active || s.id === form.supplierId).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Dostupnost (Tržište) *</Label>
                <Select
                  value={form.market}
                  onValueChange={(v) => setForm({ ...form, market: v as any })}
                  disabled={!form.supplierId}
                >
                  <SelectTrigger><SelectValue placeholder="Izaberi tržište" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="B2B">Samo B2B (saloni)</SelectItem>
                    {selectedSupplier?.scope !== "B2B" && <SelectItem value="B2C">Samo B2C (fizička lica)</SelectItem>}
                    {selectedSupplier?.scope !== "B2B" && <SelectItem value="BOTH">Oba (B2B i B2C)</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

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
                <SearchableCombobox
                  value={form.brand ?? ""}
                  onValueChange={(value) => setForm({ ...form, brand: value || null })}
                  options={brands.filter((brand) => brand.active || brand.name === form.brand).map((brand) => ({ value: brand.name, label: brand.name }))}
                  placeholder="Izaberi brend"
                  searchPlaceholder="Pretražite brendove..."
                  clearable
                  data-testid="select-product-brand"
                  footer={<div className="flex gap-2"><Input value={newBrandName} onChange={(event) => setNewBrandName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); createAndSelectBrand(); } }} placeholder="Naziv novog brenda" data-testid="input-new-brand" /><Button type="button" size="sm" onClick={createAndSelectBrand} disabled={!newBrandName.trim() || createBrand.isPending} data-testid="button-create-brand">{createBrand.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}<span className="sr-only">Kreiraj brend</span></Button></div>}
                />
              </div>
              <div className="space-y-2">
                <Label>SKU (šifra) *</Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="npr. WKP-001" data-testid="input-product-sku" />
              </div>
              {editing && (
                <div className="space-y-2">
                  <Label>Trajna kataloška referenca</Label>
                  <Input value={editing.catalogReference} readOnly disabled data-testid="input-product-catalog-reference" />
                  <p className="text-[11px] text-muted-foreground">Ova referenca se prikazuje kupcima i ne menja se sa SKU šifrom.</p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Kategorija *</Label>
                <Select
                  value={form.categoryId || "__none__"}
                  onValueChange={(v) => {
                    if (v === "__none__") { setForm({ ...form, categoryId: null, categoryName: "" }); return; }
                    setForm({ ...form, categoryId: v });
                  }}
                  disabled={!form.supplierId}
                >
                  <SelectTrigger data-testid="select-product-category"><SelectValue placeholder={form.supplierId ? "Izaberi kategoriju" : "Prvo izaberi dobavljača"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Izaberi —</SelectItem>
                    {availableCategories.sort((a,b) => a.sortOrder - b.sortOrder).map(c => {
                      // simple rendering for arbitrary depth: just show parent name if it exists, or full path if we build it.
                      // Let's build a quick path
                      let path = c.name;
                      let curr = c.parentId;
                      while (curr) {
                        const p = availableCategories.find(x => x.id === curr);
                        if (p) { path = `${p.name} > ${path}`; curr = p.parentId; }
                        else curr = null;
                      }
                      return <SelectItem key={c.id} value={c.id}>{path}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
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

              <div className="space-y-2 sm:col-span-2">
                <Label>Ključne reči / Sinonimi za pretragu (zarezom odvojeni)</Label>
                <Input
                  value={(form.searchSynonyms || []).join(", ")}
                  onChange={(e) => setForm({ ...form, searchSynonyms: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                  placeholder="Npr. krema, hidratacija, lice"
                />
              </div>

              <div className="space-y-3 sm:col-span-2 border rounded-lg p-3 bg-muted/20">
                <div className="flex justify-between items-center">
                  <Label>Karakteristike proizvoda</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setForm(f => ({ ...f, characteristics: [...(f.characteristics || []), { name: "", value: "" }] }))}>
                    + Dodaj karakteristiku
                  </Button>
                </div>
                {(form.characteristics || []).map((char, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input placeholder="Naziv (npr. Tip kože)" value={char.name} onChange={(e) => {
                      const newChars = [...(form.characteristics || [])];
                      newChars[i].name = e.target.value;
                      setForm({ ...form, characteristics: newChars });
                    }} />
                    <Input placeholder="Vrednost (npr. Suva koža)" value={char.value} onChange={(e) => {
                      const newChars = [...(form.characteristics || [])];
                      newChars[i].value = e.target.value;
                      setForm({ ...form, characteristics: newChars });
                    }} />
                    <Button type="button" variant="ghost" size="icon" className="text-destructive shrink-0" onClick={() => {
                      const newChars = [...(form.characteristics || [])];
                      newChars.splice(i, 1);
                      setForm({ ...form, characteristics: newChars });
                    }}><X className="w-4 h-4" /></Button>
                  </div>
                ))}
              </div>

              <div className="sm:col-span-2 rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div>
                  <p className="font-medium">Kanali prodaje</p>
                  <p className="mt-1 text-xs text-muted-foreground">Javne informacije su odvojene od B2B kataloga. Kupci i pretraživači vide samo opis i cene koje unesete ovde.</p>
                </div>
                {(form.market === "B2C" || form.market === "BOTH") && (
                  <>
                    <div className="space-y-2">
                      <Label>Javni opis za kupce *</Label>
                      <textarea
                        value={form.publicDescription ?? ""}
                        onChange={(event) => setForm({ ...form, publicDescription: event.target.value || null })}
                        placeholder="Opis bez B2B uslova, marži, SKU oznaka i internih napomena."
                        className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        data-testid="input-product-public-description"
                      />
                    </div>
                    {!form.priceOnRequest && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Javna redovna cena (RSD) *</Label>
                        <Input value={rawNums.publicPrice} inputMode="numeric" onChange={(event) => updateRawNums((current) => ({ ...current, publicPrice: event.target.value }))} data-testid="input-product-public-price" />
                      </div>
                      <div className="space-y-2">
                        <Label>Javna akcijska cena (RSD)</Label>
                        <Input value={rawNums.publicDiscountPrice} inputMode="numeric" onChange={(event) => updateRawNums((current) => ({ ...current, publicDiscountPrice: event.target.value }))} data-testid="input-product-public-discount-price" />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label>Rok akcije</Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {((form.market as string) === "B2B" || form.market === "BOTH") && <Input aria-label="B2B akcija traje do" type="datetime-local" value={form.discountPriceEndsAt ? form.discountPriceEndsAt.slice(0, 16) : ""} onChange={(e) => setForm({ ...form, discountPriceEndsAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />}
                          {(form.market === "B2C" || form.market === "BOTH") && <Input aria-label="B2C akcija traje do" type="datetime-local" value={(form as any).publicDiscountPriceEndsAt ? (form as any).publicDiscountPriceEndsAt.slice(0, 16) : ""} onChange={(e) => setForm({ ...form, publicDiscountPriceEndsAt: e.target.value ? new Date(e.target.value).toISOString() : null } as typeof form)} />}
                        </div>
                      </div>
                    </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>

          {/* ── Cena i popust ── */}
          <section className="space-y-4 border rounded-xl p-4">
            <h4 className="text-sm font-semibold text-foreground flex items-center justify-between">
              Cena i popust
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm font-normal">
                  <Switch checked={(form as any).loyaltyPricingExcluded} onCheckedChange={(c) => setForm({ ...form, loyaltyPricingExcluded: c } as any)} id="loyalty-excluded" />
                  <Label htmlFor="loyalty-excluded" className="cursor-pointer">Isključi iz Loyalty Popusta</Label>
                </div>
                <div className="flex items-center gap-2 text-sm font-normal">
                  <Switch checked={form.priceOnRequest} onCheckedChange={(c) => setForm({ ...form, priceOnRequest: c })} id="price-on-request" />
                  <Label htmlFor="price-on-request" className="cursor-pointer">Cena na upit (Price on request)</Label>
                </div>
              </div>
            </h4>
            {!form.priceOnRequest && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Redovna cena (RSD) *</Label>
                <Input type="number" min="0" step="1" value={rawNums.price} onChange={(e) => updateRawNums((current) => ({ ...current, price: e.target.value }))} data-testid="input-product-price" />
              </div>
              <div className="space-y-2">
                <Label>Akcijska cena (RSD)</Label>
                <Input
                  type="number" min="0"
                  value={rawNums.discountPrice}
                  onChange={(e) => updateRawNums((current) => ({ ...current, discountPrice: e.target.value }))}
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
            )}
          </section>

          {(form.market === "B2C" || form.market === "BOTH") && (
            <section className="space-y-4 border rounded-xl p-4 bg-primary/5 border-primary/20">
              <h4 className="text-sm font-semibold text-primary">B2C Otkrivanje i Sadržaj</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tip proizvoda (Otkrivanje)</Label>
                  <Select
                    value={form.productTypeId || "__none__"}
                    onValueChange={(v) => setForm({ ...form, productTypeId: v === "__none__" ? null : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Izaberi tip (npr. Šampon)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Bez tipa —</SelectItem>
                      {productTypes.filter(pt => pt.active || pt.id === form.productTypeId).map(pt => (
                        <SelectItem key={pt.id} value={pt.id}>{pt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Oznake potreba/problema</Label>
                  <SearchableMultiSelect
                    options={needTags.filter(nt => nt.active || (form.needTagIds || []).includes(nt.id)).map(nt => ({ value: nt.id, label: nt.label }))}
                    value={form.needTagIds || []}
                    onValueChange={(vals) => setForm({ ...form, needTagIds: vals })}
                    placeholder="Izaberi potrebe (npr. Suva kosa)"
                    searchPlaceholder="Pretraži potrebe..."
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Sastojci (INCI)</Label>
                  <textarea
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px]"
                    value={form.ingredients ?? ""}
                    onChange={(e) => setForm({ ...form, ingredients: e.target.value || null })}
                    placeholder="Lista sastojaka..."
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Uputstvo za upotrebu</Label>
                  <textarea
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px]"
                    value={form.usageInstructions ?? ""}
                    onChange={(e) => setForm({ ...form, usageInstructions: e.target.value || null })}
                    placeholder="Kako se koristi..."
                  />
                </div>
              </div>
            </section>
          )}

          {/* ── Zalihe i težina ── */}
          <section className="space-y-4 border rounded-xl p-4">
            <h4 className="text-sm font-semibold text-foreground">Zalihe i težina</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Stanje (kom) *</Label>
                <Input type="number" min="0" step="1" value={variantInventoryMode === "per-variant" ? variantStockTotal : rawNums.stock} disabled={variantInventoryMode === "per-variant"} onChange={(e) => updateRawNums((current) => ({ ...current, stock: e.target.value }))} data-testid="input-product-stock" />
                {variantInventoryMode === "per-variant" && <p className="text-xs text-muted-foreground">Automatski zbir zaliha varijanti.</p>}
              </div>
              <div className="space-y-2">
                <Label>Težina proizvoda *</Label>
                <div className="flex gap-2">
                  <Input
                    type="number" min="0" step={weightUnit === "kg" ? "0.01" : "1"}
                    value={rawNums.weightDisplay}
                    onChange={(e) => {
                      updateRawNums((current) => ({ ...current, weightDisplay: e.target.value }));
                    }}
                    data-testid="input-product-weight"
                  />
                  <Select value={weightUnit} onValueChange={(v) => {
                    const newUnit = v as "g" | "kg";
                    // Convert the currently displayed raw value to the new unit
                    const parsed = parseFloat(rawNums.weightDisplay);
                    if (!isNaN(parsed) && parsed > 0) {
                      const newDisplay = newUnit === "kg" ? String(parsed / 1000) : String(Math.round(parsed * 1000));
                      updateRawNums((current) => ({ ...current, weightDisplay: newDisplay }));
                    }
                    setWeightUnit(newUnit);
                  }}>
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
            <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3">
              <p className="text-sm text-muted-foreground">JPG, PNG, WEBP ili AVIF do 12 MB. Slike se automatski optimizuju.</p>
              <Button asChild type="button" variant="secondary" disabled={uploadingImages || (form.images?.length ?? 0) >= 12}>
                <label className="cursor-pointer">
                  {uploadingImages ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
                  Dodaj fotografije
                  <input className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" disabled={uploadingImages || (form.images?.length ?? 0) >= 12} onChange={(event) => void uploadImages(event)} />
                </label>
              </Button>
            </div>
            {(form.images ?? []).length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                {(form.images ?? []).map((url, idx) => (
                  <div key={`${url}-${idx}`} className={`relative rounded-lg border-2 overflow-hidden group ${form.imageUrl === url ? "border-primary" : "border-transparent"}`}>
                     <OptimizedImage src={url} alt={`Fotografija proizvoda ${idx + 1}`} width={320} height={320} preferredSize="thumbnail" responsiveSizes="160px" className="aspect-square object-cover w-full" />
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

          {/* ── Dokumenta (samo edit) ── */}
          {editing && (
            <section className="space-y-4 border rounded-xl p-4">
              <h4 className="text-sm font-semibold text-foreground">Dokumentacija</h4>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3">
                <p className="text-sm text-muted-foreground">PDF, DOCX do 12 MB. Vidljivo kupcima na stranici proizvoda.</p>
                <Button asChild type="button" variant="secondary" disabled={uploadingDocs}>
                  <label className="cursor-pointer">
                    {uploadingDocs ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    Dodaj dokument
                    <input className="sr-only" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={uploadingDocs} onChange={handleDocumentUpload} />
                  </label>
                </Button>
              </div>
              {documents.length > 0 && (
                <ul className="space-y-2 mt-4">
                  {documents.map(doc => (
                    <li key={doc.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{doc.displayName}</p>
                          <p className="text-xs text-muted-foreground uppercase">{doc.contentType === 'application/pdf' ? 'PDF' : 'DOCX'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" asChild>
                          <a href={doc.url} target="_blank" rel="noopener noreferrer"><Download className="w-4 h-4" /></a>
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" disabled={deleteDocument.isPending} onClick={async () => {
                          if (confirm("Brisanje dokumenta?")) {
                            await deleteDocument.mutateAsync({ documentId: doc.id });
                            refetchDocs();
                          }
                        }}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* ── Varijante ── */}
          <section className="space-y-4 border rounded-xl p-4">
            <h4 className="text-sm font-semibold text-foreground flex items-center justify-between">
              Varijante proizvoda
              <div className="flex items-center gap-2 text-sm font-normal">
                <Switch checked={form.bulkMatrixEnabled} onCheckedChange={(c) => setForm({ ...form, bulkMatrixEnabled: c })} id="bulk-matrix-enabled" />
                <Label htmlFor="bulk-matrix-enabled" className="cursor-pointer">Tabelarni (Bulk) unos količina</Label>
              </div>
            </h4>
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
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end border p-3 rounded-lg bg-muted/5">
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
              {variantInventoryMode === "per-variant" && (
                <div className="space-y-1">
                  <Label className="text-xs">Stanje</Label>
                  <Input type="number" min="0" step="1" value={variantDraft.stock ?? 0} onChange={(e) => setVariantDraft({ ...variantDraft, stock: Number(e.target.value) })} />
                </div>
              )}
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Swatch prikaz</Label>
                <div className="flex gap-2">
                  <Select value={variantDraft.swatch?.kind || "NONE"} onValueChange={(v) => {
                    if (v === "NONE") {
                      const { swatch, ...rest } = variantDraft;
                      setVariantDraft(rest as any);
                    } else {
                      setVariantDraft({ ...variantDraft, swatch: { kind: v as any } });
                    }
                  }}>
                    <SelectTrigger className="w-28"><SelectValue placeholder="Bez swatch-a" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Nema</SelectItem>
                      <SelectItem value="TEXT">Tekst</SelectItem>
                      <SelectItem value="COLOR">Boja (HEX)</SelectItem>
                      <SelectItem value="IMAGE">Slika</SelectItem>
                    </SelectContent>
                  </Select>
                  {variantDraft.swatch?.kind === "TEXT" && (
                    <Input value={variantDraft.swatch.text || ""} onChange={(e) => setVariantDraft({ ...variantDraft, swatch: { ...variantDraft.swatch!, text: e.target.value } })} placeholder="npr. 120ml" />
                  )}
                  {variantDraft.swatch?.kind === "COLOR" && (
                    <Input value={variantDraft.swatch.hex || ""} onChange={(e) => setVariantDraft({ ...variantDraft, swatch: { ...variantDraft.swatch!, hex: e.target.value } })} placeholder="#FF0000" />
                  )}
                  {variantDraft.swatch?.kind === "IMAGE" && (
                    <Input value={variantDraft.swatch.imageUrl || ""} onChange={(e) => setVariantDraft({ ...variantDraft, swatch: { ...variantDraft.swatch!, imageUrl: e.target.value } })} placeholder="URL slike" />
                  )}
                </div>
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Nova glavna slika (opciono)</Label>
                <Input value={variantDraft.mainImageUrl ?? ""} onChange={(e) => setVariantDraft({ ...variantDraft, mainImageUrl: e.target.value || undefined })} placeholder="Prikazaće se ova slika" />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Alt tekst (opciono)</Label>
                <Input value={variantDraft.altText ?? ""} onChange={(e) => setVariantDraft({ ...variantDraft, altText: e.target.value || undefined })} placeholder="Alt tekst" />
              </div>
              <div className="space-y-1">
                <Button type="button" size="sm" onClick={addVariant} className="w-full">
                  <Plus className="w-4 h-4 mr-1" /> Dodaj
                </Button>
              </div>
            </div>
            {form.variants?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border rounded-lg overflow-hidden">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="p-2 font-medium">Vrednost</th>
                      <th className="p-2 font-medium">Cena/Adjust</th>
                      <th className="p-2 font-medium">SKU</th>
                      <th className="p-2 font-medium">Swatch</th>
                      {variantInventoryMode === "per-variant" && <th className="p-2 font-medium">Stanje</th>}
                      <th className="p-2 font-medium w-16 text-right">Akcija</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.variants.map((v, i) => (
                      <tr key={i} className="border-t border-muted">
                        <td className="p-2">{v.value}</td>
                        <td className="p-2">{v.price != null ? `${v.price} RSD` : `${v.priceAdjust! > 0 ? '+' : ''}${v.priceAdjust} RSD`}</td>
                        <td className="p-2">{v.sku || "-"}</td>
                        <td className="p-2">
                          {v.swatch?.kind === "COLOR" && <div className="w-4 h-4 rounded-full border shadow-sm" style={{ backgroundColor: v.swatch.hex }} title={v.swatch.hex} />}
                          {v.swatch?.kind === "TEXT" && <Badge variant="outline">{v.swatch.text}</Badge>}
                          {v.swatch?.kind === "IMAGE" && <div className="w-6 h-6 bg-muted overflow-hidden rounded-full border shadow-sm"><img src={v.swatch.imageUrl} className="w-full h-full object-cover" /></div>}
                          {!v.swatch && "-"}
                        </td>
                        {variantInventoryMode === "per-variant" && <td className="p-2">{v.stock}</td>}
                        <td className="p-2 text-right">
                          <Button type="button" size="sm" variant="ghost" onClick={() => removeVariant(i)} className="h-6 w-6 p-0 text-destructive"><Trash2 className="w-4 h-4" /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-3 text-center text-sm text-muted-foreground border rounded-lg bg-muted/20">Nema dodatih varijanti.</div>
            )}
          </section>

          {/* ── Merchandising ── */}
          <section className="space-y-5 border rounded-xl p-4">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Slični proizvodi</h4>
              <p className="mt-1 text-xs text-muted-foreground">Odredite kako se biraju preporuke prikazane na stranici proizvoda.</p>
            </div>
            <RadioGroup
              value={form.similarProductsMode ?? "AUTO_CATEGORY"}
              onValueChange={(value) => setForm({ ...form, similarProductsMode: value as "AUTO_CATEGORY" | "MANUAL", similarProductIds: value === "MANUAL" ? (form.similarProductIds ?? []) : [] })}
              className="grid gap-3 sm:grid-cols-2"
              data-testid="radio-similar-products-mode"
            >
              <Label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal">
                <RadioGroupItem value="AUTO_CATEGORY" />
                <span><strong className="block">Automatski — ista kategorija</strong><span className="text-xs text-muted-foreground">Preporuke se biraju iz iste kategorije</span></span>
              </Label>
              <Label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal">
                <RadioGroupItem value="MANUAL" />
                <span><strong className="block">Ručno izabrani proizvodi</strong><span className="text-xs text-muted-foreground">Izaberite proizvode istog dobavljača</span></span>
              </Label>
            </RadioGroup>
            {form.similarProductsMode === "MANUAL" && (
              <SearchableMultiSelect
                value={form.similarProductIds ?? []}
                onValueChange={(similarProductIds) => setForm({ ...form, similarProductIds })}
                options={relatedProductOptions}
                placeholder={form.supplierId ? "Izaberite slične proizvode" : "Prvo izaberite dobavljača"}
                disabled={!form.supplierId}
                aria-label="Ručno izabrani slični proizvodi"
                data-testid="select-similar-products"
              />
            )}

            <div className="border-t pt-5">
              <h4 className="text-sm font-semibold text-foreground">Često kupljeno zajedno</h4>
              <p className="mt-1 mb-3 text-xs text-muted-foreground">Izaberite ili 0 proizvoda, ili između 3 i 5 proizvoda istog dobavljača.</p>
              <SearchableMultiSelect
                value={form.crossSellProductIds ?? []}
                onValueChange={(crossSellProductIds) => setForm({ ...form, crossSellProductIds })}
                options={relatedProductOptions}
                placeholder={form.supplierId ? "Izaberite proizvode" : "Prvo izaberite dobavljača"}
                disabled={!form.supplierId}
                maxSelected={5}
                aria-label="Često kupljeno zajedno"
                data-testid="select-cross-sell-products"
              />
              {(form.crossSellProductIds?.length ?? 0) > 0 && (form.crossSellProductIds?.length ?? 0) < 3 && (
                <p className="mt-2 text-xs text-destructive" data-testid="error-cross-sell-count">Izaberite još najmanje {3 - (form.crossSellProductIds?.length ?? 0)} proizvoda ili uklonite sve.</p>
              )}
            </div>

            <div className="border-t pt-5">
              <h4 className="text-sm font-semibold text-foreground">Upsell alternative (do 3 proizvoda)</h4>
              <p className="mt-1 mb-3 text-xs text-muted-foreground">Ovi proizvodi će biti predloženi kupcu pre dodavanja u korpu (npr. veće pakovanje). Poređajte ih po prioritetu.</p>
              <div className="space-y-3">
                <SearchableCombobox
                  value=""
                  onValueChange={(val) => {
                    if (val && !upsellIds.includes(val) && upsellIds.length < 3) {
                      setUpsellIds([...upsellIds, val]);
                      setHasUnsavedUpsells(true);
                    }
                  }}
                  options={relatedProductOptions.filter(o => !upsellIds.includes(o.value))}
                  placeholder={form.supplierId ? (upsellIds.length >= 3 ? "Maksimalno 3 alternative" : "Dodajte alternativu") : "Prvo izaberite dobavljača"}
                  searchPlaceholder="Pretraži..."
                  disabled={!form.supplierId || upsellIds.length >= 3}
                />
                {upsellIds.length > 0 && (
                  <div className="space-y-2">
                    {upsellIds.map((id, index) => {
                      const prodOpt = relatedProductOptions.find(o => o.value === id) || { label: "Učitavanje..." };
                      return (
                        <div key={id} className="flex items-center justify-between p-2 border rounded-md bg-muted/20">
                          <span className="text-sm font-medium">{index + 1}. {prodOpt.label}</span>
                          <div className="flex gap-1">
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={index === 0} onClick={() => {
                              const newArr = [...upsellIds];
                              [newArr[index], newArr[index - 1]] = [newArr[index - 1], newArr[index]];
                              setUpsellIds(newArr);
                              setHasUnsavedUpsells(true);
                            }}><ArrowUpDown className="w-3 h-3" /></Button>
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => {
                              setUpsellIds(upsellIds.filter(uid => uid !== id));
                              setHasUnsavedUpsells(true);
                            }}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

          </section>

          {/* ── Uslovi kupovine ── */}
          <section className="space-y-5 border rounded-xl p-4">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Količinske cene</h4>
              <p className="mt-1 text-xs text-muted-foreground">Definišite cenu po jedinici za nepreklapajuće raspone količina.</p>
            </div>
            {(form.quantityPricingTiers ?? []).length > 0 && (
              <div className="space-y-3">
                <div className="hidden grid-cols-[1fr_1fr_1.4fr_auto] gap-3 px-1 text-xs font-medium text-muted-foreground sm:grid">
                  <span>Od količine</span><span>Do količine</span><span>Cena po jedinici RSD</span><span className="sr-only">Akcija</span>
                </div>
                {(form.quantityPricingTiers ?? []).map((tier, index) => {
                  const updateTier = (patch: Partial<QuantityPricingTier>) => setForm({
                    ...form,
                    quantityPricingTiers: (form.quantityPricingTiers ?? []).map((current, currentIndex) => currentIndex === index ? { ...current, ...patch } : current),
                  });
                  return (
                    <div key={index} className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1.4fr_auto]" data-testid={`row-quantity-tier-${index}`}>
                      <Label className="space-y-1 text-xs sm:contents">
                        <span className="sm:sr-only">Od količine</span>
                        <Input type="number" min="1" step="1" value={tier.minQuantity || ""} onChange={(event) => updateTier({ minQuantity: Number(event.target.value) })} data-testid={`input-tier-min-${index}`} />
                      </Label>
                      <Label className="space-y-1 text-xs sm:contents">
                        <span className="sm:sr-only">Do količine (opciono)</span>
                        <Input type="number" min="1" step="1" value={tier.maxQuantity ?? ""} onChange={(event) => updateTier({ maxQuantity: event.target.value === "" ? null : Number(event.target.value) })} placeholder="Bez granice" data-testid={`input-tier-max-${index}`} />
                      </Label>
                      <Label className="space-y-1 text-xs sm:contents">
                        <span className="sm:sr-only">Cena po jedinici RSD</span>
                        <Input type="number" min="1" step="1" value={tier.unitPrice || ""} onChange={(event) => updateTier({ unitPrice: Number(event.target.value) })} data-testid={`input-tier-price-${index}`} />
                      </Label>
                      <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => setForm({ ...form, quantityPricingTiers: (form.quantityPricingTiers ?? []).filter((_, currentIndex) => currentIndex !== index) })} aria-label={`Ukloni prag ${index + 1}`} data-testid={`button-remove-tier-${index}`}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  );
                })}
              </div>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, quantityPricingTiers: [...(form.quantityPricingTiers ?? []), { minQuantity: 1, maxQuantity: null, unitPrice: 1 }] })} data-testid="button-add-quantity-tier"><Plus className="mr-2 h-4 w-4" />Dodaj prag</Button>

            <div className="grid grid-cols-1 gap-4 border-t pt-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Minimalna količina porudžbine *</Label>
                <Input type="number" min="1" step="1" value={form.minimumOrderQuantity ?? 1} onChange={(event) => setForm({ ...form, minimumOrderQuantity: Number(event.target.value) })} data-testid="input-minimum-order-quantity" />
              </div>
              <div className="space-y-2">
                <Label>Broj radnih dana do isporuke</Label>
                <Input type="number" min="1" max="365" step="1" value={form.deliveryBusinessDaysOverride ?? ""} onChange={(event) => setForm({ ...form, deliveryBusinessDaysOverride: event.target.value === "" ? null : Number(event.target.value) })} placeholder="Globalna vrednost" data-testid="input-delivery-days-override" />
                <p className="text-xs text-muted-foreground">Ostavite prazno da bi se koristila globalna vrednost.</p>
              </div>
            </div>

            <div className="space-y-4 border-t pt-5">
              <div className="flex items-center justify-between gap-4">
                <div><Label htmlFor="subscription-allowed">Dozvoli pretplatu</Label><p className="mt-1 text-xs text-muted-foreground">Kupci će moći da izaberu periodično naručivanje.</p></div>
                <Switch id="subscription-allowed" checked={form.subscriptionAllowed ?? false} onCheckedChange={(checked) => setForm({ ...form, subscriptionAllowed: checked, subscriptionDiscountPercent: checked ? form.subscriptionDiscountPercent : null })} data-testid="switch-subscription-allowed" />
              </div>
              {form.subscriptionAllowed && (
                <div className="max-w-xs space-y-2">
                  <Label>% popusta za pretplatu *</Label>
                  <Input type="number" min="1" max="100" step="1" value={form.subscriptionDiscountPercent ?? ""} onChange={(event) => setForm({ ...form, subscriptionDiscountPercent: event.target.value === "" ? null : Number(event.target.value) })} data-testid="input-subscription-discount" />
                </div>
              )}
            </div>
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
          <Button onClick={handleSave} disabled={isPending || actionGuard.isActive("save-product")} data-testid="btn-save-product">
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
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const urlParams = new URLSearchParams(searchString);
  const currentMarket = urlParams.get("market") === "B2C" ? "B2C" : "B2B";

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [lowStockFilter, setLowStockFilter] = useState(false);
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [brand, setBrand] = useState("");
  const [status, setStatus] = useState("");
  const [sortBy, setSortBy] = useState<NonNullable<AdminListProductsParams["sortBy"]>>("createdAt");
  const [sortDir, setSortDir] = useState<NonNullable<AdminListProductsParams["sortDir"]>>("desc");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, currentMarket]);

  const params: AdminListProductsParams = useMemo(() => ({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(supplierFilter !== "all" ? { supplierId: supplierFilter } : {}),
    market: currentMarket,
    ...(lowStockFilter ? { lowStock: true } : {}),
    ...(category ? { category } : {}),
    ...(subcategory ? { subcategory } : {}),
    ...(brand ? { brand } : {}),
    ...(status ? { status: status as NonNullable<AdminListProductsParams["status"]> } : {}),
    sortBy, sortDir, page, pageSize,
  }), [debouncedSearch, supplierFilter, currentMarket, lowStockFilter, category, subcategory, brand, status, sortBy, sortDir, page, pageSize]);

  const { data, isLoading, error } = useAdminListProducts(params);
  const { data: categories = [] } = useAdminListProductCategories();
  const { data: brands = [] } = useAdminListBrands();
  const { data: suppliers = [] } = useAdminListSuppliers();
  const deleteProduct = useAdminDeleteProduct();
  const bulkUpdate = useAdminBulkUpdateProducts();
  const actionGuard = useImmediateActionGuard();

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
    const actionKey = `delete:${deleteTarget.id}`;
    if (!actionGuard.begin(actionKey)) return;
    deleteProduct.mutate({ productId: deleteTarget.id }, {
      onSuccess: (result) => {
        toast.success(result.active === false && result.id === deleteTarget.id ? "Uklonjeno" : "Obrisano", {
          description: "Proizvod je obrisan ili deaktiviran (ako postoji u porudžbinama).",
        });
        invalidate();
        setDeleteTarget(null);
        actionGuard.end(actionKey);
      },
      onError: () => {
        toast.error("Greška", { description: "Proizvod nije obrisan." });
        actionGuard.end(actionKey);
      },
    });
  };

  const runBulk = () => {
    if (!bulkAction || selected.length === 0) return;
    if (!actionGuard.begin("bulk")) return;
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
        actionGuard.end("bulk");
      },
      onError: (err: unknown) => {
        toast.error("Greška", { description: extractApiError(err, "Masovna izmena nije uspela.") });
        actionGuard.end("bulk");
      },
    });
  };

  const allOnPageSelected = items.length > 0 && items.every((p) => selected.includes(p.id));

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">
              {currentMarket === "B2C" ? "B2C Proizvodi" : "B2B Proizvodi"}
            </h1>
            <p className="text-muted-foreground text-sm">
              Upravljanje proizvodima u {currentMarket === "B2C" ? "maloprodaji" : "profesionalnom shopu"}.
            </p>
          </div>
          <Button onClick={() => { setEditing(null); setModalOpen(true); }} className="shrink-0 gap-2" data-testid="btn-new-product">
            <Plus className="w-4 h-4" /> Novi proizvod
          </Button>
        </div>

        <div className="flex border-b">
          <Link
            href="/admin/proizvodi?market=B2B"
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${currentMarket === "B2B" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            B2B Proizvodi
          </Link>
          <Link
            href="/admin/proizvodi?market=B2C"
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${currentMarket === "B2C" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            B2C Proizvodi
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Pretraži po nazivu, SKU, brendu..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-products" />
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <Select value={supplierFilter} onValueChange={(v) => { setSupplierFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Dobavljač" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Svi dobavljači</SelectItem>
                {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={category || "__all__"} onValueChange={(v) => { setCategory(v === "__all__" ? "" : v); setSubcategory(""); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Kategorija" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Sve kategorije</SelectItem>
                {parents.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {subcats.length > 0 && (
              <Select value={subcategory || "__all__"} onValueChange={(v) => { setSubcategory(v === "__all__" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Podkategorija" /></SelectTrigger>
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
            <div className="flex items-center gap-2 pl-2">
              <label className="text-sm flex items-center gap-2 cursor-pointer">
                <Checkbox checked={lowStockFilter} onCheckedChange={(c) => { setLowStockFilter(!!c); setPage(1); }} />
                Slabo stanje
              </label>
            </div>
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
            <Button size="sm" onClick={runBulk} disabled={!bulkAction || bulkUpdate.isPending || actionGuard.isActive("bulk")} data-testid="btn-run-bulk">
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
                    <th className="p-3 font-medium" aria-sort={sortBy === "name" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" className="flex items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => toggleSort("name")}>
                        Proizvod <ArrowUpDown className="w-3 h-3 opacity-50" aria-hidden="true" />
                      </button>
                    </th>
                    <th className="p-3 font-medium hidden md:table-cell">Kategorija</th>
                    <th className="p-3 font-medium hidden lg:table-cell">SKU</th>
                    <th className="p-3 font-medium" aria-sort={sortBy === "price" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" className="flex items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => toggleSort("price")}>
                        Cena <ArrowUpDown className="w-3 h-3 opacity-50" aria-hidden="true" />
                      </button>
                    </th>
                    <th className="p-3 font-medium" aria-sort={sortBy === "stock" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" className="flex items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => toggleSort("stock")}>
                        Stanje <ArrowUpDown className="w-3 h-3 opacity-50" aria-hidden="true" />
                      </button>
                    </th>
                    <th className="p-3 font-medium hidden lg:table-cell">Težina</th>
                    <th className="p-3 font-medium hidden sm:table-cell">Status</th>
                    <th className="p-3 font-medium text-right">Akcije</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {items.map((p) => {
                    const sup = suppliers.find(s => s.id === p.supplierId);
                    return (
                    <tr key={p.id} className={`hover:bg-muted/10 transition-colors ${!p.active ? "opacity-50" : ""}`} data-testid={`product-row-${p.id}`}>
                      <td className="p-3">
                        <Checkbox checked={selected.includes(p.id)} onCheckedChange={(c) => setSelected(c ? [...selected, p.id] : selected.filter((id) => id !== p.id))} />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <img src={p.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium line-clamp-1">{p.name}</p>
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {sup ? <span className="font-medium text-foreground">{sup.name}</span> : "Nepoznat"}
                              {p.brand ? ` · ${p.brand}` : ""}
                              {p.variants?.length ? ` · ${p.variants.length} var.` : ""}
                            </p>
                            <div className="flex gap-1 mt-1">
                              {p.professionalEnabled && <Badge variant="outline" className="text-[9px] h-4 px-1 border-emerald-500/30 text-emerald-600 bg-emerald-500/5">B2B</Badge>}
                              {p.retailEnabled && <Badge variant="outline" className="text-[9px] h-4 px-1 border-sky-500/30 text-sky-600 bg-sky-500/5">B2C</Badge>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <p className="text-xs">{p.categoryName}</p>
                        {p.subcategoryName && <p className="text-xs text-muted-foreground">{p.subcategoryName}</p>}
                      </td>
                      <td className="p-3 hidden lg:table-cell text-xs font-mono">
                        <div>{p.sku}</div>
                        <div className="mt-1 text-muted-foreground">Ref: {p.catalogReference}</div>
                      </td>
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
                          {p.professionalEnabled && <Badge className="bg-slate-700 text-white border-none text-[10px]">Profesionalci</Badge>}
                          {p.retailEnabled && <Badge className="bg-emerald-600 text-white border-none text-[10px]">Kućna nega</Badge>}
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
                    );
                  })}
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
            <Button variant="destructive" onClick={handleDelete} disabled={deleteProduct.isPending || (deleteTarget ? actionGuard.isActive(`delete:${deleteTarget.id}`) : false)} data-testid="btn-confirm-delete">
              {deleteProduct.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Obriši
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
