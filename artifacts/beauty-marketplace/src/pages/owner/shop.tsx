import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Link, useRoute } from "wouter";
import {
  useListSupplierProducts,
  useListSupplierCategories,
  useGetShopSummary,
  useAddShopCartItem,
  useGetCurrentUser,
  useListPublicSuppliers,
  useGetPublicSupplier,
  getGetShopCartQueryKey,
  getGetShopSummaryQueryKey,
  getGetPublicSupplierQueryKey,
  getListSupplierProductsQueryKey,
  getListSupplierCategoriesQueryKey,
  useListShopBundles,
  useGetShopBundle,
  getListShopBundlesQueryKey,
  getGetShopBundleQueryKey,
} from "@workspace/api-client-react";
import type { Product, ProductCategory, ListSupplierProductsParams, Supplier, Bundle, BundleComponentCard } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ShoppingCart, Package, Star, Loader2, Search, X,
  ChevronDown, ChevronRight, Tag, Sparkles, Flame, Eye, Building2, ChevronLeft
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
import { OptimizedImage } from "@/components/optimized-image";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { addOptimisticCartItem, updateCartAndSummaryOptimistically } from "@/lib/optimistic-cart";
import { rollbackQueries } from "@/lib/optimistic-query";
import { SHOP_CART_MUTATION_KEY, shopCartMutationQueue, useMutationQueueBusy } from "@/lib/optimistic-mutation-queue";

type FilterState = {
  categoryId: string;
  brand: string;
  search: string;
};

