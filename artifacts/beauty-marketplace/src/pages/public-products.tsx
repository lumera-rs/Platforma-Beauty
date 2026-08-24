import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { ChevronLeft, ChevronRight, Loader2, Search, ShoppingBag, Sparkles } from "lucide-react";
import { useGetPublicProduct, useListPublicProducts, type PublicProduct } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { OptimizedImage } from "@/components/optimized-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";
import { notifyRetailCartChanged } from "@/lib/retail-cart-events";

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

function PublicProductCard({ product }: { product: PublicProduct }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const add = async () => {
    setAdding(true);
    const response = await fetch("/api/retail/cart/items", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ productId: product.id, quantity: 1 }) });
    setAdding(false);
    if (!response.ok) { toast.error((await response.json().catch(() => null))?.error ?? "Proizvod trenutno nije dostupan."); return; }
    const cart = await response.json() as { itemCount: number; items?: Array<{ productId: string; name: string; quantity: number }> };
    const changedItem = cart.items?.find((item) => item.productId === product.id);
    notifyRetailCartChanged(cart.itemCount, {
      name: changedItem?.name ?? product.name,
      quantity: changedItem?.quantity ?? 1,
    });
    toast.success("Proizvod je dodat u korpu.");
  };
  return (
    <article className="group overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md">
      <Link href={`/proizvodi/${product.id}`} className="block">
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
      <div className="px-4 pb-4"><Button className="w-full" onClick={add} disabled={adding}>{adding ? "Dodavanje…" : "Dodaj u korpu"}</Button></div>
    </article>
  );
}

export default function PublicProductsPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedSearch(search);
  const params = useMemo(() => ({
    page,
    pageSize: 24,
    ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
    ...(category.trim() ? { category: category.trim() } : {}),
    ...(brand.trim() ? { brand: brand.trim() } : {}),
  }), [debouncedSearch, category, brand, page]);
  const { data, isLoading, isError } = useListPublicProducts(params);

  return (
    <Layout>
      <main className="mx-auto min-h-screen max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-3xl bg-primary px-6 py-10 text-primary-foreground sm:px-10">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.15em] text-primary-foreground/80"><Sparkles className="h-4 w-4" /> LUMERA prodavnica</p>
            <h1 className="mt-3 font-serif text-4xl font-bold sm:text-5xl">Beauty proizvodi za vašu rutinu</h1>
            <p className="mt-4 text-primary-foreground/85">Pažljivo odabrani proizvodi sa jasnim javnim cenama i opisima za kupce.</p>
          </div>
        </section>

        <section className="mt-8">
          <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
          <label className="relative block sm:col-span-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Pretražite proizvode..." className="h-12 pl-10" data-testid="public-product-search" />
          </label>
          <Input value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} placeholder="Kategorija" aria-label="Filtriraj po kategoriji" />
          <Input value={brand} onChange={(event) => { setBrand(event.target.value); setPage(1); }} placeholder="Brend" aria-label="Filtriraj po brendu" />
          </div>
        </section>

        <section className="mt-8">
          {isLoading ? (
            <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center text-destructive">Proizvodi trenutno nisu dostupni. Pokušajte ponovo malo kasnije.</div>
          ) : data?.items.length ? (
            <>
              <p className="mb-5 text-sm text-muted-foreground">Prikazano je {data.items.length} od {data.total} javno dostupnih proizvoda.</p>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {data.items.map((product) => <PublicProductCard key={product.id} product={product} />)}
              </div>
              {data.totalPages > 1 && (
                <div className="mt-10 flex items-center justify-center gap-3">
                  <Button variant="outline" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}><ChevronLeft className="mr-1 h-4 w-4" /> Prethodna</Button>
                  <span className="text-sm text-muted-foreground">Strana {data.page} od {data.totalPages}</span>
                  <Button variant="outline" onClick={() => setPage((current) => Math.min(data.totalPages, current + 1))} disabled={page >= data.totalPages}>Sledeća <ChevronRight className="ml-1 h-4 w-4" /></Button>
                </div>
              )}
            </>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border bg-muted/20 px-6 text-center">
              <ShoppingBag className="h-10 w-10 text-muted-foreground" />
              <h2 className="mt-4 font-serif text-xl font-semibold">Trenutno nema javno dostupnih proizvoda</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">Vratite se uskoro ili uklonite pretragu da proverite celu ponudu.</p>
            </div>
          )}
        </section>
      </main>
    </Layout>
  );
}

