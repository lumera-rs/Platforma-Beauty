import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import {
  useListProducts,
  useListProductCategories,
  useGetShopSummary,
  useCreateOrder,
  useGetCurrentUser,
  useGetShippingQuote,
  getGetShippingQuoteQueryKey,
  getGetShopSummaryQueryKey,
} from "@workspace/api-client-react";
import type { Product, ProductCategory, ProductCategorySubcategoriesItem } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ShoppingCart, Package, Star, Loader2, Search, X,
  ChevronDown, ChevronRight, Tag, Sparkles, Flame, Eye
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
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

// ─── Types ─────────────────────────────────────────────────────────────────

type CartItem = { id: string; qty: number; variantValue?: string };
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
  const effectivePrice =
    (product.variants?.find((v) => v.value === selectedVariant)?.priceAdjust ?? 0) +
    (product.discountPrice ?? product.price);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-serif">{product.name}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4 mt-2">
          <img
            src={product.imageUrl}
            alt={product.name}
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
            <Button variant="outline" onClick={onClose}>Zatvori</Button>
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
        <img
          src={product.imageUrl}
          alt={product.name}
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
        <h3 className="font-semibold text-sm leading-tight line-clamp-2 mt-0.5">{product.name}</h3>

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
  const { data: allProducts = [], isLoading: isLoadingProd } = useListProducts();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const { toast } = useToast();
  const orderMutation = useCreateOrder();

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

  // Derive brands from products
  const brands = useMemo(() => {
    const set = new Set<string>();
    allProducts.forEach((p) => { if (p.brand) set.add(p.brand); });
    return Array.from(set).sort();
  }, [allProducts]);

  // Filter products client-side for instant feedback
  const filtered = useMemo(() => {
    let list = allProducts;
    if (filters.tab === "akcije") list = list.filter((p) => p.discountPrice != null);
    if (filters.tab === "bestsellers") list = list.filter((p) => p.isBestseller);
    if (filters.category) list = list.filter((p) => p.category === filters.category);
    if (filters.subcategory) list = list.filter((p) => p.subcategory === filters.subcategory);
    if (filters.brand) list = list.filter((p) => p.brand?.toLowerCase() === filters.brand.toLowerCase());
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter((p) => `${p.name} ${p.description} ${p.brand ?? ""}`.toLowerCase().includes(q));
    }
    if (filters.onSale) list = list.filter((p) => p.discountPrice != null);
    if (filters.isNew) list = list.filter((p) => p.isNew);
    if (filters.isBestseller) list = list.filter((p) => p.isBestseller);
    return list;
  }, [allProducts, filters]);

  const addToCart = (id: string, variantValue?: string) => {
    setCart((prev) => {
      const key = `${id}-${variantValue ?? ""}`;
      const existing = prev.find((i) => `${i.id}-${i.variantValue ?? ""}` === key);
      if (existing) return prev.map((i) => (`${i.id}-${i.variantValue ?? ""}` === key ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { id, qty: 1, variantValue }];
    });
    toast.success("Dodato u korpu");
  };

  const cartTotal = cart.reduce((sum, item) => {
    const prod = allProducts.find((p) => p.id === item.id);
    if (!prod) return sum;
    const variantAdjust = prod.variants?.find((v) => v.value === item.variantValue)?.priceAdjust ?? 0;
    const base = prod.discountPrice ?? prod.price;
    return sum + (base + variantAdjust) * item.qty;
  }, 0);

  const cartWeightGrams = cart.reduce((sum, item) => {
    const prod = allProducts.find((p) => p.id === item.id);
    return sum + (prod?.weightGrams ?? 0) * item.qty;
  }, 0);

  const { data: shippingQuote } = useGetShippingQuote(
    { weightGrams: cartWeightGrams, subtotal: cartTotal },
    { query: { queryKey: getGetShippingQuoteQueryKey({ weightGrams: cartWeightGrams, subtotal: cartTotal }), enabled: cart.length > 0 } }
  );
  const shippingCost = shippingQuote?.shippingCost ?? 0;
  const orderTotal = cartTotal + shippingCost;

  const placeOrder = () => {
    if (cart.length === 0) return;
    orderMutation.mutate(
      {
        data: {
          items: cart.map((c) => ({ productId: c.id, quantity: c.qty, ...(c.variantValue ? { variantValue: c.variantValue } : {}) })),
          shippingName: `${userResp?.user?.firstName ?? ""} ${userResp?.user?.lastName ?? ""}`.trim(),
          shippingAddress: "Adresa salona",
          paymentMethod: "CASH_ON_DELIVERY",
        },
      },
      {
        onSuccess: () => {
          toast.success("Porudžbina uspešno poslata!");
          setCart([]);
        },
      }
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
                    {isLoadingProd ? "Učitavanje..." : `${filtered.length} proizvoda`}
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
                ) : filtered.length === 0 ? (
                  <div className="py-24 text-center text-muted-foreground">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">Nema proizvoda koji odgovaraju filterima.</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
                      Obriši filtere
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filtered.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        onAdd={addToCart}
                        onQuickView={setQuickViewProduct}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Cart widget */}
              <div className="w-64 flex-shrink-0 hidden xl:block">
                <Card className="sticky top-24">
                  <CardHeader className="bg-muted/30 border-b pb-4">
                    <CardTitle className="text-base flex items-center justify-between">
                      Vaša korpa
                      <Badge variant="secondary">{cart.reduce((s, i) => s + i.qty, 0)}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 min-h-[140px] max-h-[350px] overflow-y-auto">
                    {cart.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8 flex flex-col items-center">
                        <Package className="w-8 h-8 opacity-20 mb-2" />
                        <p className="text-xs">Korpa je prazna</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {cart.map((item) => {
                          const p = allProducts.find((prod) => prod.id === item.id);
                          if (!p) return null;
                          const varAdj = p.variants?.find((v) => v.value === item.variantValue)?.priceAdjust ?? 0;
                          const unitPrice = (p.discountPrice ?? p.price) + varAdj;
                          return (
                            <div key={`${item.id}-${item.variantValue}`} className="flex justify-between items-start text-xs border-b pb-1.5">
                              <div className="pr-1 flex-1 min-w-0">
                                <span className="font-medium line-clamp-1 block">{p.name}</span>
                                {item.variantValue && (
                                  <span className="text-muted-foreground text-[10px]">{item.variantValue}</span>
                                )}
                                <span className="text-muted-foreground">{item.qty}×</span>
                              </div>
                              <span className="font-semibold whitespace-nowrap text-primary">
                                {(unitPrice * item.qty).toLocaleString("sr-RS")} RSD
                              </span>
                            </div>
                          );
                        })}
                        <div className="pt-2 space-y-1.5 text-xs" data-testid="cart-shipping-info">
                          <div className="flex justify-between text-muted-foreground">
                            <span>Međuzbir:</span>
                            <span>{cartTotal.toLocaleString("sr-RS")} RSD</span>
                          </div>
                          {shippingQuote && (
                            <>
                              <div className="flex justify-between text-muted-foreground">
                                <span>Težina pošiljke:</span>
                                <span>
                                  {shippingQuote.totalWeightGrams >= 1000
                                    ? `${(shippingQuote.totalWeightGrams / 1000).toLocaleString("sr-RS", { maximumFractionDigits: 2 })} kg`
                                    : `${shippingQuote.totalWeightGrams} g`}
                                </span>
                              </div>
                              <div className="flex justify-between text-muted-foreground">
                                <span>Dostava:</span>
                                {shippingQuote.freeShipping ? (
                                  <span className="text-green-600 font-semibold">Besplatna</span>
                                ) : (
                                  <span>{shippingQuote.shippingCost.toLocaleString("sr-RS")} RSD</span>
                                )}
                              </div>
                              {shippingQuote.message && (
                                <p className={`text-[10px] rounded-md px-2 py-1.5 ${shippingQuote.freeShipping ? "bg-green-50 text-green-700 border border-green-200" : "bg-primary/5 text-primary border border-primary/20"}`}>
                                  {shippingQuote.message}
                                </p>
                              )}
                            </>
                          )}
                          <div className="pt-1 flex justify-between items-center font-bold text-sm border-t">
                            <span>Ukupno:</span>
                            <span className="text-primary" data-testid="cart-order-total">{orderTotal.toLocaleString("sr-RS")} RSD</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="p-3 border-t bg-muted/10">
                    <Button
                      className="w-full text-sm"
                      disabled={cart.length === 0 || orderMutation.isPending}
                      onClick={placeOrder}
                    >
                      {orderMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <ShoppingCart className="w-4 h-4 mr-2" />
                      )}
                      Poruči
                    </Button>
                  </CardFooter>
                </Card>
              </div>
            </div>

            {/* Mobile Cart Button */}
            {cart.length > 0 && (
              <div className="xl:hidden fixed bottom-6 right-6 z-50">
                <Button size="lg" className="rounded-full shadow-lg gap-2" onClick={placeOrder} disabled={orderMutation.isPending}>
                  <ShoppingCart className="w-5 h-5" />
                  {cart.reduce((s, i) => s + i.qty, 0)} stavki — {orderTotal.toLocaleString("sr-RS")} RSD
                </Button>
              </div>
            )}
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
