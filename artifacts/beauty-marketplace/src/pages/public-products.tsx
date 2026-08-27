import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { ChevronLeft, ChevronRight, Loader2, Search, ShoppingBag, Sparkles, Building2, Bell, CheckCircle, Package, Eye, Heart, CalendarClock, Filter, X, Star, Flag, Clock, ShieldCheck, MessageSquare } from "lucide-react";
import {
  useGetSupplierPublicProduct, useListSupplierPublicProducts, useListPublicSuppliers,
  useGetPublicSupplier, useListSupplierCategories, getGetPublicSupplierQueryKey,
  getListSupplierPublicProductsQueryKey, getListSupplierCategoriesQueryKey,
  getGetSupplierPublicProductQueryKey, useAddRetailCartItem,
  useGetB2cProductWaitlistStatus, getGetB2cProductWaitlistStatusQueryKey, useSubscribeB2cProductWaitlist, useUnsubscribeB2cProductWaitlist,
  useListPublicBundles, useGetPublicBundle, getListPublicBundlesQueryKey, getGetPublicBundleQueryKey,
  useToggleProductWishlistItem, useListProductWishlist, getListProductWishlistQueryKey,
  useGetCurrentUser, useCreateRetailProductSubscription,
  useListSupplierB2cBanners, getListSupplierB2cBannersQueryKey,
  useGetB2cDisplayConfig, getGetB2cDisplayConfigQueryKey,
  useListRecentlyViewedProducts, getListRecentlyViewedProductsQueryKey,
  useRecordRecentlyViewedProduct,
  useListSupplierPublicProductReviews, getListSupplierPublicProductReviewsQueryKey,
  useGetCustomerRetailProductReviewContext, getGetCustomerRetailProductReviewContextQueryKey,
  useCreateCustomerRetailProductReview,
  useReportRetailProductReview,
  RetailProductSubscriptionInputFrequency, RetailProductSubscriptionInputPaymentMethod, RetailProductSubscriptionInputDeliveryMethod,
  B2cProductSort
} from "@workspace/api-client-react";
import type { ListSupplierPublicProductsParams, PublicProduct, PublicBundle, B2cFacetValue } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { OptimizedImage } from "@/components/optimized-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";
import { notifyRetailCartChanged } from "@/lib/retail-cart-events";
import { extractApiError } from "@/lib/admin-form-utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";

const money = (value: number) => new Intl.NumberFormat("sr-RS", {
  style: "currency", currency: "RSD", maximumFractionDigits: 0,
}).format(value);

function ProductPrice({ product }: { product: PublicProduct }) {
  const current = product.discountPrice ?? product.price;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-lg font-semibold text-foreground">{money(current)}</span>
      {product.discountPrice != null && <span className="text-sm text-muted-foreground line-through">{money(product.price)}</span>}
    </div>
  );
}

function StarRating({ rating, count }: { rating?: number | null; count?: number }) {
  if (rating == null) return null;
  return (
    <div className="flex items-center gap-1.5 mt-2">
      <div className="flex items-center text-amber-500">
        {[...Array(5)].map((_, i) => (
          <Star key={i} className={`w-3.5 h-3.5 ${i < Math.round(rating) ? "fill-amber-500" : "fill-muted text-muted-foreground/30"}`} />
        ))}
      </div>
      {count != null && count > 0 && <span className="text-xs text-muted-foreground">({count})</span>}
    </div>
  );
}

