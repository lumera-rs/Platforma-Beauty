import { useMemo, useState, useEffect } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ChevronLeft, ChevronRight, Loader2, Search, ShoppingBag, Sparkles, Building2, Bell, CheckCircle, Package, Eye, Heart, CalendarClock } from "lucide-react";
import {
  useGetSupplierPublicProduct, useListSupplierPublicProducts, useListPublicSuppliers,
  useGetPublicSupplier, useListSupplierCategories, getGetPublicSupplierQueryKey,
  getListSupplierPublicProductsQueryKey, getListSupplierCategoriesQueryKey,
  getGetSupplierPublicProductQueryKey, useAddRetailCartItem,
  useGetB2cProductWaitlistStatus, useSubscribeB2cProductWaitlist, useUnsubscribeB2cProductWaitlist,
  getGetB2cProductWaitlistStatusQueryKey,
  useListPublicBundles, useGetPublicBundle, getListPublicBundlesQueryKey, getGetPublicBundleQueryKey,
  useToggleProductWishlistItem, useListProductWishlist, getListProductWishlistQueryKey,
  useGetCurrentUser, useCreateRetailProductSubscription,
  RetailProductSubscriptionInputFrequency, RetailProductSubscriptionInputPaymentMethod, RetailProductSubscriptionInputDeliveryMethod
} from "@workspace/api-client-react";
import type { ListSupplierPublicProductsParams, PublicProduct, PublicBundle } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { OptimizedImage } from "@/components/optimized-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";
import { notifyRetailCartChanged } from "@/lib/retail-cart-events";
import { extractApiError } from "@/lib/admin-form-utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
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
  return (
    <article className="group overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md relative">
      {isCustomer && onToggleWishlist && (
        <button
          onClick={(e) => { e.preventDefault(); onToggleWishlist(product.id); }}
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-white/80 backdrop-blur border shadow-sm flex items-center justify-center text-muted-foreground hover:text-rose-500 transition-colors"
          data-testid={`button-wishlist-${product.id}`}
        >
          <Heart className={`w-4 h-4 ${isWishlisted ? "fill-rose-500 text-rose-500" : ""}`} />
        </button>
      )}
      <Link href={`/shop/${supplierSlug}/proizvod/${product.id}`} className="block" data-testid={`public-product-link-${product.id}`}>
        <div className="aspect-square overflow-hidden bg-muted">
          <OptimizedImage src={product.imageUrl} alt={product.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        </div>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            {product.isNew && <Badge className="bg-sky-600 text-white">Novo</Badge>}
            {product.discountPercent != null && <Badge className="bg-rose-600 text-white">−{product.discountPercent}%</Badge>}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{product.brand ?? product.category}</p>
            <h2 className="mt-1 line-clamp-2 font-serif text-lg font-semibold text-foreground">{product.name}</h2>
          </div>
          <p className="line-clamp-2 text-sm text-muted-foreground">{product.description}</p>
          <ProductPrice product={product} />
        </div>
      </Link>
      <div className="px-4 pb-4"><Button className="w-full" onClick={add} disabled={adding} data-testid={`public-product-add-${product.id}`}>{adding ? "Dodavanje…" : "Dodaj u korpu"}</Button></div>
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
    <article className="group overflow-hidden rounded-2xl border border-primary/20 bg-primary/5 shadow-sm transition-shadow hover:shadow-md flex flex-col relative">
      <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
        <Badge className="bg-primary text-white"><Package className="w-3 h-3 mr-1" />Promo Paket</Badge>
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
          <h2 className="mt-1 line-clamp-2 font-serif text-lg font-semibold text-foreground"><button onClick={() => onQuickView(bundle.id)} className="text-left hover:text-primary">{bundle.name}</button></h2>
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

export function PublicSupplierShop() {
  const [location] = useLocation();
  const pathSegments = location.split("?")[0].split("/").filter(Boolean);
  const supplierSlug = pathSegments[1] ?? "";
  const categoryPath = pathSegments.slice(2).join("/");

  const { data: userResp } = useGetCurrentUser();
  const isCustomer = userResp?.user?.role === "CUSTOMER";

  const { data: supplier, isLoading: supplierLoading, isError: supplierError } = useGetPublicSupplier(supplierSlug, { query: { enabled: !!supplierSlug, queryKey: getGetPublicSupplierQueryKey(supplierSlug) } });

  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedSearch(search);

  const { data: categories = [], isLoading: categoriesLoading } = useListSupplierCategories(supplierSlug, { query: { enabled: !!supplierSlug, queryKey: getListSupplierCategoriesQueryKey(supplierSlug) } });
  const selectedCategory = categoryPath ? categories.find((category) => category.path === categoryPath) : undefined;
  const queryParams = useMemo<ListSupplierPublicProductsParams>(() => ({
    page,
    pageSize: 24,
    ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
    ...(selectedCategory ? { categoryId: selectedCategory.id } : {}),
    ...(brand.trim() ? { brand: brand.trim() } : {}),
  }), [debouncedSearch, selectedCategory, brand, page]);

  const { data: productsData, isLoading: productsLoading, isError: productsError } = useListSupplierPublicProducts(supplierSlug, queryParams, {
    query: {
      enabled: !!supplierSlug && (!categoryPath || Boolean(selectedCategory)),
      queryKey: getListSupplierPublicProductsQueryKey(supplierSlug, queryParams),
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
        if (res.saved) {
          toast.success("Proizvod je sačuvan u listu želja.");
        } else {
          toast.success("Proizvod je uklonjen iz liste želja.");
        }
      }
    }
  });

  const handleToggleWishlist = (productId: string) => {
    toggleWishlist.mutate({ data: { productId } });
  };

  const { data: allBundles = [] } = useListPublicBundles({ query: { enabled: !!supplierSlug, queryKey: getListPublicBundlesQueryKey() } });
  const supplierBundles = useMemo(() => allBundles.filter(b => b.supplierId === supplier?.id), [allBundles, supplier?.id]);
  const [quickViewBundleId, setQuickViewBundleId] = useState<string | null>(null);

  const { toast } = useToast();

  const renderCategoryLinks = (parentId: string | null, depth = 0) => categories
    .filter((category) => (category.parentId ?? null) === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => (
      <div key={category.id}>
        <Link
          href={`/shop/${supplierSlug}/${category.path}`}
          className={`block rounded-md py-1.5 pr-2 text-sm ${selectedCategory?.id === category.id ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}
          style={{ paddingLeft: `${0.5 + depth}rem` }}
          data-testid={`public-category-${category.id}`}
        >
          {category.name}
        </Link>
        {renderCategoryLinks(category.id, depth + 1)}
      </div>
    ));

  if (supplierLoading) return <Layout><div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></Layout>;
  if (supplierError || !supplier) return <Layout><main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-5 text-center"><Building2 className="h-10 w-10 text-muted-foreground" /><h1 className="mt-4 font-serif text-3xl font-bold">Dobavljač nije pronađen</h1><Button asChild className="mt-6"><Link href="/proizvodi">Svi dobavljači</Link></Button></main></Layout>;
  if (!categoriesLoading && categoryPath && !selectedCategory) return <Layout><main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-5 text-center"><ShoppingBag className="h-10 w-10 text-muted-foreground" /><h1 className="mt-4 font-serif text-3xl font-bold">Kategorija nije pronađena</h1><Button asChild className="mt-6"><Link href={`/shop/${supplierSlug}`}>Nazad na katalog</Link></Button></main></Layout>;

  return (
    <Layout>
      <main className="mx-auto min-h-screen max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 text-sm text-muted-foreground flex items-center gap-2">
          <Link href="/proizvodi" className="hover:text-primary transition-colors">Svi dobavljači</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground">{supplier.name}</span>
        </div>

        <section className="rounded-3xl bg-card border px-6 py-8 sm:px-10 mb-8 flex flex-col md:flex-row gap-6 items-center shadow-sm">
          {supplier.logoUrl && (
            <div className="w-24 h-24 shrink-0 rounded-full border bg-muted overflow-hidden flex items-center justify-center">
              <OptimizedImage src={supplier.logoUrl} alt={supplier.name} width={96} height={96} preferredSize="thumbnail" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="text-center md:text-left">
            <h1 className="font-serif text-3xl font-bold">{supplier.name}</h1>
            <p className="mt-2 text-muted-foreground">Kupovina direktno od dobavljača</p>
          </div>
        </section>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar filters */}
          <aside className="w-full lg:w-64 shrink-0 space-y-8">
            <div>
              <h3 className="font-semibold mb-4">Kategorije</h3>
              <div className="space-y-2">
                <Link href={`/shop/${supplier.slug}`} className={`block text-sm py-1 ${!categoryPath ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`} data-testid="public-category-all">Svi proizvodi</Link>
                {renderCategoryLinks(null)}
              </div>
            </div>

            <div className="space-y-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Pretraga..." className="pl-9 h-9 text-sm" />
              </label>
              <Input value={brand} onChange={(event) => { setBrand(event.target.value); setPage(1); }} placeholder="Brend" className="h-9 text-sm" />
            </div>
          </aside>

          {/* Main content */}
          <div className="flex-1">
            {page === 1 && !categoryPath && !debouncedSearch && supplierBundles.length > 0 && (
              <div className="mb-10">
                <h2 className="text-xl font-serif font-bold mb-4 flex items-center gap-2">
                  <Package className="w-5 h-5 text-primary" /> Promo Paketi
                </h2>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {supplierBundles.map((bundle) => (
                    <PublicBundleCard key={bundle.id} bundle={bundle} supplierSlug={supplier.slug} onQuickView={setQuickViewBundleId} />
                  ))}
                </div>
              </div>
            )}

            <h2 className="text-xl font-serif font-bold mb-4 flex items-center gap-2 text-foreground">Proizvodi</h2>

            {productsLoading ? (
              <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : productsError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center text-destructive">Proizvodi trenutno nisu dostupni.</div>
            ) : productsData?.items.length ? (
              <>
                <p className="mb-5 text-sm text-muted-foreground">Prikazano {productsData.items.length} od {productsData.total} proizvoda.</p>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {productsData.items.map((product) => (
                    <PublicProductCard
                      key={product.id}
                      product={product}
                      supplierSlug={supplier.slug}
                      isCustomer={isCustomer}
                      isWishlisted={wishlist.some(w => w.productId === product.id)}
                      onToggleWishlist={handleToggleWishlist}
                    />
                  ))}
                </div>
                {productsData.totalPages > 1 && (
                  <div className="mt-10 flex items-center justify-center gap-3">
                    <Button variant="outline" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}><ChevronLeft className="mr-1 h-4 w-4" /> Prethodna</Button>
                    <span className="text-sm text-muted-foreground">Strana {productsData.page} od {productsData.totalPages}</span>
                    <Button variant="outline" onClick={() => setPage((current) => Math.min(productsData.totalPages, current + 1))} disabled={page >= productsData.totalPages}>Sledeća <ChevronRight className="ml-1 h-4 w-4" /></Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border bg-muted/20 px-6 text-center">
                <ShoppingBag className="h-10 w-10 text-muted-foreground" />
                <h2 className="mt-4 font-serif text-xl font-semibold">Nema proizvoda</h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">Ovaj dobavljač trenutno nema proizvoda za izabrane filtere.</p>
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

export function PublicProductDetailPage() {
  const [, params] = useRoute("/shop/:supplierSlug/proizvod/:productId");
  const supplierSlug = params?.supplierSlug ?? "";
  const productId = params?.productId ?? "";

  const { data: userResp } = useGetCurrentUser();
  const isCustomer = userResp?.user?.role === "CUSTOMER";

  const { data: supplier } = useGetPublicSupplier(supplierSlug, { query: { enabled: !!supplierSlug, queryKey: getGetPublicSupplierQueryKey(supplierSlug) } });

  const { data: product, isLoading, isError } = useGetSupplierPublicProduct(supplierSlug, productId, { query: { enabled: !!supplierSlug && !!productId, queryKey: getGetSupplierPublicProductQueryKey(supplierSlug, productId) } });

  const { data: waitlistStatus, refetch: refetchWaitlist } = useGetB2cProductWaitlistStatus(productId, { query: { enabled: !!productId, queryKey: getGetB2cProductWaitlistStatusQueryKey(productId) } });
  const subscribeWaitlist = useSubscribeB2cProductWaitlist({ mutation: { onSuccess: () => { toast.success("Prijavljeni ste na listu čekanja."); refetchWaitlist(); } } });
  const unsubscribeWaitlist = useUnsubscribeB2cProductWaitlist({ mutation: { onSuccess: () => { toast.success("Odjavljeni ste sa liste čekanja."); refetchWaitlist(); } } });

  const queryClient = useQueryClient();
  const { data: wishlist = [] } = useListProductWishlist({
    query: { enabled: isCustomer, queryKey: getListProductWishlistQueryKey() }
  });
  const isWishlisted = wishlist.some(w => w.productId === productId);
  const toggleWishlist = useToggleProductWishlistItem({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getListProductWishlistQueryKey() });
        if (res.saved) {
          toast.success("Proizvod je sačuvan u listu želja.");
        } else {
          toast.success("Proizvod je uklonjen iz liste želja.");
        }
      }
    }
  });

  // Subscription state
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
      onError: (err) => {
        toast.error(extractApiError(err, "Nije moguće kreirati pretplatu."));
      }
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
      onError: (error) => {
        toast.error(extractApiError(error, "Proizvod trenutno nije dostupan."));
      }
    });
  };
  const adding = addRetailCartItem.isPending;

  if (isLoading || !supplier) return <Layout><div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></Layout>;
  if (isError || !product) {
    return <Layout><main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-5 text-center"><ShoppingBag className="h-10 w-10 text-muted-foreground" /><h1 className="mt-4 font-serif text-3xl font-bold">Proizvod nije dostupan</h1><p className="mt-2 text-muted-foreground">Ovaj proizvod nije javno objavljen ili više nije dostupan.</p><Button asChild className="mt-6"><Link href={`/shop/${supplierSlug}`}>Nazad na proizvode</Link></Button></main></Layout>;
  }

  const gallery = [product.imageUrl, ...(product.images || []).filter((image) => image !== product.imageUrl)];
  return (
    <Layout>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center text-sm text-muted-foreground gap-2">
          <Link href="/proizvodi" className="hover:text-primary transition-colors">Svi dobavljači</Link>
          <ChevronRight className="w-3 h-3" />
          <Link href={`/shop/${supplierSlug}`} className="hover:text-primary transition-colors">{supplier.name}</Link>
        </div>

        <section className="mt-8 grid gap-10 lg:grid-cols-2">
          <div className="grid grid-cols-2 gap-3">
            {gallery.map((image, index) => <div key={image} className={index === 0 ? "col-span-2 aspect-[4/3] overflow-hidden rounded-2xl bg-muted" : "aspect-square overflow-hidden rounded-xl bg-muted"}><OptimizedImage src={image} alt={index === 0 ? product.name : `${product.name} ${index + 1}`} className="h-full w-full object-cover" /></div>)}
          </div>
          <div className="max-w-xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">{product.brand ?? product.category}</p>
            <h1 className="mt-2 font-serif text-4xl font-bold tracking-tight pr-12 relative">
              {product.name}
              {isCustomer && (
                <button
                  onClick={() => toggleWishlist.mutate({ data: { productId } })}
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-muted/50 hover:bg-muted border flex items-center justify-center text-muted-foreground hover:text-rose-500 transition-colors"
                >
                  <Heart className={`w-5 h-5 ${isWishlisted ? "fill-rose-500 text-rose-500" : ""}`} />
                </button>
              )}
            </h1>
            <div className="mt-5"><ProductPrice product={product} /></div>
            <p className="mt-7 whitespace-pre-line leading-7 text-muted-foreground">{product.description}</p>
            {product.deliveryBusinessDaysOverride != null && <p className="mt-4 text-sm text-muted-foreground" data-testid="text-public-estimated-delivery">Procenjena isporuka: {product.deliveryBusinessDaysOverride} {product.deliveryBusinessDaysOverride === 1 ? "radni dan" : "radnih dana"}</p>}

            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" onClick={add} disabled={adding}>{adding ? "Dodavanje…" : "Dodaj u korpu"}</Button>
              <Button size="lg" variant="outline" asChild><Link href="/korpa">Pogledaj korpu</Link></Button>
            </div>

            {Boolean(product.subscriptionAllowed) && isCustomer && (
              <div className="mt-4 p-5 rounded-xl border bg-primary/5 flex items-center justify-between border-primary/20">
                <div>
                  <h3 className="font-semibold text-primary flex items-center gap-2">
                    <CalendarClock className="w-5 h-5" />
                    Pretplata na proizvod
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">Uštedite {product.subscriptionDiscountPercent ?? 0}% redovnom isporukom.</p>
                </div>
                <Button variant="secondary" onClick={() => setShowSubDialog(true)}>Podesi pretplatu</Button>
              </div>
            )}

            <div className="mt-4 p-4 rounded-xl border bg-muted/20">
              {waitlistStatus?.subscribed ? (
                <div className="space-y-3">
                  <p className="text-sm flex items-center text-emerald-600"><CheckCircle className="w-4 h-4 mr-2" /> Prijavljeni ste za obaveštenje kada proizvod bude dostupan.</p>
                  <Button variant="outline" size="sm" onClick={() => unsubscribeWaitlist.mutate({ productId })} disabled={unsubscribeWaitlist.isPending}>Odjavi se</Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => subscribeWaitlist.mutate({ productId })} disabled={subscribeWaitlist.isPending}><Bell className="w-4 h-4 mr-2" /> Obavesti me kada bude dostupno</Button>
              )}
            </div>

            <div className="mt-5 rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground"><strong className="block text-foreground">Bezbedna retail kupovina</strong><span className="mt-1 block">Konačna dostupnost i javna cena proveravaju se ponovo prilikom potvrde porudžbine.</span></div>
          </div>
        </section>
        {product.relatedProducts.length > 0 && (
          <section className="mt-14" data-testid="section-public-related-products">
            <h2 className="mb-5 font-serif text-2xl font-bold">Slični proizvodi</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {product.relatedProducts.map((related) => {
                const relatedPrice = related.discountPrice ?? related.price;
                return (
                  <Link key={related.id} href={`/shop/${supplierSlug}/proizvod/${related.id}`} className="group overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md" data-testid={`public-related-product-${related.id}`}>
                    <div className="aspect-square overflow-hidden bg-muted"><OptimizedImage src={related.imageUrl} alt={related.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" /></div>
                    <div className="p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{related.brand ?? "Proizvod"}</p>
                      <h3 className="mt-1 line-clamp-2 font-serif font-semibold">{related.name}</h3>
                      <p className="mt-3 font-semibold">{money(relatedPrice)}</p>
                      {related.discountPrice != null && <p className="text-xs text-muted-foreground line-through">{money(related.price)}</p>}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </main>
      {showSubDialog && (
        <Dialog open={showSubDialog} onOpenChange={setShowSubDialog}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Pretplata na proizvod</DialogTitle>
              <DialogDescription>Izaberite dinamiku isporuke. Redovnom pretplatom štedite {product.subscriptionDiscountPercent ?? 0}%.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
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