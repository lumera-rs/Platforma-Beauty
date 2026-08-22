import { Link, useRoute } from "wouter";
import { useState } from "react";
import { useGetShopProduct, useUpsertProductReview, getGetShopProductQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Star, ArrowLeft, ShoppingCart } from "lucide-react";
import { OptimizedImage } from "@/components/optimized-image";
import { useShopCartMutations } from "@/hooks/use-shop-cart-mutations";

export default function OwnerProductDetail() {
  const [, params] = useRoute("/vlasnik/shop/proizvodi/:productId");
  const id = params?.productId ?? "";
  const { data: product, isLoading } = useGetShopProduct(id);
  const qc = useQueryClient(); const mutation = useUpsertProductReview(); const { addItem: addCartItem } = useShopCartMutations(); const [rating, setRating] = useState(5); const [comment, setComment] = useState(""); const [variantValue, setVariantValue] = useState("");
  if (isLoading) return <BusinessLayout><div className="p-20 text-center"><Loader2 className="animate-spin inline"/></div></BusinessLayout>;
  if (!product) return <BusinessLayout><p className="p-10">Proizvod nije pronađen.</p></BusinessLayout>;
  const price = product.discountPrice ?? product.price;
  const selectedVariant = product.variants?.find((variant) => variant.value === variantValue);
  const selectedPrice = selectedVariant?.price ?? (price + (selectedVariant?.priceAdjust ?? 0));
  return <BusinessLayout><div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8"><OwnerSidebar current="/vlasnik/shop"/><main className="flex-1 space-y-6"><Button asChild variant="ghost"><Link href="/vlasnik/shop"><ArrowLeft className="w-4 h-4 mr-2"/>Nazad u shop</Link></Button><div className="grid md:grid-cols-2 gap-7"><OptimizedImage className="w-full aspect-square object-cover rounded-xl bg-muted" src={product.images[0] || product.imageUrl} alt={product.name} width={800} height={800} priority preferredSize="large" responsiveSizes="(max-width: 768px) calc(100vw - 2rem), 50vw" /><div><p className="text-sm text-primary">{product.brand ?? product.category}</p><h1 className="text-3xl font-serif font-bold mt-1">{product.name}</h1><p className="mt-4 text-muted-foreground whitespace-pre-line">{product.description}</p><p className="text-2xl font-bold mt-5">{selectedPrice.toLocaleString("sr-RS")} RSD</p><p className="text-sm mt-2">{product.stock > 0 ? `${product.stock} kom. dostupno` : "Trenutno nema na stanju"}</p>{product.variants?.length ? <div className="mt-4"><p className="text-sm font-medium mb-2">{product.variantType ?? "Varijanta"}</p><div className="flex flex-wrap gap-2">{product.variants.map(variant => <Button key={variant.value} type="button" size="sm" variant={variantValue === variant.value ? "default" : "outline"} disabled={variant.stock !== undefined && variant.stock <= 0} onClick={() => setVariantValue(variant.value)}>{variant.value}</Button>)}</div></div> : null}<Button className="mt-5" disabled={addCartItem.isPending || product.stock <= 0 || Boolean(product.variants?.length && !variantValue)} onClick={() => addCartItem.mutate({ data: { productId: product.id, ...(variantValue ? { variantValue } : {}) }, optimisticProduct: product })}><ShoppingCart className="w-4 h-4 mr-2"/>Dodaj u korpu</Button></div></div>
    <section><h2 className="text-xl font-bold mb-3">Recenzije {product.averageRating && <span className="text-sm font-normal">★ {product.averageRating} ({product.reviewCount})</span>}</h2><div className="space-y-3">{product.reviews.map(r => <Card key={r.id}><CardContent className="p-4"><b>{r.salonName}</b><span className="ml-2 text-amber-500">{"★".repeat(r.rating)}</span><p className="text-sm mt-1">{r.comment}</p></CardContent></Card>)}</div>
      <Card className="mt-4"><CardContent className="p-4"><b>Ostavite ili izmenite svoju recenziju</b><div className="flex gap-2 mt-3 items-center"><Input className="w-24" type="number" min="1" max="5" value={rating} onChange={e => setRating(Number(e.target.value))}/><Input value={comment} onChange={e => setComment(e.target.value)} placeholder="Vaše iskustvo (opciono)"/><Button disabled={mutation.isPending} onClick={() => mutation.mutate({ productId: id, data: { rating, comment } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetShopProductQueryKey(id) }) })}><Star className="w-4 h-4 mr-1"/>Sačuvaj</Button></div></CardContent></Card></section>
  </main></div></BusinessLayout>;
}