function QuickView({ product, supplierSlug, onClose, onAdd, cartBusy }: { product: Product; supplierSlug: string; onClose: () => void; onAdd: (id: string, variant?: string) => void; cartBusy: boolean; }) {
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
          <OptimizedImage src={product.imageUrl} alt={product.name} width={144} height={144} preferredSize="medium" className="w-36 h-36 object-cover rounded-xl flex-shrink-0 bg-muted" />
          <div className="flex flex-col gap-2 flex-1">
            {product.brand && <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">{product.brand}</span>}
            <span className="text-xs text-muted-foreground">{product.subcategory ?? product.category}</span>
            <p className="text-sm text-muted-foreground line-clamp-4">{product.description}</p>
            {product.variants && product.variants.length > 0 && (
              <div className="mt-1">
                <label className="text-xs font-medium mb-1 block text-muted-foreground">{product.variants[0]?.label}</label>
                <div className="flex flex-wrap gap-1">
                  {product.variants.map((v) => (
                    <button
                      key={v.value}
                      disabled={v.stock !== undefined && v.stock <= 0}
                      onClick={() => setSelectedVariant(v.value)}
                      className={`px-2 py-0.5 text-xs rounded border transition-colors ${selectedVariant === v.value ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground hover:border-primary/60"} disabled:opacity-40 disabled:cursor-not-allowed`}
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
            {product.discountPrice && <span className="text-xs text-muted-foreground line-through block">{product.price.toLocaleString("sr-RS")} RSD</span>}
            <span className="text-2xl font-bold text-primary">{effectivePrice.toLocaleString("sr-RS")} RSD</span>
            <span className="text-xs text-muted-foreground ml-1">/{product.unit}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link href={`/vlasnik/shop/${supplierSlug}/proizvodi/${product.id}`}>Detalji</Link></Button>
            <Button data-testid={`button-quick-add-cart-${product.id}`} disabled={cartBusy || ((product.variants?.length ?? 0) > 0 && !selectedVariant)} onClick={() => { onAdd(product.id, selectedVariant || undefined); onClose(); }} className="gap-2">
              <ShoppingCart className="w-4 h-4" /> Dodaj u korpu
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductCard({ product, onAdd, onQuickView, supplierSlug }: { product: Product; onAdd: (id: string, variant?: string) => void; onQuickView: (p: Product) => void; supplierSlug: string; }) {
  const cartBusy = useMutationQueueBusy(shopCartMutationQueue);
  return (
    <Card className="overflow-hidden group flex flex-col relative">
      <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
        {product.discountPercent && <Badge className="bg-destructive hover:bg-destructive text-white border-none text-xs">-{product.discountPercent}%</Badge>}
        {product.isNew && <Badge className="bg-sky-500 hover:bg-sky-500 text-white border-none text-xs">Novo</Badge>}
        {product.isBestseller && <Badge className="bg-amber-500 hover:bg-amber-500 text-white border-none text-xs"><Flame className="w-3 h-3 mr-0.5" />Bestseller</Badge>}
      </div>
      <div className="aspect-square bg-muted relative overflow-hidden">
        <OptimizedImage src={product.imageUrl} alt={product.name} width={400} height={400} preferredSize="medium" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        <button onClick={() => onQuickView(product)} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white text-sm font-medium">
          <Eye className="w-4 h-4" /> Brz pregled
        </button>
      </div>
      <CardContent className="p-4 flex-1 flex flex-col gap-1">
        {product.brand && <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{product.brand}</span>}
        <span className="text-[10px] text-muted-foreground">{product.subcategory ?? product.category}</span>
        <h3 className="font-semibold text-sm leading-tight line-clamp-2 mt-0.5"><Link className="hover:text-primary" href={`/vlasnik/shop/${supplierSlug}/proizvodi/${product.id}`}>{product.name}</Link></h3>
        <div className="mt-auto pt-2 flex items-end justify-between">
          <div>
            {product.discountPrice ? (
              <><span className="text-xs text-muted-foreground line-through block">{product.price.toLocaleString("sr-RS")} RSD</span><span className="font-bold text-primary">{product.discountPrice.toLocaleString("sr-RS")} RSD</span></>
            ) : <span className="font-bold">{product.price.toLocaleString("sr-RS")} RSD</span>}
          </div>
          <span className="text-[10px] text-muted-foreground">/{product.unit}</span>
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0 gap-2">
        <Button data-testid={`button-quick-view-${product.id}`} size="sm" variant="outline" className="flex-shrink-0" onClick={() => onQuickView(product)}><Eye className="w-3.5 h-3.5" /></Button>
        <Button data-testid={`button-add-cart-${product.id}`} size="sm" className="flex-1 gap-1" disabled={cartBusy} onClick={() => { if (product.variants && product.variants.length > 0) onQuickView(product); else onAdd(product.id); }}><ShoppingCart className="w-3.5 h-3.5" /> Dodaj</Button>
      </CardFooter>
    </Card>
  );
}

function BundleQuickView({ bundleId, supplierSlug, onClose, onAdd, cartBusy }: { bundleId: string; supplierSlug: string; onClose: () => void; onAdd: (payload: { bundleId: string }) => void; cartBusy: boolean; }) {
  const { data: bundle, isLoading, isError } = useGetShopBundle(bundleId, { query: { enabled: !!bundleId, queryKey: getGetShopBundleQueryKey(bundleId) } });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        {isLoading || !bundle ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : isError ? (
          <div className="py-12 text-center text-destructive">Nije moguće učitati bundle.</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-serif">{bundle.name}</DialogTitle>
            </DialogHeader>
            <div className="flex gap-4 mt-2">
              {bundle.imageUrl ? (
                <OptimizedImage src={bundle.imageUrl} alt={bundle.name} width={144} height={144} preferredSize="medium" className="w-36 h-36 object-cover rounded-xl flex-shrink-0 bg-muted" />
              ) : (
                <div className="w-36 h-36 bg-muted rounded-xl flex items-center justify-center flex-shrink-0"><Package className="w-8 h-8 text-muted-foreground/30" /></div>
              )}
              <div className="flex flex-col gap-2 flex-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-primary">B2B Bundle</span>
                <p className="text-sm text-muted-foreground">{bundle.description || "Nema opisa."}</p>
                <div className="mt-2 text-sm">
                  <strong className="block mb-1">Sadržaj:</strong>
                  <ul className="space-y-1">
                    {bundle.components.map(c => (
                      <li key={c.productId} className="flex items-center justify-between text-xs bg-muted/30 p-1.5 rounded">
                        <span className="truncate mr-2 flex-1">{c.name}</span>
                        <span className="font-semibold whitespace-nowrap text-muted-foreground">x{c.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
            <div className="flex items-end justify-between mt-4 pt-4 border-t">
              <div>
                <span className="text-xs text-muted-foreground block">Dostupno: {bundle.derivedStock} kom</span>
                <span className="text-2xl font-bold text-primary">{(bundle.b2bPrice ?? 0).toLocaleString("sr-RS")} RSD</span>
              </div>
              <div className="flex gap-2">
                <Button data-testid={`button-add-bundle-cart-${bundle.id}`} disabled={cartBusy || bundle.derivedStock <= 0} onClick={() => { onAdd({ bundleId: bundle.id }); onClose(); }} className="gap-2">
                  <ShoppingCart className="w-4 h-4" /> Dodaj u korpu
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BundleCard({ bundle, onAdd, onQuickView, supplierSlug }: { bundle: Bundle; onAdd: (payload: { bundleId: string }) => void; onQuickView: (id: string) => void; supplierSlug: string; }) {
  const cartBusy = useMutationQueueBusy(shopCartMutationQueue);
  return (
    <Card className="overflow-hidden group flex flex-col relative border-primary/20 bg-primary/5">
      <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
        <Badge className="bg-primary hover:bg-primary text-white border-none text-xs"><Package className="w-3 h-3 mr-1" />Bundle</Badge>
      </div>
      <div className="aspect-square bg-muted relative overflow-hidden flex items-center justify-center">
        {bundle.imageUrl ? (
          <OptimizedImage src={bundle.imageUrl} alt={bundle.name} width={400} height={400} preferredSize="medium" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <Package className="w-16 h-16 text-muted-foreground/20" />
        )}
        <button onClick={() => onQuickView(bundle.id)} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white text-sm font-medium">
          <Eye className="w-4 h-4" /> Brz pregled
        </button>
      </div>
      <CardContent className="p-4 flex-1 flex flex-col gap-1">
        <h3 className="font-semibold text-sm leading-tight line-clamp-2 mt-0.5"><button className="hover:text-primary text-left" onClick={() => onQuickView(bundle.id)}>{bundle.name}</button></h3>
        <p className="text-xs text-muted-foreground line-clamp-1">{bundle.components.length} proizvoda</p>
        <div className="mt-auto pt-2 flex items-end justify-between">
          <div>
            <span className="font-bold text-primary">{(bundle.b2bPrice ?? 0).toLocaleString("sr-RS")} RSD</span>
          </div>
          <span className="text-[10px] text-muted-foreground">Dostupno: {bundle.derivedStock}</span>
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0 gap-2">
        <Button data-testid={`button-quick-view-bundle-${bundle.id}`} size="sm" variant="outline" className="flex-shrink-0" onClick={() => onQuickView(bundle.id)}><Eye className="w-3.5 h-3.5" /></Button>
        <Button data-testid={`button-add-cart-bundle-${bundle.id}`} size="sm" className="flex-1 gap-1" disabled={cartBusy || bundle.derivedStock <= 0} onClick={() => onAdd({ bundleId: bundle.id })}><ShoppingCart className="w-3.5 h-3.5" /> Dodaj</Button>
      </CardFooter>
    </Card>
  );
}

function CategorySidebar({ categories, filters, setFilters }: { categories: any[]; filters: FilterState; setFilters: React.Dispatch<React.SetStateAction<FilterState>>; }) {
  const roots = categories.filter(c => !c.parentId).sort((a,b) => a.sortOrder - b.sortOrder);
  const getChildren = (parentId: string) => categories.filter(c => c.parentId === parentId).sort((a,b) => a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-2">
      <button onClick={() => setFilters(f => ({ ...f, categoryId: "" }))} className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${!filters.categoryId ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"}`}>Svi proizvodi</button>
      {roots.map(root => (
        <div key={root.id}>
          <button data-testid={`category-filter-${root.id}`} onClick={() => setFilters(f => ({ ...f, categoryId: root.id }))} className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${filters.categoryId === root.id ? "bg-primary/10 text-primary" : "hover:bg-muted text-foreground"}`}>{root.name}</button>
          <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
            {getChildren(root.id).map(sub => (
              <button data-testid={`category-filter-${sub.id}`} key={sub.id} onClick={() => setFilters(f => ({ ...f, categoryId: sub.id }))} className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${filters.categoryId === sub.id ? "text-primary font-semibold bg-primary/5" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>{sub.name}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function OwnerShop() {
  const [, params] = useRoute("/vlasnik/shop/:supplierSlug");
  const supplierSlug = params?.supplierSlug;

  const { data: userResp } = useGetCurrentUser();
  const { data: summary, isLoading: isLoadingSum } = useGetShopSummary({ query: { enabled: !!userResp?.user, queryKey: getGetShopSummaryQueryKey() } });
  const { data: allSuppliers = [], isLoading: isLoadingSuppliers } = useListPublicSuppliers();
  const suppliers = useMemo(() => allSuppliers.filter(s => s.scope === "B2B" || s.scope === "BOTH"), [allSuppliers]);
  const { data: supplier, isLoading: isLoadingSupplier } = useGetPublicSupplier(supplierSlug ?? "", { query: { enabled: !!supplierSlug, queryKey: getGetPublicSupplierQueryKey(supplierSlug ?? "") } });

  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const [quickViewBundleId, setQuickViewBundleId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const cartBusy = useMutationQueueBusy(shopCartMutationQueue);

  const [filters, setFilters] = useState<FilterState>({ categoryId: "", brand: "", search: "" });
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedSearch(filters.search);

  const productParams = useMemo<ListSupplierProductsParams>(() => {
    const p: ListSupplierProductsParams = { page, pageSize: 24 };
    if (filters.categoryId) p.categoryId = filters.categoryId;
    if (debouncedSearch) p.search = debouncedSearch;
    if (filters.brand) p.brand = filters.brand;
    return p;
  }, [debouncedSearch, filters.categoryId, page]);

  const { data: productList, isLoading: isLoadingProd } = useListSupplierProducts(supplierSlug ?? "", productParams, { query: { enabled: !!supplierSlug, queryKey: getListSupplierProductsQueryKey(supplierSlug ?? "", productParams) } });
  const { data: categories = [], isLoading: isLoadingCats } = useListSupplierCategories(supplierSlug ?? "", { query: { enabled: !!supplierSlug, queryKey: getListSupplierCategoriesQueryKey(supplierSlug ?? "") } });

  const { data: allBundles = [], isLoading: isLoadingBundles } = useListShopBundles({ query: { enabled: !!supplierSlug, queryKey: getListShopBundlesQueryKey() } });
  const supplierBundles = useMemo(() => allBundles.filter(b => b.supplierId === supplier?.id), [allBundles, supplier?.id]);

  const products = productList?.items ?? [];
  const total = productList?.total ?? 0;
  const totalPages = productList?.totalPages ?? 1;

  useEffect(() => { setPage(1); }, [filters.categoryId, debouncedSearch]);

  const addCartItem = useAddShopCartItem({
    mutation: {
      mutationKey: SHOP_CART_MUTATION_KEY,
      onMutate: async ({ data }) => {
        if (!("productId" in data)) return {};
        const product = products.find((item) => item.id === data.productId);
        if (!product) return {};
        const release = await shopCartMutationQueue.acquire();
        try {
          const snapshots = await updateCartAndSummaryOptimistically(queryClient, (current) => addOptimisticCartItem(current, product, data.variantValue));
          return { snapshots, release };
        } catch (error) { release(); throw error; }
      },
      onSuccess: (cart) => { queryClient.setQueryData(getGetShopCartQueryKey(), cart); toast.success("Dodato u korpu"); },
      onError: (error, _variables, context) => { rollbackQueries(queryClient, context?.snapshots); toast.error(error instanceof Error ? error.message : "Greška."); },
      onSettled: async (_data, _error, _variables, context) => { try { await Promise.all([queryClient.invalidateQueries({ queryKey: getGetShopCartQueryKey() }), queryClient.invalidateQueries({ queryKey: getGetShopSummaryQueryKey() })]); } finally { context?.release?.(); } },
    },
  });

  const addToCart = (id: string, variantValue?: string) => {
    if (shopCartMutationQueue.isBusy()) return;
    addCartItem.mutate({ data: { productId: id, ...(variantValue ? { variantValue } : {}) } });
  };

  const addBundleToCart = (payload: { bundleId: string }) => {
    if (shopCartMutationQueue.isBusy()) return;
    addCartItem.mutate({ data: { bundleId: payload.bundleId, quantity: 1 } });
  };

  if (!supplierSlug) {
    // SUPPLIER PICKER
    return (
      <BusinessLayout>
        <div className="container mx-auto px-4 py-8" data-testid="owner-shop">
          <div className="flex flex-col md:flex-row gap-8 items-start">
            <OwnerSidebar current="/vlasnik/shop" />
            <div className="flex-1 min-w-0 space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h1 className="text-3xl font-serif font-bold">B2B Profesionalna Oprema</h1>
                  <p className="text-muted-foreground">Kupujte materijale po povlašćenim cenama za partnere</p>
                </div>
                <Button variant="outline" asChild>
                  <Link href="/vlasnik/prodavnica/import">CSV Uvoz</Link>
                </Button>
              </div>

              {!isLoadingSum && summary && (
                <div className="bg-primary text-primary-foreground p-6 rounded-2xl flex flex-col md:flex-row justify-between items-center gap-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-8 opacity-10"><Star className="w-32 h-32" /></div>
                  <div className="relative z-10">
                    <Badge variant="outline" className="border-primary-foreground/30 text-primary-foreground mb-3 bg-primary-foreground/10">Vaš status</Badge>
                    <h2 className="text-2xl font-bold mb-1">{summary.currentTier} Nivo</h2>
                    <p className="text-primary-foreground/80">Imate {summary.subscriptionDiscount}% popusta zbog vašeg nivoa partnerstva.</p>
                  </div>
                  <div className="relative z-10 text-right">
                    <div className="text-sm text-primary-foreground/80 mb-1">Mesečna potrošnja</div>
                    <div className="text-3xl font-bold">{summary.monthlySpend.toLocaleString("sr-RS")} RSD</div>
                    {summary.amountToNextTier > 0 && <div className="text-sm mt-1 text-primary-foreground/90">Fali {summary.amountToNextTier.toLocaleString("sr-RS")} RSD do sledećeg nivoa</div>}
                  </div>
                </div>
              )}

              {isLoadingSuppliers ? (
                <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
              ) : suppliers.length === 0 ? (
                <div className="py-24 text-center text-muted-foreground bg-card rounded-2xl border">
                  <Building2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>Trenutno nema dostupnih dobavljača.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {suppliers.map(s => (
                    <Link key={s.id} href={`/vlasnik/shop/${s.slug}`} className="group block h-full" data-testid={`b2b-supplier-link-${s.id}`}>
                      <article className="h-full bg-card rounded-2xl border p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col items-center text-center">
                        <div className="w-24 h-24 rounded-full bg-muted border flex items-center justify-center overflow-hidden mb-4 group-hover:ring-4 group-hover:ring-primary/20 transition-all">
                          {s.logoUrl ? (
                            <OptimizedImage src={s.logoUrl} alt={s.name} className="w-full h-full object-cover" width={96} height={96} preferredSize="thumbnail" />
                          ) : <Building2 className="w-8 h-8 text-muted-foreground" />}
                        </div>
                        <h2 className="font-serif text-xl font-bold group-hover:text-primary transition-colors">{s.name}</h2>
                        <Button variant="outline" className="mt-6 w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors">Pogledaj katalog</Button>
                      </article>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </BusinessLayout>
    );
  }

  // SUPPLIER CATALOG
  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8" data-cart-busy={cartBusy ? "true" : "false"}>
        <div className="flex flex-col md:flex-row gap-8 items-start">
          <OwnerSidebar current="/vlasnik/shop" />
          <div className="flex-1 min-w-0 space-y-6">
            <div className="flex items-center text-sm text-muted-foreground gap-2 mb-2">
              <Link href="/vlasnik/shop" className="hover:text-foreground transition-colors">Svi dobavljači</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-foreground">{supplier?.name ?? "..."}</span>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 bg-card border rounded-xl p-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Pretraži po imenu..." value={filters.search} onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))} className="pl-9" />
              </div>
            </div>

            <div className="flex gap-6">
              <div className="w-52 flex-shrink-0 hidden lg:block">
                {!isLoadingCats && (
                  <div className="sticky top-24 bg-muted/20 rounded-xl p-3 border">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3 mb-2">Kategorije</p>
                    <CategorySidebar categories={categories} filters={filters} setFilters={setFilters} />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                {page === 1 && !filters.categoryId && !debouncedSearch && supplierBundles.length > 0 && (
                  <div className="mb-10">
                    <h2 className="text-xl font-serif font-bold mb-4 flex items-center gap-2">
                      <Package className="w-5 h-5 text-primary" /> Promo Paketi
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                      {supplierBundles.map((bundle) => (
                        <BundleCard key={bundle.id} bundle={bundle} onAdd={addBundleToCart} onQuickView={setQuickViewBundleId} supplierSlug={supplierSlug} />
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between mb-3 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">Proizvodi</span>
                  <span>{isLoadingProd ? "Učitavanje..." : `${total} proizvoda`}</span>
                </div>
                {isLoadingProd || isLoadingSupplier ? (
                  <div className="py-24 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                ) : products.length === 0 ? (
                  <div className="py-24 text-center text-muted-foreground bg-card rounded-2xl border">
                    <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">Nema proizvoda koji odgovaraju filterima.</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                      {products.map((product) => <ProductCard key={product.id} product={product} onAdd={addToCart} onQuickView={setQuickViewProduct} supplierSlug={supplierSlug} />)}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-center gap-4 mt-8">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}><ChevronLeft className="w-4 h-4 mr-1" /> Prethodna</Button>
                        <span className="text-sm text-muted-foreground">Strana {page} od {totalPages}</span>
                        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Sledeća <ChevronRight className="w-4 h-4 ml-1" /></Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {quickViewProduct && <QuickView product={quickViewProduct} supplierSlug={supplierSlug} onClose={() => setQuickViewProduct(null)} onAdd={addToCart} cartBusy={cartBusy} />}
      {quickViewBundleId && <BundleQuickView bundleId={quickViewBundleId} supplierSlug={supplierSlug} onClose={() => setQuickViewBundleId(null)} onAdd={addBundleToCart} cartBusy={cartBusy} />}
    </BusinessLayout>
  );
}