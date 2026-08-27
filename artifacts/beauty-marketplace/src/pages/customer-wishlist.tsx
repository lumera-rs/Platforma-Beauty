import { Layout } from "@/components/layout";
import { OptimizedImage } from "@/components/optimized-image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useListProductWishlist, useRemoveProductWishlistItem, useAddRetailCartItem, getListProductWishlistQueryKey } from "@workspace/api-client-react";
import { extractApiError } from "@/lib/admin-form-utils";
import { useToast } from "@/hooks/use-toast";
import { Heart, Loader2, ShoppingBag, Trash2, PackageX } from "lucide-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { notifyRetailCartChanged } from "@/lib/retail-cart-events";

const money = (value: number) => new Intl.NumberFormat("sr-RS", {
  style: "currency", currency: "RSD", maximumFractionDigits: 0,
}).format(value);

export default function CustomerWishlistPage() {
  const { data: items, isLoading, isError } = useListProductWishlist({ query: { queryKey: getListProductWishlistQueryKey() } });
  const removeMutation = useRemoveProductWishlistItem();
  const addRetailCartItem = useAddRetailCartItem();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleRemove = (productId: string, variantValue?: string | null) => {
    removeMutation.mutate(
      { productId, params: variantValue ? { variantValue } : undefined },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductWishlistQueryKey() });
          toast.success("Proizvod je uklonjen iz liste želja.");
        },
        onError: (err) => toast.error(extractApiError(err, "Nije moguće ukloniti proizvod."))
      }
    );
  };

  const handleAddToCart = (productId: string, productName: string, available: boolean) => {
    if (!available) return;
    addRetailCartItem.mutate({ data: { productId, quantity: 1 } }, {
      onSuccess: (cart) => {
        notifyRetailCartChanged(cart.itemCount, {
          productId,
          name: productName,
          quantity: 1,
        });
        toast.success("Proizvod je dodat u korpu.");
      },
      onError: (error) => toast.error(extractApiError(error, "Proizvod trenutno nije dostupan."))
    });
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-rose-50 text-rose-500 rounded-full">
            <Heart className="w-6 h-6 fill-current" />
          </div>
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">Lista želja</h1>
            <p className="text-muted-foreground mt-1">Vaši sačuvani proizvodi</p>
          </div>
        </div>

        {isLoading ? (
          <div className="py-24 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : isError ? (
          <div className="py-24 text-center text-destructive">Došlo je do greške prilikom učitavanja.</div>
        ) : !items || items.length === 0 ? (
          <div className="py-24 text-center border rounded-2xl bg-muted/20">
            <Heart className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-20" />
            <h2 className="text-xl font-serif font-bold">Vaša lista želja je prazna</h2>
            <p className="text-muted-foreground mt-2 mb-6">Istražite proizvode i sačuvajte one koji vam se sviđaju.</p>
            <Button asChild><Link href="/proizvodi">Istraži proizvode</Link></Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const p = item.product;

              if (!p) {
                return (
                  <div key={item.id} className="group overflow-hidden rounded-2xl border bg-muted/30 shadow-sm relative flex flex-col opacity-75">
                    <div className="absolute inset-0 z-20 bg-background/40 backdrop-blur-[1px] flex items-center justify-center">
                      <Badge variant="secondary" className="text-base px-3 py-1">Nije dostupno</Badge>
                    </div>
                    <div className="block relative aspect-square bg-muted flex items-center justify-center">
                      <PackageX className="w-16 h-16 text-muted-foreground/30" />
                    </div>
                    <div className="p-4 flex flex-col flex-1">
                      <div className="flex justify-between items-start mb-2 relative z-30">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nedostupno</p>
                        <button
                          onClick={() => handleRemove(item.productId, item.variantValue)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="Ukloni iz liste želja"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <h3 className="line-clamp-2 font-serif font-semibold mb-2 text-muted-foreground">Proizvod više nije dostupan</h3>
                      <div className="mt-auto pt-4 flex items-center justify-between pointer-events-none">
                        <div className="flex flex-col">
                          <span className="font-bold text-lg text-muted-foreground/50">--- RSD</span>
                        </div>
                        <Button size="sm" disabled variant="outline">
                          <ShoppingBag className="w-4 h-4 mr-2 opacity-50" /> Nedostupno
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }

              const currentPrice = p.discountPrice ?? p.price;

              return (
                <div key={item.id} className="group overflow-hidden rounded-2xl border bg-card shadow-sm relative flex flex-col">
                  {!item.available && (
                    <div className="absolute inset-0 z-20 bg-background/60 backdrop-blur-[2px] flex items-center justify-center">
                      <Badge variant="destructive" className="text-base px-3 py-1">Nije dostupno</Badge>
                    </div>
                  )}
                  <Link href={`/shop/${p.supplierId}/proizvod/${p.id}`} className="block relative aspect-square bg-muted">
                    <OptimizedImage src={p.imageUrl} alt={p.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  </Link>
                  <div className="p-4 flex flex-col flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.brand ?? p.category}</p>
                      <button
                        onClick={() => handleRemove(item.productId, item.variantValue)}
                        className="text-muted-foreground hover:text-destructive z-30"
                        title="Ukloni iz liste želja"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <h3 className="line-clamp-2 font-serif font-semibold mb-2"><Link href={`/shop/${p.supplierId}/proizvod/${p.id}`} className="hover:text-primary">{p.name}</Link></h3>
                    <div className="mt-auto pt-4 flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="font-bold text-lg text-primary">{money(currentPrice)}</span>
                        {p.discountPrice != null && <span className="text-xs text-muted-foreground line-through">{money(p.price)}</span>}
                      </div>
                      <Button size="sm" onClick={() => handleAddToCart(p.id, p.name, item.available)} disabled={!item.available || addRetailCartItem.isPending} className="z-30">
                        <ShoppingBag className="w-4 h-4 mr-2" /> Dodaj
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
