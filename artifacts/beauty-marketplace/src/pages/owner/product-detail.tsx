import { Link, useRoute } from "wouter";
import { useState } from "react";
import { useAddShopCartItem, useGetSupplierProduct, useUpsertProductReview, getGetShopCartQueryKey, getGetSupplierProductQueryKey, getGetShopSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Star, ArrowLeft, ShoppingCart } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { OptimizedImage } from "@/components/optimized-image";
import { addOptimisticCartItem, updateCartAndSummaryOptimistically } from "@/lib/optimistic-cart";
import { rollbackQueries } from "@/lib/optimistic-query";
import { SHOP_CART_MUTATION_KEY, shopCartMutationQueue, useMutationQueueBusy } from "@/lib/optimistic-mutation-queue";

export default function OwnerProductDetail() {
  const [, params] = useRoute("/vlasnik/shop/:supplierSlug/proizvodi/:productId");
  const supplierSlug = params?.supplierSlug ?? "";
  const id = params?.productId ?? "";
  const { data: product, isLoading } = useGetSupplierProduct(supplierSlug, id);
  const qc = useQueryClient(); const mutation = useUpsertProductReview(); const { toast } = useToast(); const [rating, setRating] = useState(5); const [comment, setComment] = useState(""); const [variantValue, setVariantValue] = useState("");
  const cartBusy = useMutationQueueBusy(shopCartMutationQueue);
  const addCartItem = useAddShopCartItem({
    mutation: {
      mutationKey: SHOP_CART_MUTATION_KEY,
      onMutate: async ({ data }) => {
        if (!product) return {};
        const release = await shopCartMutationQueue.acquire();
        try {
          const snapshots = await updateCartAndSummaryOptimistically(qc, (current) => addOptimisticCartItem(current, product, data.variantValue));
          return { snapshots, release };
        } catch (error) {
          release();
          throw error;
        }
      },
      onSuccess: (cart) => { qc.setQueryData(getGetShopCartQueryKey(), cart); toast.success("Dodato u korpu"); },
      onError: (_error, _variables, context) => {
        rollbackQueries(qc, context?.snapshots);
        toast.error("Dodavanje u korpu nije uspelo.");
      },
      onSettled: async (_data, _error, _variables, context) => {
        try {
          await Promise.all([
            qc.invalidateQueries({ queryKey: getGetShopCartQueryKey() }),
            qc.invalidateQueries({ queryKey: getGetShopSummaryQueryKey() }),
          ]);
        } finally {
          context?.release?.();
        }
      },
    },
  });
  if (isLoading) return <BusinessLayout><div className="p-20 text-center"><Loader2 className="animate-spin inline"/></div></BusinessLayout>;
  if (!product) return <BusinessLayout><p className="p-10">Proizvod nije pronađen.</p></BusinessLayout>;
  const price = product.discountPrice ?? product.price;
  const selectedVariant = product.variants?.find((variant) => variant.value === variantValue);
  const selectedPrice = selectedVariant?.price ?? (price + (selectedVariant?.priceAdjust ?? 0));
  return <BusinessLayout><div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8"><OwnerSidebar current="/vlasnik/shop"/><main className="flex-1 space-y-6"><Button asChild variant="ghost"><Link href={`/vlasnik/shop/${supplierSlug}`}><ArrowLeft className="w-4 h-4 mr-2"/>Nazad u katalog</Link></Button><div className="grid md:grid-cols-2 gap-7"><OptimizedImage className="w-full aspect-square object-cover rounded-xl bg-muted" src={product.images?.[0] || product.imageUrl} alt={product.name} width={800} height={800} priority preferredSize="large" responsiveSizes="(max-width: 768px) calc(100vw - 2rem), 50vw" /><div><p className="text-sm text-primary">{product.brand ?? product.category}</p><h1 className="text-3xl font-serif font-bold mt-1">{product.name}</h1><p className="mt-4 text-muted-foreground whitespace-pre-line">{product.description}</p><p className="text-2xl font-bold mt-5">{selectedPrice.toLocaleString("sr-RS")} RSD</p><p className="text-sm mt-2">{product.stock > 0 ? `${product.stock} kom. dostupno` : "Trenutno nema na stanju"}</p>{product.variants?.length ? <div className="mt-4"><p className="text-sm font-medium mb-2">{product.variantType ?? "Varijanta"}</p><div className="flex flex-wrap gap-2">{product.variants.map(variant => <Button key={variant.value} type="button" size="sm" variant={variantValue === variant.value ? "default" : "outline"} disabled={variant.stock !== undefined && variant.stock <= 0} onClick={() => setVariantValue(variant.value)}>{variant.value}</Button>)}</div></div> : null}<Button className="mt-5" disabled={cartBusy || product.stock <= 0 || Boolean(product.variants?.length && !variantValue)} onClick={() => { if (!shopCartMutationQueue.isBusy()) addCartItem.mutate({ data: { productId: product.id, ...(variantValue ? { variantValue } : {}) } }); }}><ShoppingCart className="w-4 h-4 mr-2"/>Dodaj u korpu</Button></div></div>
    <section><h2 className="text-xl font-bold mb-3">Recenzije {(product as any).averageRating && <span className="text-sm font-normal">★ {(product as any).averageRating} ({(product as any).reviewCount})</span>}</h2><div className="space-y-3">{((product as any).reviews ?? []).map((r: any) => <Card key={r.id}><CardContent className="p-4"><b>{r.salonName}</b><span className="ml-2 text-amber-500">{"★".repeat(r.rating)}</span><p className="text-sm mt-1">{r.comment}</p></CardContent></Card>)}</div>
      <Card className="mt-4"><CardContent className="p-4"><b>Ostavite ili izmenite svoju recenziju</b><div className="flex gap-2 mt-3 items-center"><Input className="w-24" type="number" min="1" max="5" value={rating} onChange={e => setRating(Number(e.target.value))}/><Input value={comment} onChange={e => setComment(e.target.value)} placeholder="Vaše iskustvo (opciono)"/><Button disabled={mutation.isPending} onClick={() => mutation.mutate({ productId: id, data: { rating, comment } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetSupplierProductQueryKey(supplierSlug, id) }) })}><Star className="w-4 h-4 mr-1"/>Sačuvaj</Button></div></CardContent></Card></section>
  </main></div></BusinessLayout>;
}