export function PublicProductDetailPage() {
  const [, params] = useRoute("/proizvodi/:productId");
  const productId = params?.productId ?? "";
  const { data: product, isLoading, isError } = useGetPublicProduct(productId);
  const { toast } = useToast();
  const productName = product?.name ?? "Proizvod";
  const [adding, setAdding] = useState(false);
  const add = async () => {
    setAdding(true);
    const response = await fetch("/api/retail/cart/items", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ productId, quantity: 1 }) });
    setAdding(false);
    if (!response.ok) { toast.error((await response.json().catch(() => null))?.error ?? "Proizvod trenutno nije dostupan."); return; }
    const cart = await response.json() as { itemCount: number; items?: Array<{ productId: string; name: string; quantity: number }> };
    const changedItem = cart.items?.find((item) => item.productId === productId);
    notifyRetailCartChanged(cart.itemCount, {
      name: changedItem?.name ?? productName,
      quantity: changedItem?.quantity ?? 1,
    });
    toast.success("Proizvod je dodat u korpu.");
  };

  if (isLoading) return <Layout><div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></Layout>;
  if (isError || !product) {
    return <Layout><main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-5 text-center"><ShoppingBag className="h-10 w-10 text-muted-foreground" /><h1 className="mt-4 font-serif text-3xl font-bold">Proizvod nije dostupan</h1><p className="mt-2 text-muted-foreground">Ovaj proizvod nije javno objavljen ili više nije dostupan.</p><Button asChild className="mt-6"><Link href="/proizvodi">Pogledajte proizvode</Link></Button></main></Layout>;
  }

  const gallery = [product.imageUrl, ...product.images.filter((image) => image !== product.imageUrl)];
  return (
    <Layout>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Link href="/proizvodi" className="inline-flex items-center text-sm font-medium text-primary hover:underline"><ChevronLeft className="mr-1 h-4 w-4" /> Svi proizvodi</Link>
        <section className="mt-6 grid gap-10 lg:grid-cols-2">
          <div className="grid grid-cols-2 gap-3">
            {gallery.map((image, index) => <div key={image} className={index === 0 ? "col-span-2 aspect-[4/3] overflow-hidden rounded-2xl bg-muted" : "aspect-square overflow-hidden rounded-xl bg-muted"}><OptimizedImage src={image} alt={index === 0 ? product.name : `${product.name} ${index + 1}`} className="h-full w-full object-cover" /></div>)}
          </div>
          <div className="max-w-xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">{product.brand ?? product.category}</p>
            <h1 className="mt-2 font-serif text-4xl font-bold tracking-tight">{product.name}</h1>
            <div className="mt-5"><ProductPrice product={product} /></div>
            <p className="mt-7 whitespace-pre-line leading-7 text-muted-foreground">{product.description}</p>
            <div className="mt-8 flex flex-wrap gap-3"><Button size="lg" onClick={add} disabled={adding}>{adding ? "Dodavanje…" : "Dodaj u korpu"}</Button><Button size="lg" variant="outline" asChild><Link href="/korpa">Pogledaj korpu</Link></Button></div>
            <div className="mt-5 rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground"><strong className="block text-foreground">Bezbedna retail kupovina</strong><span className="mt-1 block">Konačna dostupnost i javna cena proveravaju se ponovo prilikom potvrde porudžbine.</span></div>
          </div>
        </section>
        {product.relatedProducts.length > 0 && (
          <section className="mt-16 border-t pt-10">
            <h2 className="font-serif text-3xl font-bold">Slični proizvodi</h2>
            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">{product.relatedProducts.map((item) => <PublicProductCard key={item.id} product={item} />)}</div>
          </section>
        )}
      </main>
    </Layout>
  );
}