import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Link } from "wouter";
import {
  useListProducts,
  useListProductBrands,
  useListProductCategories,
  useGetShopSummary,
  useAddShopCartItem,
  useGetCurrentUser,
  getGetShopCartQueryKey,
  getGetShopSummaryQueryKey,
} from "@workspace/api-client-react";
import type { Product, ProductCategory, ProductCategorySubcategoriesItem, ListProductsParams } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ShoppingCart, Package, Star, Loader2, Search, X,
  ChevronDown, ChevronLeft, ChevronRight, Tag, Sparkles, Flame, Eye
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState, useMemo, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OptimizedImage } from "@/components/optimized-image";

// ─── Types ─────────────────────────────────────────────────────────────────

type FilterState = {
  category: string;
  subcategory: string;
  brand: string;
  search: string;
  onSale: boolean;
  isNew: boolean;
  isBestseller: boolean;
  tab: "all" | "akcije" | "bestsellers";
};

// ─── Quick View Dialog ─────────────────────────────────────────────────────

function QuickView({
  product,
  onClose,
  onAdd,
}: {
  product: Product;
  onClose: () => void;
  onAdd: (id: string, variant?: string) => void;
}) {
  const [selectedVariant, setSelectedVariant] = useState(
    product.variants?.find((variant) => variant.stock === undefined || variant.stock > 0)?.value ?? ""
  );
  const selected = product.variants?.find((v) => v.value === selectedVariant);
  const effectivePrice = selected?.price ?? ((product.discountPrice ?? product.price) + (selected?.priceAdjust ?? 0));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-serif">{product.name}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4 mt-2">
          <OptimizedImage
            src={product.imageUrl}
            alt={product.name}
            width={144}
            height={144}
            preferredSize="medium"
            responsiveSizes="144px"
            className="w-36 h-36 object-cover rounded-xl flex-shrink-0"
          />
          <div className="flex flex-col gap-2 flex-1">
            {product.brand && (
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                {product.brand}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{product.subcategory ?? product.category}</span>
            <p className="text-sm text-muted-foreground line-clamp-4">{product.description}</p>
            {product.variants && product.variants.length > 0 && (
              <div className="mt-1">
                <label className="text-xs font-medium mb-1 block text-muted-foreground">
                  {product.variants[0]?.label}
                </label>
                <div className="flex flex-wrap gap-1">
                  {product.variants.map((v) => (
                    <button
                      key={v.value}
                      disabled={v.stock !== undefined && v.stock <= 0}
                      onClick={() => setSelectedVariant(v.value)}
                      className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                        selectedVariant === v.value
                          ? "border-primary bg-primary/10 text-primary font-semibold"
                          : "border-border text-muted-foreground hover:border-primary/60"
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {v.value}{v.stock !== undefined && v.stock <= 0 ? " (nema)" : ""}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-end justify-between mt-4 pt-4 border-t">
          <div>
            {product.discountPrice && (
              <span className="text-xs text-muted-foreground line-through block">
                {product.price.toLocaleString("sr-RS")} RSD
              </span>
            )}
            <span className="text-2xl font-bold text-primary">
              {effectivePrice.toLocaleString("sr-RS")} RSD
            </span>
            <span className="text-xs text-muted-foreground ml-1">/{product.unit}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link href={`/vlasnik/shop/proizvodi/${product.id}`}>Detalji</Link></Button>
            <Button
              disabled={(product.variants?.length ?? 0) > 0 && !selectedVariant}
              onClick={() => {
                onAdd(product.id, selectedVariant || undefined);
                onClose();
              }}
              className="gap-2"
            >
              <ShoppingCart className="w-4 h-4" /> Dodaj u korpu
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Product Card ──────────────────────────────────────────────────────────

function ProductCard({
  product,
  onAdd,
  onQuickView,
}: {
  product: Product;
  onAdd: (id: string, variant?: string) => void;
  onQuickView: (p: Product) => void;
}) {
  return (
    <Card className="overflow-hidden group flex flex-col relative">
      {/* Badges */}
      <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
        {product.discountPercent && (
          <Badge className="bg-destructive hover:bg-destructive text-white border-none text-xs">
            -{product.discountPercent}%
          </Badge>
        )}
        {product.isNew && (
          <Badge className="bg-sky-500 hover:bg-sky-500 text-white border-none text-xs">
            Novo
          </Badge>
        )}
        {product.isBestseller && (
          <Badge className="bg-amber-500 hover:bg-amber-500 text-white border-none text-xs">
            <Flame className="w-3 h-3 mr-0.5" />Bestseller
          </Badge>
        )}
      </div>

      {/* Image */}
      <div className="aspect-square bg-muted relative overflow-hidden">
        <OptimizedImage
          src={product.imageUrl}
          alt={product.name}
          width={400}
          height={400}
          preferredSize="medium"
          responsiveSizes="(max-width: 640px) calc(100vw - 2rem), (max-width: 768px) 45vw, (max-width: 1280px) 30vw, 220px"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        {/* Quick View overlay */}
        <button
          onClick={() => onQuickView(product)}
          className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white text-sm font-medium"
        >
          <Eye className="w-4 h-4" /> Brz pregled
        </button>
      </div>

      <CardContent className="p-4 flex-1 flex flex-col gap-1">
        {product.brand && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {product.brand}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">{product.subcategory ?? product.category}</span>
        <h3 className="font-semibold text-sm leading-tight line-clamp-2 mt-0.5"><Link className="hover:text-primary" href={`/vlasnik/shop/proizvodi/${product.id}`}>{product.name}</Link></h3>

        {/* Variants preview */}
        {product.variants && product.variants.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {product.variants.slice(0, 3).map((v) => (
              <span key={v.value} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {v.value}
              </span>
            ))}
            {product.variants.length > 3 && (
              <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                +{product.variants.length - 3}
              </span>
            )}
          </div>
        )}

        <div className="mt-auto pt-2 flex items-end justify-between">
          <div>
            {product.discountPrice ? (
              <>
                <span className="text-xs text-muted-foreground line-through block">
                  {product.price.toLocaleString("sr-RS")} RSD
                </span>
                <span className="font-bold text-primary">{product.discountPrice.toLocaleString("sr-RS")} RSD</span>
              </>
            ) : (
              <span className="font-bold">{product.price.toLocaleString("sr-RS")} RSD</span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">/{product.unit}</span>
        </div>
      </CardContent>

      <CardFooter className="p-4 pt-0 gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-shrink-0"
          onClick={() => onQuickView(product)}
        >
          <Eye className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          className="flex-1 gap-1"
          onClick={() => {
            if (product.variants && product.variants.length > 0) {
              onQuickView(product);
            } else {
              onAdd(product.id);
            }
          }}
        >
          <ShoppingCart className="w-3.5 h-3.5" /> Dodaj
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─── Category Sidebar ─────────────────────────────────────────────────────

function CategorySidebar({
  categories,
  filters,
  setFilters,
}: {
  categories: ProductCategory[];
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
}) {
  const [expanded, setExpanded] = useState<string[]>(
    filters.category ? [categories.find((c) => c.name === filters.category)?.id ?? ""] : []
  );

  const toggle = (id: string) =>
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectParent = (name: string) => {
    setFilters((f) => ({ ...f, category: f.category === name ? "" : name, subcategory: "" }));
  };

  const selectSub = (parentName: string, subName: string) => {
    setFilters((f) => ({
      ...f,
      category: parentName,
      subcategory: f.subcategory === subName ? "" : subName,
    }));
  };

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => setFilters((f) => ({ ...f, category: "", subcategory: "" }))}
        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
          !filters.category ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"
        }`}
      >
        Sve kategorije
      </button>
      {categories.map((cat) => {
        const isExpanded = expanded.includes(cat.id);
        const isActive = filters.category === cat.name;
        return (
          <div key={cat.id}>
            <div className="flex items-center">
              <button
                onClick={() => selectParent(cat.name)}
                className={`flex-1 text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  isActive ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"
                }`}
              >
                {cat.icon && <span className="mr-2">{cat.icon}</span>}
                {cat.name}
              </button>
              {cat.subcategories.length > 0 && (
                <button
                  onClick={() => toggle(cat.id)}
                  className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              )}
            </div>
            {isExpanded && cat.subcategories.length > 0 && (
              <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
                {cat.subcategories.map((sub: ProductCategorySubcategoriesItem) => (
                  <button
                    key={sub.id}
                    onClick={() => selectSub(cat.name, sub.name)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                      filters.subcategory === sub.name
                        ? "text-primary font-semibold bg-primary/5"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {sub.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Shop Page ────────────────────────────────────────────────────────

export default function OwnerShop() {
  const { data: userResp } = useGetCurrentUser();
  const { data: categoryTree = [], isLoading: isLoadingCats } = useListProductCategories();
  const { data: summary, isLoading: isLoadingSum } = useGetShopSummary({
    query: { enabled: !!userResp?.user, queryKey: getGetShopSummaryQueryKey() },
  });
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const addCartItem = useAddShopCartItem();

  const [filters, setFilters] = useState<FilterState>({
    category: "",
    subcategory: "",
    brand: "",
    search: "",
    onSale: false,
    isNew: false,
    isBestseller: false,
    tab: "all",
  });
  const [page, setPage] = useState(1);
  const pageSize = 24;

  // Filtering, ordering and pagination now happen server-side so every product
  // stays reachable via the Previous/Next controls regardless of catalog size.
  const productParams = useMemo<ListProductsParams>(() => {
    const params: ListProductsParams = { page, pageSize };
    if (filters.category) params.category = filters.category;
    if (filters.subcategory) params.subcategory = filters.subcategory;
    if (filters.brand) params.brand = filters.brand;
    if (filters.search) params.search = filters.search;
    if (filters.onSale || filters.tab === "akcije") params.onSale = true;
    if (filters.isNew) params.isNew = true;
    if (filters.isBestseller || filters.tab === "bestsellers") params.isBestseller = true;
    return params;
  }, [filters, page]);

  const { data: productList, isLoading: isLoadingProd } = useListProducts(productParams);
  const products = productList?.items ?? [];
  const total = productList?.total ?? 0;
  const totalPages = productList?.totalPages ?? 1;

  // Brands are loaded from their own endpoint so the dropdown is not limited to
  // the products on the current page.
  const { data: brandRecords = [] } = useListProductBrands();
  const brands = useMemo(
    () => Array.from(new Set(brandRecords.map((b) => b.name))).sort(),
    [brandRecords],
  );

  // Reset to the first page whenever the active filters change so the user never
  // lands on an out-of-range page.
  useEffect(() => {
    setPage(1);
  }, [
    filters.category,
    filters.subcategory,
    filters.brand,
    filters.search,
    filters.onSale,
    filters.isNew,
    filters.isBestseller,
    filters.tab,
  ]);

  const addToCart = (id: string, variantValue?: string) => {
    addCartItem.mutate(
      { data: { productId: id, ...(variantValue ? { variantValue } : {}) } },
      {
        onSuccess: (cart) => {
          queryClient.setQueryData(getGetShopCartQueryKey(), cart);
          queryClient.invalidateQueries({ queryKey: getGetShopSummaryQueryKey() });
          toast.success("Dodato u korpu");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Dodavanje u korpu nije uspelo."),
      },
    );
  };

  const activeFilterCount = [
    filters.onSale, filters.isNew, filters.isBestseller,
    !!filters.brand, !!filters.category,
  ].filter(Boolean).length;

  const clearFilters = () =>
    setFilters({ category: "", subcategory: "", brand: "", search: "", onSale: false, isNew: false, isBestseller: false, tab: "all" });

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row gap-8 items-start">
          {/* ── Sidebar ─────────────────────────── */}
          <OwnerSidebar current="/vlasnik/shop" />

          {/* ── Main content ────────────────────── */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* Header */}
            <div>
              <h1 className="text-3xl font-serif font-bold">B2B Profesionalna Oprema</h1>
              <p className="text-muted-foreground">Kupujte materijale po povlašćenim cenama za partnere</p>
            </div>

            {/* Loyalty Banner */}
            {!isLoadingSum && summary && (
              <div className="bg-primary text-primary-foreground p-6 rounded-2xl flex flex-col md:flex-row justify-between items-center gap-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-10">
                  <Star className="w-32 h-32" />
                </div>
                <div className="relative z-10">
                  <Badge variant="outline" className="border-primary-foreground/30 text-primary-foreground mb-3 bg-primary-foreground/10">
                    Vaš status
                  </Badge>
                  <h2 className="text-2xl font-bold mb-1">{summary.currentTier} Nivo</h2>
                  <p className="text-primary-foreground/80">
                    Imate {summary.subscriptionDiscount}% popusta zbog vašeg nivoa partnerstva.
                  </p>
                </div>
                <div className="relative z-10 text-right">
                  <div className="text-sm text-primary-foreground/80 mb-1">Mesečna potrošnja</div>
                  <div className="text-3xl font-bold">{summary.monthlySpend.toLocaleString("sr-RS")} RSD</div>
                  {summary.amountToNextTier > 0 && (
                    <div className="text-sm mt-1 text-primary-foreground/90">
                      Fali {summary.amountToNextTier.toLocaleString("sr-RS")} RSD do sledećeg nivoa
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab bar */}
            <div className="flex gap-2 border-b pb-0">
              {(["all", "akcije", "bestsellers"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setFilters((f) => ({ ...f, tab }))}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                    filters.tab === tab
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "all" && "Svi proizvodi"}
                  {tab === "akcije" && <span className="flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" />Akcije</span>}
                  {tab === "bestsellers" && <span className="flex items-center gap-1.5"><Flame className="w-3.5 h-3.5" />Bestsellers</span>}
                </button>
              ))}
            </div>

            {/* Search + filters row */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Pretraži po imenu, brendu, opisu..."
                  value={filters.search}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                  className="pl-9"
                />
              </div>
              <Select value={filters.brand || "__all__"} onValueChange={(v) => setFilters((f) => ({ ...f, brand: v === "__all__" ? "" : v }))}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Svi brendovi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Svi brendovi</SelectItem>
                  {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-2 flex-wrap">
                {([["onSale", "Akcija"], ["isNew", "Novo"], ["isBestseller", "Bestseller"]] as const).map(([key, label]) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={filters[key] ? "default" : "outline"}
                    onClick={() => setFilters((f) => ({ ...f, [key]: !f[key] }))}
                    className="text-xs"
                  >
                    {key === "onSale" && <Tag className="w-3 h-3 mr-1" />}
                    {key === "isNew" && <Sparkles className="w-3 h-3 mr-1" />}
                    {key === "isBestseller" && <Flame className="w-3 h-3 mr-1" />}
                    {label}
                  </Button>
                ))}
                {activeFilterCount > 0 && (
                  <Button size="sm" variant="ghost" onClick={clearFilters} className="text-xs text-muted-foreground">
                    <X className="w-3 h-3 mr-1" />Obriši filtere ({activeFilterCount})
                  </Button>
                )}
              </div>
            </div>

            {/* Grid: category sidebar + products + cart */}
            <div className="flex gap-6">
              {/* Category tree */}
              <div className="w-52 flex-shrink-0 hidden lg:block">
                {!isLoadingCats && (
                  <div className="sticky top-24 bg-muted/20 rounded-xl p-3 border">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3 mb-2">Kategorije</p>
                    <CategorySidebar categories={categoryTree} filters={filters} setFilters={setFilters} />
                  </div>
                )}
              </div>

              {/* Product grid */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-muted-foreground">
                    {isLoadingProd ? "Učitavanje..." : `${total} proizvoda`}
                    {(filters.category || filters.subcategory) && (
                      <span className="ml-1 font-medium text-foreground">
                        — {filters.subcategory || filters.category}
                      </span>
                    )}
                  </span>
                </div>
                {isLoadingProd ? (
                  <div className="py-24 flex justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : products.length === 0 ? (
                  <div className="py-24 text-center text-muted-foreground">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">Nema proizvoda koji odgovaraju filterima.</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
                      Obriši filtere
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                      {products.map((product) => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          onAdd={addToCart}
                          onQuickView={setQuickViewProduct}
                        />
                      ))}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-center gap-4 mt-8">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft className="w-4 h-4 mr-1" />
                          Prethodna
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Strana {page} od {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page >= totalPages}
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Sledeća
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Quick View */}
      {quickViewProduct && (
        <QuickView
          product={quickViewProduct}
          onClose={() => setQuickViewProduct(null)}
          onAdd={addToCart}
        />
      )}
    </BusinessLayout>
  );
}