function PublicProductCard({ product, supplierSlug, isWishlisted, onToggleWishlist, isCustomer }: { product: PublicProduct, supplierSlug: string, isWishlisted?: boolean, onToggleWishlist?: (productId: string) => void, isCustomer?: boolean }) {
  const { toast } = useToast();
  const addRetailCartItem = useAddRetailCartItem();
  const add = () => {
    addRetailCartItem.mutate({ data: { productId: product.id, quantity: 1 } }, {
      onSuccess: (cart) => {
        const changedItem = cart.items.find((item) => item.kind === "product" && item.kind === 'product' && item.productId === product.id);
        notifyRetailCartChanged(cart.itemCount, {
          productId: product.id,
          name: changedItem?.name ?? product.name,
          quantity: changedItem?.quantity ?? 1,
        });
        toast.success("Proizvod je dodat u korpu.");
      },
      onError: (error) => {
        toast.error(extractApiError(error, "Proizvod trenutno nije dostupan."));
      }
    });
  };
  const adding = addRetailCartItem.isPending;

  const rating = (product as any).reviewSummary?.averageRating;
  const count = (product as any).reviewSummary?.reviewCount;

  return (
    <article className="group overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md relative flex flex-col h-full">
      {isCustomer && onToggleWishlist && (
        <button
          onClick={(e) => { e.preventDefault(); onToggleWishlist(product.id); }}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-white/80 backdrop-blur border shadow-sm flex items-center justify-center text-muted-foreground hover:text-rose-500 transition-colors"
          data-testid={`button-wishlist-${product.id}`}
        >
          <Heart className={`w-4 h-4 ${isWishlisted ? "fill-rose-500 text-rose-500" : ""}`} />
        </button>
      )}
      <Link href={`/shop/${supplierSlug}/proizvod/${product.id}`} className="block flex-1" data-testid={`public-product-link-${product.id}`}>
        <div className="aspect-square overflow-hidden bg-muted">
          <OptimizedImage src={product.imageUrl} alt={product.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        </div>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-1.5 min-h-[22px]">
            {product.isNew && <Badge className="bg-sky-600 text-white border-transparent">Novo</Badge>}
            {product.discountPercent != null && <Badge className="bg-rose-600 text-white border-transparent">−{product.discountPercent}%</Badge>}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{product.brand ?? product.category}</p>
            <h2 className="mt-1 line-clamp-2 font-serif text-lg font-semibold text-foreground">{product.name}</h2>
            <StarRating rating={rating} count={count} />
          </div>
          <p className="line-clamp-2 text-sm text-muted-foreground">{product.description}</p>
          <ProductPrice product={product} />
        </div>
      </Link>
      <div className="px-4 pb-4 mt-auto">
        <Button className="w-full" onClick={add} disabled={adding} data-testid={`public-product-add-${product.id}`}>
          {adding ? "Dodavanje…" : "Dodaj u korpu"}
        </Button>
      </div>
    </article>
  );
}

function PublicBundleQuickView({ bundleId, supplierSlug, onClose }: { bundleId: string; supplierSlug: string; onClose: () => void; }) {
  const { data: bundle, isLoading, isError } = useGetPublicBundle(bundleId, { query: { enabled: !!bundleId, queryKey: getGetPublicBundleQueryKey(bundleId) } });
  const { toast } = useToast();
  const addRetailCartItem = useAddRetailCartItem();

  const add = () => {
    if (!bundle) return;
    addRetailCartItem.mutate({ data: { bundleId: bundle.id, quantity: 1 } }, {
      onSuccess: (cart) => {
        const changedItem = cart.items.find((item) => item.kind === 'bundle' && item.bundleId === bundle.id);
        notifyRetailCartChanged(cart.itemCount, {
          productId: bundle.id,
          name: changedItem?.name ?? bundle.name,
          quantity: changedItem?.quantity ?? 1,
        });
        toast.success("Promo paket je dodat u korpu.");
        onClose();
      },
      onError: (error) => {
        toast.error(extractApiError(error, "Paket trenutno nije dostupan."));
      }
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        {isLoading || !bundle ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : isError ? (
          <div className="py-12 text-center text-destructive">Nije moguće učitati paket.</div>
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
                <span className="text-xs font-semibold uppercase tracking-wide text-primary">Promo Paket</span>
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
                <span className="text-2xl font-bold text-primary">{money(bundle.b2cPrice)}</span>
              </div>
              <div className="flex gap-2">
                <Button data-testid={`button-add-public-bundle-cart-${bundle.id}`} disabled={addRetailCartItem.isPending || bundle.derivedStock <= 0} onClick={add} className="gap-2">
                  <ShoppingBag className="w-4 h-4" /> {addRetailCartItem.isPending ? "Dodavanje..." : "Dodaj u korpu"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PublicBundleCard({ bundle, supplierSlug, onQuickView }: { bundle: PublicBundle; supplierSlug: string; onQuickView: (id: string) => void }) {
  const { toast } = useToast();
  const addRetailCartItem = useAddRetailCartItem();

  const add = () => {
    addRetailCartItem.mutate({ data: { bundleId: bundle.id, quantity: 1 } }, {
      onSuccess: (cart) => {
        const changedItem = cart.items.find((item) => item.kind === 'bundle' && item.bundleId === bundle.id);
        notifyRetailCartChanged(cart.itemCount, {
          productId: bundle.id,
          name: changedItem?.name ?? bundle.name,
          quantity: changedItem?.quantity ?? 1,
        });
        toast.success("Promo paket je dodat u korpu.");
      },
      onError: (error) => {
        toast.error(extractApiError(error, "Paket trenutno nije dostupan."));
      }
    });
  };
  const adding = addRetailCartItem.isPending;

  return (
    <article className="group overflow-hidden rounded-2xl border border-primary/20 bg-primary/5 shadow-sm transition-shadow hover:shadow-md flex flex-col relative h-full">
      <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
        <Badge className="bg-primary text-white border-transparent"><Package className="w-3 h-3 mr-1" />Promo Paket</Badge>
      </div>
      <button onClick={() => onQuickView(bundle.id)} className="block relative w-full aspect-square bg-muted flex items-center justify-center overflow-hidden" data-testid={`public-bundle-link-${bundle.id}`}>
        {bundle.imageUrl ? (
          <OptimizedImage src={bundle.imageUrl} alt={bundle.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <Package className="w-16 h-16 text-muted-foreground/20" />
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white text-sm font-medium">
          <Eye className="w-4 h-4" /> Brz pregled
        </div>
      </button>
      <div className="space-y-3 p-4 flex-1 flex flex-col">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-primary">Sadrži {bundle.components.length} proizvoda</p>
          <h2 className="mt-1 line-clamp-2 font-serif text-lg font-semibold text-foreground">
            <button onClick={() => onQuickView(bundle.id)} className="text-left hover:text-primary">{bundle.name}</button>
          </h2>
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground flex-1">{bundle.description}</p>
        <div className="flex items-baseline justify-between mt-auto">
          <span className="text-lg font-bold text-primary">{money(bundle.b2cPrice)}</span>
          <span className="text-[10px] text-muted-foreground">Dostupno: {bundle.derivedStock}</span>
        </div>
      </div>
      <div className="px-4 pb-4"><Button className="w-full gap-2" onClick={add} disabled={adding || bundle.derivedStock <= 0} data-testid={`public-bundle-add-${bundle.id}`}><ShoppingBag className="w-4 h-4" /> {adding ? "Dodavanje…" : "Dodaj u korpu"}</Button></div>
    </article>
  );
}

export default function PublicProductsPage() {
  const { data: allSuppliers = [], isLoading, isError } = useListPublicSuppliers();
  const suppliers = useMemo(() => allSuppliers.filter(s => s.scope === "B2C" || s.scope === "BOTH"), [allSuppliers]);

  return (
    <Layout>
      <main className="mx-auto min-h-screen max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-3xl bg-primary px-6 py-10 text-primary-foreground sm:px-10">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-primary-foreground/80"><Sparkles className="h-4 w-4" /> LUMERA prodavnica</p>
            <h1 className="mt-3 font-serif text-4xl font-bold sm:text-5xl">Katalozi naših partnera</h1>
            <p className="mt-4 text-primary-foreground/85">Istražite proizvode direktno od proverenih dobavljača i brendova.</p>
          </div>
        </section>

        <section className="mt-10">
          {isLoading ? (
            <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center text-destructive">Nije moguće učitati dobavljače. Pokušajte ponovo kasnije.</div>
          ) : suppliers.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {suppliers.map(supplier => (
                <Link key={supplier.id} href={`/shop/${supplier.slug}`} className="group block h-full" data-testid={`public-supplier-link-${supplier.id}`}>
                  <article className="h-full rounded-2xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md flex flex-col items-center text-center">
                    <div className="w-24 h-24 rounded-full bg-muted border flex items-center justify-center overflow-hidden mb-4 group-hover:ring-4 group-hover:ring-primary/20 transition-all">
                      {supplier.logoUrl ? (
                        <OptimizedImage src={supplier.logoUrl} alt={supplier.name} className="w-full h-full object-cover" width={96} height={96} preferredSize="thumbnail" />
                      ) : (
                        <Building2 className="w-10 h-10 text-muted-foreground" />
                      )}
                    </div>
                    <h2 className="font-serif text-xl font-semibold group-hover:text-primary transition-colors">{supplier.name}</h2>
                    <Button variant="outline" className="mt-6 w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      Pogledaj proizvode
                    </Button>
                  </article>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border bg-muted/20 px-6 text-center">
              <ShoppingBag className="h-10 w-10 text-muted-foreground" />
              <h2 className="mt-4 font-serif text-xl font-semibold">Trenutno nema dostupnih dobavljača</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">Vratite se uskoro da biste videli novu ponudu.</p>
            </div>
          )}
        </section>
      </main>
    </Layout>
  );
}

function FacetFilter({ title, options, selected, onChange }: { title: string; options: B2cFacetValue[]; selected: string[]; onChange: (values: string[]) => void }) {
  if (!options || options.length === 0) return null;
  return (
    <div className="mb-6">
      <h3 className="font-semibold mb-3 text-sm">{title}</h3>
      <div className="space-y-2">
        {options.map((opt) => {
          if (!opt.value) return null;
          const isChecked = selected.includes(opt.value);
          return (
            <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer hover:text-foreground text-muted-foreground transition-colors">
              <Checkbox
                checked={isChecked}
                onCheckedChange={(c) => {
                  if (c) onChange([...selected, opt.value!]);
                  else onChange(selected.filter(v => v !== opt.value));
                }}
              />
              <span className="flex-1 truncate">{opt.label || opt.value}</span>
              <span className="text-xs opacity-60">({opt.count})</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function PublicSupplierShop() {
  const [location, setLocation] = useLocation();
  const searchString = useSearch();
  const pathSegments = location.split("?")[0].split("/").filter(Boolean);
  const supplierSlug = pathSegments[1] ?? "";
  const categoryPath = pathSegments.slice(2).join("/");

  const { data: userResp } = useGetCurrentUser();
  const isCustomer = userResp?.user?.role === "CUSTOMER";

  const { data: supplier, isLoading: supplierLoading, isError: supplierError } = useGetPublicSupplier(supplierSlug, { query: { enabled: !!supplierSlug, queryKey: getGetPublicSupplierQueryKey(supplierSlug) } });

  const { data: displayConfig } = useGetB2cDisplayConfig({ query: { queryKey: getGetB2cDisplayConfigQueryKey() } });
  const { data: banners = [] } = useListSupplierB2cBanners(supplierSlug, { query: { enabled: !!supplierSlug, queryKey: getListSupplierB2cBannersQueryKey(supplierSlug) } });

  const queryParamsRaw = new URLSearchParams(searchString);
  const getArrayParam = (key: string) => queryParamsRaw.get(key)?.split(",").filter(Boolean) || [];

  const search = queryParamsRaw.get("search") || "";
  const brandList = getArrayParam("brand");
  const productTypeList = getArrayParam("productType");
  const needTagList = getArrayParam("needTag");
  const minPrice = queryParamsRaw.get("minPrice") ? Number(queryParamsRaw.get("minPrice")) : undefined;
  const maxPrice = queryParamsRaw.get("maxPrice") ? Number(queryParamsRaw.get("maxPrice")) : undefined;
  const sort = (queryParamsRaw.get("sort") as B2cProductSort) || displayConfig?.defaultSort || "RECOMMENDED";
  const page = queryParamsRaw.get("page") ? Number(queryParamsRaw.get("page")) : 1;

  const [localSearch, setLocalSearch] = useState(search);
  const debouncedSearch = useDebouncedSearch(localSearch);
  const rehydratingSearchRef = useRef(false);

  // Let Back/Forward restore the URL-backed value before the stale debounce can
  // write the value from the page we just left back into history.
  useEffect(() => {
    if (localSearch !== search) {
      rehydratingSearchRef.current = true;
      setLocalSearch(search);
    }
  }, [search]);

  useEffect(() => {
    if (rehydratingSearchRef.current) {
      if (debouncedSearch === search) rehydratingSearchRef.current = false;
      return;
    }
    if (debouncedSearch !== search) {
      updateFilters({ search: debouncedSearch, page: 1 });
    }
  }, [debouncedSearch, search]);

  const updateFilters = (updates: Record<string, any>) => {
    const params = new URLSearchParams(searchString);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
        params.delete(key);
      } else if (Array.isArray(value)) {
        params.set(key, value.join(","));
      } else {
        params.set(key, String(value));
      }
    });
    // If not explicitly setting page, reset it to 1 when filters change
    if (!('page' in updates) && params.has("page")) {
      params.delete("page");
    }
    const searchPart = params.toString();
    setLocation(searchPart ? `${location.split("?")[0]}?${searchPart}` : location.split("?")[0]);
  };

  const { data: categories = [], isLoading: categoriesLoading } = useListSupplierCategories(supplierSlug, { query: { enabled: !!supplierSlug, queryKey: getListSupplierCategoriesQueryKey(supplierSlug) } });
  const selectedCategory = categoryPath ? categories.find((category) => category.path === categoryPath) : undefined;

  const queryParams = useMemo<ListSupplierPublicProductsParams>(() => ({
    page,
    pageSize: displayConfig?.pageSize || 24,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(selectedCategory ? { categoryId: selectedCategory.id } : {}),
    ...(brandList.length ? { brand: brandList.join(",") } : {}),
    ...(productTypeList.length ? { productType: productTypeList.join(",") } : {}),
    ...(needTagList.length ? { needTag: needTagList.join(",") } : {}),
    ...(minPrice != null ? { minPrice } : {}),
    ...(maxPrice != null ? { maxPrice } : {}),
    ...(sort ? { sort } : {}),
  }), [search, selectedCategory, brandList, productTypeList, needTagList, minPrice, maxPrice, sort, page, displayConfig]);

  const { data: productsData, isLoading: productsLoading, isError: productsError } = useListSupplierPublicProducts(supplierSlug, queryParams, {
    query: {
      enabled: !!supplierSlug && (!categoryPath || Boolean(selectedCategory)),
      queryKey: getListSupplierPublicProductsQueryKey(supplierSlug, queryParams)
    },
  });

  const { data: wishlist = [] } = useListProductWishlist({
    query: { enabled: isCustomer, queryKey: getListProductWishlistQueryKey() }
  });

  const queryClient = useQueryClient();
  const toggleWishlist = useToggleProductWishlistItem({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getListProductWishlistQueryKey() });
        if (res.saved) toast.success("Proizvod je sačuvan u listu želja.");
        else toast.success("Proizvod je uklonjen iz liste želja.");
      }
    }
  });

  const { data: allBundles = [] } = useListPublicBundles({ query: { enabled: !!supplierSlug, queryKey: getListPublicBundlesQueryKey() } });
  const supplierBundles = useMemo(() => allBundles.filter(b => b.supplierId === supplier?.id), [allBundles, supplier?.id]);
  const [quickViewBundleId, setQuickViewBundleId] = useState<string | null>(null);

  const { toast } = useToast();

  const [tempMinPrice, setTempMinPrice] = useState(minPrice?.toString() ?? "");
  const [tempMaxPrice, setTempMaxPrice] = useState(maxPrice?.toString() ?? "");

  useEffect(() => {
    setTempMinPrice(minPrice?.toString() ?? "");
    setTempMaxPrice(maxPrice?.toString() ?? "");
  }, [minPrice, maxPrice]);

  const applyPriceFilter = () => {
    let min = tempMinPrice ? Number(tempMinPrice) : null;
    let max = tempMaxPrice ? Number(tempMaxPrice) : null;

    if (min !== null && (isNaN(min) || min < 0)) min = 0;
    if (max !== null && (isNaN(max) || max < 0)) max = 0;

    if (min !== null && max !== null && min > max) {
      const temp = min;
      min = max;
      max = temp;
    }

    setTempMinPrice(min?.toString() ?? "");
    setTempMaxPrice(max?.toString() ?? "");

    updateFilters({
      minPrice: min,
      maxPrice: max,
      page: 1
    });
  };

  const getBannerHref = (destination: any, supplierSlug: string, categories: any[]): string | null => {
    if (!destination) return null;
    const dest = destination as any;
    if (dest.kind === "CATEGORY" && dest.categoryId) {
      const cat = categories.find(c => c.id === dest.categoryId);
      return cat ? `/shop/${supplierSlug}/${cat.path}` : `/shop/${supplierSlug}`;
    }
    if (dest.kind === "PRODUCT" && dest.productId) {
      return `/shop/${supplierSlug}/proizvod/${dest.productId}`;
    }
    if (dest.kind === "FILTERED_LISTING" && dest.filters) {
      const search = new URLSearchParams();
      let path = `/shop/${supplierSlug}`;
      for (const [k, v] of Object.entries(dest.filters)) {
        if (v == null) continue;
        if (k === "categoryId") {
          const cat = categories.find(c => c.id === v);
          if (cat) path = `/shop/${supplierSlug}/${cat.path}`;
        } else if (Array.isArray(v)) {
          search.set(k, v.join(","));
        } else {
          search.set(k, String(v));
        }
      }
      const q = search.toString();
      return q ? `${path}?${q}` : path;
    }
    if (dest.kind === "CUSTOM_INTERNAL_PATH" && dest.path) {
      const p = String(dest.path);
      if (p.startsWith("/") && !p.startsWith("//")) return p;
    }
    return null;
  };

  const renderCategoryLinks = (parentId: string | null, depth = 0) => categories
    .filter((category) => (category.parentId ?? null) === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => (
      <div key={category.id}>
        <Link
          href={`/shop/${supplierSlug}/${category.path}`}
          className={`block rounded-md py-1.5 pr-2 text-sm flex items-center justify-between ${selectedCategory?.id === category.id ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}
          style={{ paddingLeft: `${depth}rem` }}
          data-testid={`public-category-${category.id}`}
        >
          <span className="truncate">{category.name}</span>
          <span className="text-xs opacity-60 ml-2">({category.descendantProductCount})</span>
        </Link>
        {renderCategoryLinks(category.id, depth + 1)}
      </div>
    ));

  if (supplierLoading) return <Layout><div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></Layout>;
  if (supplierError || !supplier) return <Layout><main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-5 text-center"><Building2 className="h-10 w-10 text-muted-foreground" /><h1 className="mt-4 font-serif text-3xl font-bold">Dobavljač nije pronađen</h1><Button asChild className="mt-6"><Link href="/proizvodi">Svi dobavljači</Link></Button></main></Layout>;
  if (!categoriesLoading && categoryPath && !selectedCategory) return <Layout><main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-5 text-center"><ShoppingBag className="h-10 w-10 text-muted-foreground" /><h1 className="mt-4 font-serif text-3xl font-bold">Kategorija nije pronađena</h1><Button asChild className="mt-6"><Link href={`/shop/${supplierSlug}`}>Nazad na katalog</Link></Button></main></Layout>;

  const heroBanners = banners.filter(b => b.placement === "HERO");
  const inResultsBanners = banners.filter(b => b.placement === "IN_RESULTS");

  const renderInResultsBanner = (banner: (typeof inResultsBanners)[number]) => {
    const href = getBannerHref(banner.destination, supplier.slug, categories);
    const content = (
      <div className="relative rounded-2xl overflow-hidden bg-muted aspect-square sm:aspect-auto sm:h-full flex flex-col justify-end p-6 border border-primary/20 shadow-sm group">
        <OptimizedImage src={banner.desktopImageUrl} alt={banner.headline} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="relative z-10 text-white">
          <h3 className="font-serif text-xl font-bold leading-tight group-hover:underline decoration-primary/50 underline-offset-4">{banner.headline}</h3>
          {banner.text && <p className="text-sm opacity-90 mt-2 line-clamp-3">{banner.text}</p>}
          {banner.ctaLabel && <Button variant="secondary" size="sm" className="mt-4 pointer-events-none">{banner.ctaLabel}</Button>}
        </div>
      </div>
    );
    return href
      ? <Link key={`banner-${banner.id}`} href={href} className="block h-full sm:col-span-2 xl:col-span-1">{content}</Link>
      : <div key={`banner-${banner.id}`} className="h-full sm:col-span-2 xl:col-span-1">{content}</div>;
  };

  const renderProductGridWithBanners = (products: PublicProduct[]) => {
    const gridItems: React.ReactNode[] = [];
    let bannerIndex = 0;

    // Distribute banners deterministically: after every 6th product
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      gridItems.push(
        <PublicProductCard
          key={product.id}
          product={product}
          supplierSlug={supplier.slug}
          isCustomer={isCustomer}
          isWishlisted={wishlist.some(w => w.productId === product.id)}
          onToggleWishlist={(id) => toggleWishlist.mutate({ data: { productId: id } })}
        />
      );

      // Inject banner after 6th, 12th, 18th product... if available
      if ((i + 1) % 6 === 0 && bannerIndex < inResultsBanners.length) {
        const banner = inResultsBanners[bannerIndex];
        gridItems.push(renderInResultsBanner(banner));
        bannerIndex++;
      }
    }

    // Keep the placement visible on narrow/filtered result sets too.
    while (bannerIndex < inResultsBanners.length) {
      gridItems.push(renderInResultsBanner(inResultsBanners[bannerIndex]));
      bannerIndex++;
    }

    return <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">{gridItems}</div>;
  };

  const activeFiltersCount = brandList.length + productTypeList.length + needTagList.length + (minPrice ? 1 : 0) + (maxPrice ? 1 : 0);
  const facets = (productsData as any)?.facets;

  const FilterControls = () => {
    const belowCategoryBanners = banners.filter(b => b.placement === "BELOW_CATEGORIES");

    return (
      <>
        <div className="mb-6">
          <h3 className="font-semibold mb-3 text-sm">Kategorije</h3>
          <div className="space-y-1">
            <Link href={`/shop/${supplier.slug}`} className={`block text-sm py-1.5 flex items-center justify-between ${!categoryPath ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`} data-testid="public-category-all">
              <span>Svi proizvodi</span>
              {categories.length > 0 && <span className="text-xs opacity-60 ml-2">({categories.filter(c => !c.parentId).reduce((sum, c) => sum + c.descendantProductCount, 0)})</span>}
            </Link>
            {renderCategoryLinks(null)}
          </div>
        </div>

        {belowCategoryBanners.length > 0 && (
          <div className="mb-6 grid gap-3">
            {belowCategoryBanners.map(banner => {
              const href = getBannerHref(banner.destination, supplier.slug, categories);
              const content = (
                <div className="relative rounded-xl overflow-hidden bg-muted aspect-[4/3] group flex flex-col justify-end p-4 border shadow-sm">
                  <OptimizedImage src={banner.desktopImageUrl} alt={banner.headline} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                  <div className="relative z-10 text-white">
                    <h4 className="font-serif font-bold leading-tight">{banner.headline}</h4>
                    {banner.text && <p className="text-xs opacity-90 mt-1 line-clamp-2">{banner.text}</p>}
                    {banner.ctaLabel && <span className="inline-block mt-3 text-xs font-semibold uppercase tracking-wider text-primary-foreground underline decoration-primary/50 underline-offset-4">{banner.ctaLabel}</span>}
                  </div>
                </div>
              );
              return href ? <Link key={banner.id} href={href} className="block">{content}</Link> : <div key={banner.id}>{content}</div>;
            })}
          </div>
        )}

        <div className="mb-6 space-y-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={localSearch}
              onChange={(event) => {
                rehydratingSearchRef.current = false;
                setLocalSearch(event.target.value);
              }}
              placeholder="Pretraga..."
              className="pl-9 h-9 text-sm"
            />
          </label>
        </div>

        <div className="mb-6">
          <h3 className="font-semibold mb-3 text-sm">Cena (RSD)</h3>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              placeholder="Od"
              value={tempMinPrice}
              onChange={(e) => setTempMinPrice(e.target.value)}
              onBlur={() => applyPriceFilter()}
              onKeyDown={(e) => e.key === "Enter" && applyPriceFilter()}
              className="h-9 text-sm"
            />
            <span className="text-muted-foreground">-</span>
            <Input
              type="number"
              placeholder="Do"
              value={tempMaxPrice}
              onChange={(e) => setTempMaxPrice(e.target.value)}
              onBlur={() => applyPriceFilter()}
              onKeyDown={(e) => e.key === "Enter" && applyPriceFilter()}
              className="h-9 text-sm"
            />
          </div>
        </div>

        {facets?.brands && <FacetFilter title="Brendovi" options={facets.brands} selected={brandList} onChange={(v) => updateFilters({ brand: v })} />}
        {facets?.productTypes && <FacetFilter title="Tip proizvoda" options={facets.productTypes} selected={productTypeList} onChange={(v) => updateFilters({ productType: v })} />}
        {facets?.needTags && <FacetFilter title="Potrebe / Problemi" options={facets.needTags} selected={needTagList} onChange={(v) => updateFilters({ needTag: v })} />}
      </>
    );
  };

  return (
    <Layout>
      <main className="mx-auto min-h-screen max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 text-sm text-muted-foreground flex items-center gap-2">
          <Link href="/proizvodi" className="hover:text-primary transition-colors">Svi dobavljači</Link>
          <ChevronRight className="w-3 h-3" />
          <Link href={`/shop/${supplier.slug}`} className="hover:text-primary transition-colors text-foreground">{supplier.name}</Link>
          {selectedCategory && (
            <>
              <ChevronRight className="w-3 h-3" />
              <span className="text-foreground">{selectedCategory.name}</span>
            </>
          )}
        </div>

        {heroBanners.length > 0 && !categoryPath && page === 1 && !search && activeFiltersCount === 0 && (
          <div className="mb-8 grid gap-4">
            {heroBanners.map(banner => {
              const href = getBannerHref(banner.destination, supplier.slug, categories);
              const content = (
                <div className="relative rounded-3xl overflow-hidden bg-muted aspect-[21/9] sm:aspect-[3/1] flex items-center group">
                  <OptimizedImage src={banner.desktopImageUrl} alt={banner.headline} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />
                  <div className="relative z-10 p-8 sm:p-12 text-white max-w-2xl">
                    <h2 className="text-3xl sm:text-5xl font-serif font-bold mb-4 group-hover:underline underline-offset-8 decoration-primary/50">{banner.headline}</h2>
                    {banner.text && <p className="text-lg opacity-90 mb-6">{banner.text}</p>}
                    {banner.ctaLabel && <Button variant="secondary" size="lg" className="pointer-events-none">{banner.ctaLabel}</Button>}
                  </div>
                </div>
              );
              return href ? <Link key={banner.id} href={href} className="block">{content}</Link> : <div key={banner.id}>{content}</div>;
            })}
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* Sidebar filters (Desktop) */}
          <aside className="hidden lg:block w-64 shrink-0 sticky top-24 bg-card rounded-2xl border p-5 shadow-sm max-h-[calc(100vh-8rem)] overflow-y-auto">
            <FilterControls />
          </aside>

          {/* Main content */}
          <div className="flex-1 w-full">
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h1 className="font-serif text-3xl font-bold">{selectedCategory ? selectedCategory.name : supplier.name}</h1>

              <div className="flex items-center gap-3">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline" className="lg:hidden gap-2">
                      <Filter className="w-4 h-4" /> Filteri
                      {activeFiltersCount > 0 && <Badge className="ml-1 h-5 w-5 p-0 flex items-center justify-center">{activeFiltersCount}</Badge>}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-full sm:w-[400px] overflow-y-auto">
                    <SheetHeader className="mb-6">
                      <SheetTitle>Filteri</SheetTitle>
                    </SheetHeader>
                    <FilterControls />
                  </SheetContent>
                </Sheet>

                {displayConfig?.enabledSortOptions && displayConfig.enabledSortOptions.length > 0 && (
                  <Select value={sort} onValueChange={(v) => updateFilters({ sort: v })}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Sortiraj po" />
                    </SelectTrigger>
                    <SelectContent>
                      {displayConfig.enabledSortOptions.includes("RECOMMENDED") && <SelectItem value="RECOMMENDED">Preporučeno</SelectItem>}
                      {displayConfig.enabledSortOptions.includes("NEWEST") && <SelectItem value="NEWEST">Najnovije</SelectItem>}
                      {displayConfig.enabledSortOptions.includes("PRICE_ASC") && <SelectItem value="PRICE_ASC">Cena rastuće</SelectItem>}
                      {displayConfig.enabledSortOptions.includes("PRICE_DESC") && <SelectItem value="PRICE_DESC">Cena opadajuće</SelectItem>}
                      {displayConfig.enabledSortOptions.includes("MOST_POPULAR") && <SelectItem value="MOST_POPULAR">Najpopularnije</SelectItem>}
                      {displayConfig.enabledSortOptions.includes("BEST_RATED") && <SelectItem value="BEST_RATED">Najbolje ocenjeno</SelectItem>}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            {activeFiltersCount > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {brandList.map(b => (
                  <Badge key={`b-${b}`} variant="secondary" className="px-3 py-1 text-sm font-normal gap-2 flex items-center">
                    {b} <button onClick={() => updateFilters({ brand: brandList.filter(x => x !== b) })}><X className="w-3 h-3 hover:text-destructive" /></button>
                  </Badge>
                ))}
                {productTypeList.map(p => (
                  <Badge key={`p-${p}`} variant="secondary" className="px-3 py-1 text-sm font-normal gap-2 flex items-center">
                    {facets?.productTypes?.find((x: any) => x.value === p)?.label || p} <button onClick={() => updateFilters({ productType: productTypeList.filter(x => x !== p) })}><X className="w-3 h-3 hover:text-destructive" /></button>
                  </Badge>
                ))}
                {needTagList.map(n => (
                  <Badge key={`n-${n}`} variant="secondary" className="px-3 py-1 text-sm font-normal gap-2 flex items-center">
                    {facets?.needTags?.find((x: any) => x.value === n)?.label || n} <button onClick={() => updateFilters({ needTag: needTagList.filter(x => x !== n) })}><X className="w-3 h-3 hover:text-destructive" /></button>
                  </Badge>
                ))}
                {(minPrice != null || maxPrice != null) && (
                  <Badge variant="secondary" className="px-3 py-1 text-sm font-normal gap-2 flex items-center">
                    {minPrice != null ? `${money(minPrice)}` : "0 RSD"} - {maxPrice != null ? `${money(maxPrice)}` : "Maks."}
                    <button onClick={() => updateFilters({ minPrice: null, maxPrice: null })}><X className="w-3 h-3 hover:text-destructive" /></button>
                  </Badge>
                )}
                <Button variant="ghost" size="sm" onClick={() => updateFilters({ brand: [], productType: [], needTag: [], minPrice: null, maxPrice: null })} className="h-7 text-muted-foreground hover:text-foreground">
                  Obriši sve
                </Button>
              </div>
            )}

            {page === 1 && !categoryPath && !debouncedSearch && activeFiltersCount === 0 && supplierBundles.length > 0 && (
              <div className="mb-10">
                <h2 className="text-xl font-serif font-bold mb-4 flex items-center gap-2">
                  <Package className="w-5 h-5 text-primary" /> Promo Paketi
                </h2>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {supplierBundles.map((bundle) => (
                    <PublicBundleCard key={bundle.id} bundle={bundle} supplierSlug={supplier.slug} onQuickView={setQuickViewBundleId} />
                  ))}
                </div>
              </div>
            )}

            {productsLoading ? (
              <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : productsError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center text-destructive">Proizvodi trenutno nisu dostupni.</div>
            ) : productsData?.items.length ? (
              <>
                <p className="mb-5 text-sm text-muted-foreground">Prikazano {productsData.items.length} od {productsData.total} proizvoda.</p>
                {renderProductGridWithBanners(productsData.items)}
                {productsData.totalPages > 1 && (
                  <div className="mt-10 flex items-center justify-center gap-3">
                    <Button variant="outline" onClick={() => updateFilters({ page: Math.max(1, page - 1) })} disabled={page <= 1}><ChevronLeft className="mr-1 h-4 w-4" /> Prethodna</Button>
                    <span className="text-sm text-muted-foreground">Strana {productsData.page} od {productsData.totalPages}</span>
                    <Button variant="outline" onClick={() => updateFilters({ page: Math.min(productsData.totalPages, page + 1) })} disabled={page >= productsData.totalPages}>Sledeća <ChevronRight className="ml-1 h-4 w-4" /></Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border bg-muted/20 px-6 text-center">
                <ShoppingBag className="h-10 w-10 text-muted-foreground" />
                <h2 className="mt-4 font-serif text-xl font-semibold">Nema proizvoda</h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">Trenutno nema proizvoda za izabrane filtere.</p>
              </div>
            )}
          </div>
        </div>
      </main>
      {quickViewBundleId && supplier && (
        <PublicBundleQuickView bundleId={quickViewBundleId} supplierSlug={supplier.slug} onClose={() => setQuickViewBundleId(null)} />
      )}
    </Layout>
  );
}

function ProductReviews({ supplierSlug, productId, isCustomer }: { supplierSlug: string, productId: string, isCustomer: boolean }) {
  const { data: reviewsData, isLoading } = useListSupplierPublicProductReviews(supplierSlug, productId, { query: { enabled: !!supplierSlug && !!productId, queryKey: getListSupplierPublicProductReviewsQueryKey(supplierSlug, productId) } });
  const { data: userContext, refetch: refetchContext } = useGetCustomerRetailProductReviewContext(productId, { query: { enabled: isCustomer && !!productId, queryKey: getGetCustomerRetailProductReviewContextQueryKey(productId) } });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const createReview = useCreateCustomerRetailProductReview({
    mutation: {
    onSuccess: () => {
      toast.success("Recenzija je sačuvana.");
      setIsReviewDialogOpen(false);
      refetchContext();
      queryClient.invalidateQueries({ queryKey: getListSupplierPublicProductReviewsQueryKey(supplierSlug, productId) });
    },
    onError: (err) => toast.error(extractApiError(err, "Nije moguće sačuvati recenziju."))
    }
  });

  const reportReview = useReportRetailProductReview({
    mutation: {
      onSuccess: () => toast.success("Recenzija je prijavljena administratorima."),
      onError: (err) => toast.error("Greška pri prijavi.")
    }
  });

  if (isLoading) return <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  const reviewsList = reviewsData?.items ?? [];

  return (
    <div className="mt-14 pt-10 border-t" id="reviews">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <h2 className="font-serif text-2xl font-bold">Iskustva kupaca</h2>
        {isCustomer && userContext?.eligible && !userContext?.review && (
          <Button onClick={() => setIsReviewDialogOpen(true)}>Napišite recenziju</Button>
        )}
      </div>

      {reviewsList.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2">
          {reviewsList.map((rev) => (
            <div key={rev.id} className="p-5 rounded-2xl border bg-card shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                    {rev.reviewerName?.[0] || "K"}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{rev.reviewerName || "Kupac"}</p>
                    <div className="flex items-center text-amber-500">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className={`w-3.5 h-3.5 ${i < rev.rating ? "fill-amber-500" : "fill-muted text-muted-foreground/30"}`} />
                      ))}
                    </div>
                  </div>
                </div>
                {rev.verifiedPurchase && <Badge variant="secondary" className="text-[10px]"><ShieldCheck className="w-3 h-3 mr-1" />Potvrđena kupovina</Badge>}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{rev.comment}</p>
              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>{new Date(rev.createdAt).toLocaleDateString("sr-RS")}</span>
                <button onClick={() => {
                  reportReview.mutate({ reviewId: rev.id, data: { reason: "OTHER", explanation: "Korisnik je prijavio recenziju." } });
                }} className="hover:text-destructive flex items-center gap-1">
                  <Flag className="w-3 h-3" /> Prijavi
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-10 rounded-2xl border bg-muted/20">
          <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">Trenutno nema recenzija za ovaj proizvod.</p>
        </div>
      )}

      <Dialog open={isReviewDialogOpen} onOpenChange={setIsReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vaše iskustvo</DialogTitle>
            <DialogDescription>Ocenite proizvod i podelite svoje utiske.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <Label className="mb-2 block">Ocena</Label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(star => (
                  <button key={star} onClick={() => setRating(star)} className="text-amber-500 hover:scale-110 transition-transform">
                    <Star className={`w-8 h-8 ${rating >= star ? "fill-amber-500" : "fill-muted text-muted-foreground/30"}`} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-2 block">Komentar</Label>
              <Textarea rows={4} value={comment} onChange={e => setComment(e.target.value)} placeholder="Napišite svoje utiske..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReviewDialogOpen(false)}>Odustani</Button>
            <Button onClick={() => createReview.mutate({ productId, data: { rating, comment } })} disabled={createReview.isPending || !comment.trim()}>
              {createReview.isPending ? "Čuvanje..." : "Sačuvaj recenziju"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PublicProductDetailPage() {
  const [, params] = useRoute("/shop/:supplierSlug/proizvod/:productId");
  const supplierSlug = params?.supplierSlug ?? "";
  const productId = params?.productId ?? "";

  const { data: userResp } = useGetCurrentUser();
  const isCustomer = userResp?.user?.role === "CUSTOMER" || userResp?.user?.role === "JOBSEEKER";

  const { data: supplier } = useGetPublicSupplier(supplierSlug, { query: { enabled: !!supplierSlug, queryKey: getGetPublicSupplierQueryKey(supplierSlug) } });
  const { data: product, isLoading, isError } = useGetSupplierPublicProduct(supplierSlug, productId, { query: { enabled: !!supplierSlug && !!productId, queryKey: getGetSupplierPublicProductQueryKey(supplierSlug, productId) } });

  const recordView = useRecordRecentlyViewedProduct();
  useEffect(() => {
    if (supplierSlug && productId) {
      recordView.mutate({ supplierSlug, productId });
    }
  }, [supplierSlug, productId]);

  const { data: recentlyViewed } = useListRecentlyViewedProducts(supplierSlug, { query: { enabled: !!supplierSlug, queryKey: getListRecentlyViewedProductsQueryKey(supplierSlug) } });

  const { data: waitlistStatus, refetch: refetchWaitlist } = useGetB2cProductWaitlistStatus(productId, { query: { enabled: !!productId, queryKey: getGetB2cProductWaitlistStatusQueryKey(productId) } });
  const subscribeWaitlist = useSubscribeB2cProductWaitlist({ mutation: { onSuccess: () => { toast.success("Prijavljeni ste na listu čekanja."); refetchWaitlist(); } } });
  const unsubscribeWaitlist = useUnsubscribeB2cProductWaitlist({ mutation: { onSuccess: () => { toast.success("Odjavljeni ste sa liste čekanja."); refetchWaitlist(); } } });

  const queryClient = useQueryClient();
  const { data: wishlist = [] } = useListProductWishlist({ query: { enabled: isCustomer, queryKey: getListProductWishlistQueryKey() } });
  const isWishlisted = wishlist.some(w => w.productId === productId);
  const toggleWishlist = useToggleProductWishlistItem({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getListProductWishlistQueryKey() });
        if (res.saved) toast.success("Proizvod je sačuvan u listu želja.");
        else toast.success("Proizvod je uklonjen iz liste želja.");
      }
    }
  });

  const [showSubDialog, setShowSubDialog] = useState(false);
  const [subFreq, setSubFreq] = useState<RetailProductSubscriptionInputFrequency>("MONTHLY");
  const [subPayment, setSubPayment] = useState<RetailProductSubscriptionInputPaymentMethod>("CARD");
  const [subDelivery, setSubDelivery] = useState<RetailProductSubscriptionInputDeliveryMethod>("courier");
  const [subContact, setSubContact] = useState({ firstName: userResp?.user?.firstName ?? "", lastName: userResp?.user?.lastName ?? "", email: userResp?.user?.email ?? "", phone: userResp?.user?.phone ?? "" });
  const [subAddress, setSubAddress] = useState({ street: "", city: "", postalCode: "" });
  const createSub = useCreateRetailProductSubscription({
    mutation: {
      onSuccess: () => {
        toast.success("Pretplata je uspešno kreirana.");
        setShowSubDialog(false);
      },
      onError: (err) => toast.error(extractApiError(err, "Nije moguće kreirati pretplatu."))
    }
  });

  const { toast } = useToast();
  const productName = product?.name ?? "Proizvod";
  const addRetailCartItem = useAddRetailCartItem();
  const add = () => {
    addRetailCartItem.mutate({ data: { productId, quantity: 1 } }, {
      onSuccess: (cart) => {
        const changedItem = cart.items?.find((item) => item.kind === 'product' && item.productId === productId);
        notifyRetailCartChanged(cart.itemCount, {
          productId,
          name: changedItem?.name ?? productName,
          quantity: changedItem?.quantity ?? 1,
        });
        toast.success("Proizvod je dodat u korpu.");
      },
      onError: (error) => toast.error(extractApiError(error, "Proizvod trenutno nije dostupan."))
    });
  };
  const adding = addRetailCartItem.isPending;

  const gallery = product ? [product.imageUrl, ...(product.images || []).filter((image) => image !== product.imageUrl)] : [];
  const [activeThumbnail, setActiveThumbnail] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  useEffect(() => {
    if (product) {
      setActiveThumbnail(product.imageUrl);
      setLightboxImage(null);
    }
  }, [product?.id]);

  if (isLoading || !supplier) return <Layout><div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></Layout>;
  if (isError || !product) {
    return <Layout><main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-5 text-center"><ShoppingBag className="h-10 w-10 text-muted-foreground" /><h1 className="mt-4 font-serif text-3xl font-bold">Proizvod nije dostupan</h1><p className="mt-2 text-muted-foreground">Ovaj proizvod nije javno objavljen ili više nije dostupan.</p><Button asChild className="mt-6"><Link href={`/shop/${supplierSlug}`}>Nazad na proizvode</Link></Button></main></Layout>;
  }

  const currentHeroImage = activeThumbnail || gallery[0];
  const productDetail = product as any;
  const rating = productDetail.reviewSummary?.averageRating;
  const count = productDetail.reviewSummary?.reviewCount;

  return (
    <Layout>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center text-sm text-muted-foreground gap-2">
          <Link href="/proizvodi" className="hover:text-primary transition-colors">Svi dobavljači</Link>
          <ChevronRight className="w-3 h-3" />
          <Link href={`/shop/${supplierSlug}`} className="hover:text-primary transition-colors">{supplier.name}</Link>
        </div>

        <section className="mt-8 grid gap-12 lg:grid-cols-2">
          <div>
            <button
              className="aspect-square w-full rounded-3xl overflow-hidden bg-muted cursor-zoom-in relative group border shadow-sm block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&>picture]:contents"
              onClick={() => setLightboxImage(currentHeroImage)}
              onKeyDown={(e) => e.key === "Enter" && setLightboxImage(currentHeroImage)}
              aria-label="Prikaži sliku u punoj veličini"
            >
              <OptimizedImage src={currentHeroImage} alt={product.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <div className="bg-background/90 backdrop-blur rounded-full p-3 text-foreground shadow-lg">
                  <Eye className="w-5 h-5" />
                </div>
              </div>
            </button>
            {gallery.length > 1 && (
              <div className="mt-4 grid grid-cols-4 sm:grid-cols-5 gap-3">
                {gallery.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveThumbnail(img)}
                    onDoubleClick={() => setLightboxImage(img)}
                    className={`aspect-square rounded-xl overflow-hidden bg-muted border-2 transition-colors [&>picture]:contents ${activeThumbnail === img ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-primary/50"}`}
                    aria-label={`Slika ${i+1}`}
                  >
                    <OptimizedImage src={img} alt={`Slika ${i+1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="max-w-xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">{product.brand ?? product.category}</p>
            <h1 className="mt-2 font-serif text-4xl font-bold tracking-tight pr-12 relative text-foreground">
              {product.name}
              {isCustomer && (
                <button
                  onClick={() => toggleWishlist.mutate({ data: { productId } })}
                  className="absolute right-0 top-1 w-10 h-10 rounded-full bg-muted/50 hover:bg-muted border flex items-center justify-center text-muted-foreground hover:text-rose-500 transition-colors"
                >
                  <Heart className={`w-5 h-5 ${isWishlisted ? "fill-rose-500 text-rose-500" : ""}`} />
                </button>
              )}
            </h1>

            <a href="#reviews" className="inline-block hover:opacity-80 transition-opacity">
              <StarRating rating={rating} count={count} />
            </a>

            <div className="mt-6"><ProductPrice product={product} /></div>

            {productDetail.productType || (productDetail.needTags && productDetail.needTags.length > 0) ? (
              <div className="mt-6 flex flex-wrap gap-2">
                {productDetail.productType && <Badge variant="secondary">{productDetail.productType.label}</Badge>}
                {productDetail.needTags?.map((t: any) => <Badge key={t.key} variant="outline" className="border-primary/20 text-primary">{t.label}</Badge>)}
              </div>
            ) : null}

            <div className="mt-8 space-y-6 text-sm text-muted-foreground leading-relaxed">
              <div>
                <h3 className="text-foreground font-semibold mb-2">Opis</h3>
                <p className="whitespace-pre-line">{product.description}</p>
              </div>

              {productDetail.usageInstructions && (
                <div>
                  <h3 className="text-foreground font-semibold mb-2">Način upotrebe</h3>
                  <p className="whitespace-pre-line">{productDetail.usageInstructions}</p>
                </div>
              )}

              {productDetail.ingredients && (
                <div>
                  <h3 className="text-foreground font-semibold mb-2">Sastav (INCI)</h3>
                  <p className="whitespace-pre-line text-xs">{productDetail.ingredients}</p>
                </div>
              )}
            </div>

            {product.deliveryBusinessDaysOverride != null && (
              <p className="mt-6 text-sm flex items-center text-muted-foreground" data-testid="text-public-estimated-delivery">
                <Clock className="w-4 h-4 mr-2 text-primary" />
                Procenjena isporuka: {product.deliveryBusinessDaysOverride} {product.deliveryBusinessDaysOverride === 1 ? "radni dan" : "radnih dana"}
              </p>
            )}

            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" className="flex-1 sm:flex-none min-w-[200px]" onClick={add} disabled={adding}>{adding ? "Dodavanje…" : "Dodaj u korpu"}</Button>
              <Button size="lg" variant="outline" className="flex-1 sm:flex-none" asChild><Link href="/korpa">Pregled korpe</Link></Button>
            </div>

            {Boolean(product.subscriptionAllowed) && isCustomer && (
              <div className="mt-6 p-5 rounded-2xl border bg-primary/5 flex items-center justify-between border-primary/20">
                <div>
                  <h3 className="font-semibold text-primary flex items-center gap-2">
                    <CalendarClock className="w-5 h-5" />
                    Pretplata na proizvod
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">Uštedite {product.subscriptionDiscountPercent ?? 0}% redovnom isporukom.</p>
                </div>
                <Button variant="secondary" onClick={() => setShowSubDialog(true)}>Podesi</Button>
              </div>
            )}

            <div className="mt-6 p-4 rounded-xl border bg-muted/20">
              {waitlistStatus?.subscribed ? (
                <div className="space-y-3">
                  <p className="text-sm flex items-center text-emerald-600"><CheckCircle className="w-4 h-4 mr-2" /> Obavestićemo vas čim stigne.</p>
                  <Button variant="outline" size="sm" onClick={() => unsubscribeWaitlist.mutate({ productId })} disabled={unsubscribeWaitlist.isPending}>Odjavi me</Button>
                </div>
              ) : (
                <Button variant="secondary" className="w-full sm:w-auto" onClick={() => subscribeWaitlist.mutate({ productId })} disabled={subscribeWaitlist.isPending}><Bell className="w-4 h-4 mr-2" /> Javi mi kad stigne na stanje</Button>
              )}
            </div>
          </div>
        </section>

        <ProductReviews supplierSlug={supplierSlug} productId={productId} isCustomer={isCustomer} />

        {productDetail.relatedProducts?.length > 0 && (
          <section className="mt-16 pt-10 border-t" data-testid="section-public-related-products">
            <h2 className="mb-6 font-serif text-2xl font-bold">Kupci su gledali i ovo</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {productDetail.relatedProducts.map((related: any) => {
                const relatedPrice = related.discountPrice ?? related.price;
                return (
                  <Link key={related.id} href={`/shop/${supplierSlug}/proizvod/${related.id}`} className="group overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md flex flex-col" data-testid={`public-related-product-${related.id}`}>
                    <div className="aspect-square overflow-hidden bg-muted"><OptimizedImage src={related.imageUrl} alt={related.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" /></div>
                    <div className="p-4 flex-1 flex flex-col">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{related.brand ?? "Proizvod"}</p>
                      <h3 className="mt-1 line-clamp-2 font-serif font-semibold">{related.name}</h3>
                      <div className="mt-auto pt-3 flex items-baseline gap-2">
                        <p className="font-bold text-primary">{money(relatedPrice)}</p>
                        {related.discountPrice != null && <p className="text-xs text-muted-foreground line-through">{money(related.price)}</p>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {recentlyViewed && recentlyViewed.length > 0 && (
          <section className="mt-16 pt-10 border-t">
            <h2 className="mb-6 font-serif text-2xl font-bold">Nedavno pregledano</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {recentlyViewed.filter(p => p.id !== productId).slice(0, 5).map((viewed: any) => (
                <Link key={viewed.id} href={`/shop/${supplierSlug}/proizvod/${viewed.id}`} className="group overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md flex flex-col">
                  <div className="aspect-square overflow-hidden bg-muted"><OptimizedImage src={viewed.imageUrl} alt={viewed.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" /></div>
                  <div className="p-3 flex-1 flex flex-col">
                    <h3 className="line-clamp-2 text-sm font-semibold">{viewed.name}</h3>
                    <p className="mt-auto pt-2 font-bold text-sm text-primary">{money(viewed.discountPrice ?? viewed.price)}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Lightbox */}
      {lightboxImage && (
        <Dialog open={!!lightboxImage} onOpenChange={() => setLightboxImage(null)}>
          <DialogContent className="max-w-[90vw] max-h-[90vh] p-1 bg-transparent border-none shadow-none flex items-center justify-center">
            <DialogTitle className="sr-only">Pregled slike</DialogTitle>
            <div className="relative w-full h-full flex items-center justify-center">
              <img src={lightboxImage} alt={product.name} className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" />
              <Button
                variant="secondary"
                size="icon"
                className="absolute top-2 right-2 rounded-full shadow-md bg-black/50 hover:bg-black text-white"
                onClick={() => setLightboxImage(null)}
              >
                <X className="w-5 h-5" />
                <span className="sr-only">Zatvori</span>
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {showSubDialog && (
        <Dialog open={showSubDialog} onOpenChange={setShowSubDialog}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Pretplata na proizvod</DialogTitle>
              <DialogDescription>Izaberite dinamiku isporuke. Redovnom pretplatom štedite {product.subscriptionDiscountPercent ?? 0}%.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto px-2">
              <div className="space-y-2">
                <Label>Dinamika isporuke</Label>
                <Select value={subFreq} onValueChange={(v: any) => setSubFreq(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WEEKLY">Nedeljno</SelectItem>
                    <SelectItem value="BIWEEKLY">Na dve nedelje</SelectItem>
                    <SelectItem value="MONTHLY">Mesečno</SelectItem>
                    <SelectItem value="EVERY_TWO_MONTHS">Na dva meseca</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Ime</Label>
                  <Input value={subContact.firstName} onChange={e => setSubContact({ ...subContact, firstName: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Prezime</Label>
                  <Input value={subContact.lastName} onChange={e => setSubContact({ ...subContact, lastName: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={subContact.email} onChange={e => setSubContact({ ...subContact, email: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Telefon</Label>
                  <Input value={subContact.phone} onChange={e => setSubContact({ ...subContact, phone: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2 border-t pt-4">
                <Label className="font-semibold">Adresa isporuke</Label>
                <Input placeholder="Ulica i broj" value={subAddress.street} onChange={e => setSubAddress({ ...subAddress, street: e.target.value })} />
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <Input placeholder="Grad" value={subAddress.city} onChange={e => setSubAddress({ ...subAddress, city: e.target.value })} />
                  <Input placeholder="Poštanski broj" value={subAddress.postalCode} onChange={e => setSubAddress({ ...subAddress, postalCode: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2 border-t pt-4">
                <Label>Način plaćanja</Label>
                <RadioGroup value={subPayment} onValueChange={(v: any) => setSubPayment(v)}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="CARD" id="r1" />
                    <Label htmlFor="r1">Platna kartica</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="BANK_TRANSFER" id="r2" />
                    <Label htmlFor="r2">Uplata na račun (uplatnica)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="CASH_ON_DELIVERY" id="r3" />
                    <Label htmlFor="r3">Pouzećem</Label>
                  </div>
                </RadioGroup>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowSubDialog(false)}>Odustani</Button>
              <Button onClick={() => {
                if (!subContact.firstName || !subContact.lastName || !subContact.email || !subContact.phone || !subAddress.street || !subAddress.city || !subAddress.postalCode) {
                  toast.error("Molimo popunite sva polja.");
                  return;
                }
                createSub.mutate({
                  data: {
                    productId,
                    quantity: 1,
                    frequency: subFreq,
                    paymentMethod: subPayment,
                    deliveryMethod: subDelivery,
                    contact: subContact,
                    delivery: subAddress
                  }
                });
              }} disabled={createSub.isPending}>
                {createSub.isPending ? "Kreiranje..." : "Potvrdi pretplatu"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Layout>
  );
}
