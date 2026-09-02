import { Link, useRoute } from "wouter";
import { useState } from "react";
import {
  useAddShopCartItem, useGetSupplierProduct, useListProductReviews, useUpsertProductReview,
  getGetShopCartQueryKey, getGetSupplierProductQueryKey, getGetShopSummaryQueryKey, getListProductReviewsQueryKey,
  useGetB2bProductWaitlistStatus, useSubscribeB2bProductWaitlist, useUnsubscribeB2bProductWaitlist, getGetB2bProductWaitlistStatusQueryKey,
  useGetPublicProductUpsells, getGetPublicProductUpsellsQueryKey,
  useGetPublicProductAutomaticXyPromotions, getGetPublicProductAutomaticXyPromotionsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Star, ArrowLeft, ShoppingCart, Bell, CheckCircle, Tag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { OptimizedImage } from "@/components/optimized-image";
import { PriceInquiryDialog } from "@/components/price-inquiry-dialog";
import { BulkMatrixOrderTable } from "@/components/bulk-matrix-table";
import { Badge } from "@/components/ui/badge";
import { addOptimisticCartItem, updateCartAndSummaryOptimistically } from "@/lib/optimistic-cart";
import { rollbackQueries } from "@/lib/optimistic-query";
import { SHOP_CART_MUTATION_KEY, shopCartMutationQueue, useMutationQueueBusy } from "@/lib/optimistic-mutation-queue";
import { useListProductDocuments, getListProductDocumentsQueryKey } from "@workspace/api-client-react";
import { ResponsiveProductTabs } from "@/components/responsive-product-tabs";
import { useCountdown } from "@/hooks/use-countdown";
import { Timer } from "lucide-react";

function SaleCountdown({ endsAt }: { endsAt: string }) {
  const { days, hours, minutes, seconds, isActive, isExpired } = useCountdown(endsAt);
  if (!isActive || isExpired) return null;
  return (
    <div className="flex items-center gap-1 mt-2 text-xs font-semibold text-rose-600 bg-rose-50 px-2 py-1 rounded w-fit border border-rose-100">
      <Timer className="w-3.5 h-3.5" />
      <span>Još {days > 0 ? `${days}d ` : ""}{hours.toString().padStart(2, '0')}:{minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}</span>
    </div>
  );
}

interface ExtendedVariant {
  value: string;
  price?: number | null;
  priceAdjust?: number | null;
  stock?: number;
  mainImageUrl?: string | null;
  swatch?: {
    kind: "NONE" | "TEXT" | "COLOR" | "IMAGE";
    hex?: string | null;
    text?: string | null;
    imageUrl?: string | null;
  } | null;
}
interface ExtendedProduct {
  priceOnRequest?: boolean;
  bulkMatrixEnabled?: boolean;
  variants?: ExtendedVariant[] | null;
}

export default function OwnerProductDetail() {
  const [, params] = useRoute("/vlasnik/shop/:supplierSlug/proizvodi/:productId");
  const supplierSlug = params?.supplierSlug ?? "";
  const id = params?.productId ?? "";
  const { data: product, isLoading } = useGetSupplierProduct(supplierSlug, id);
  const { data: documents = [] } = useListProductDocuments(id, { audience: "B2B" }, { query: { enabled: !!id, queryKey: getListProductDocumentsQueryKey(id, { audience: "B2B" }) } });
  const { data: reviews = [] } = useListProductReviews(id, { query: { enabled: !!id, queryKey: getListProductReviewsQueryKey(id) } });

  const { data: upsellsData } = useGetPublicProductUpsells(id, { query: { enabled: !!id, queryKey: getGetPublicProductUpsellsQueryKey(id) } });
  const { data: xyData } = useGetPublicProductAutomaticXyPromotions(id, { query: { enabled: !!id, queryKey: getGetPublicProductAutomaticXyPromotionsQueryKey(id) } });
  const activeXy = xyData?.items?.[0];

  const qc = useQueryClient(); const mutation = useUpsertProductReview(); const { toast } = useToast(); const [rating, setRating] = useState(5); const [comment, setComment] = useState("");
  const [variantValue, setVariantValue] = useState("");
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const cartBusy = useMutationQueueBusy(shopCartMutationQueue);
  const [showInquiry, setShowInquiry] = useState(false);
  const addCartItem = useAddShopCartItem({
    mutation: {
      mutationKey: SHOP_CART_MUTATION_KEY,
      onMutate: async ({ data }) => {
        if (!product || !("productId" in data)) return {};
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

  const { data: waitlistStatus, refetch: refetchWaitlist } = useGetB2bProductWaitlistStatus(id, { query: { enabled: !!id && product?.stock === 0, queryKey: getGetB2bProductWaitlistStatusQueryKey(id) } });
  const subscribeWaitlist = useSubscribeB2bProductWaitlist({ mutation: { onSuccess: () => { toast.success("Prijavljeni ste na listu čekanja."); refetchWaitlist(); } } });
  const unsubscribeWaitlist = useUnsubscribeB2bProductWaitlist({ mutation: { onSuccess: () => { toast.success("Odjavljeni ste sa liste čekanja."); refetchWaitlist(); } } });

  if (isLoading) return <BusinessLayout><div className="p-20 text-center"><Loader2 className="animate-spin inline"/></div></BusinessLayout>;
  if (!product) return <BusinessLayout><p className="p-10">Proizvod nije pronađen.</p></BusinessLayout>;
  const price = product.discountPrice ?? product.price;
  const extendedProduct = product as unknown as ExtendedProduct;
  const isPriceOnRequest = Boolean(extendedProduct.priceOnRequest || product.stock <= 0);
  const selectedVariant = extendedProduct.variants?.find((variant) => variant.value === variantValue);
  const selectedPrice = selectedVariant?.price ?? (price + (selectedVariant?.priceAdjust ?? 0));
  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8">
        <OwnerSidebar current="/vlasnik/shop"/>
        <main className="flex-1 space-y-6">
          <Button asChild variant="ghost">
            <Link href={`/vlasnik/shop/${supplierSlug}`}><ArrowLeft className="w-4 h-4 mr-2"/>Nazad u katalog</Link>
          </Button>
          <div className="grid md:grid-cols-2 gap-7">
            <OptimizedImage className="w-full aspect-square object-cover rounded-xl bg-muted" src={activeImage || product.images?.[0] || product.imageUrl} alt={product.name} width={800} height={800} priority preferredSize="large" responsiveSizes="(max-width: 768px) calc(100vw - 2rem), 50vw" />
            <div>
              <p className="text-sm text-primary">{product.brand ?? product.category}</p>
              <h1 className="text-3xl font-serif font-bold mt-1">{product.name}</h1>

              {activeXy && (
                <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-rose-100 text-rose-700 font-bold text-sm rounded-full border border-rose-200 shadow-sm">
                  <Tag className="w-4 h-4" /> Kupi {activeXy.buyQuantity}, dobij {activeXy.rewardQuantity} {activeXy.rewardPercent === 100 ? "besplatno" : `uz ${activeXy.rewardPercent}% popusta`}
                </div>
              )}

              <div className="mt-4 text-muted-foreground whitespace-pre-line text-sm">
                <ResponsiveProductTabs product={product} documents={documents} />
              </div>

              {!isPriceOnRequest && (
                <div className="mt-5 flex flex-col gap-1">
                  <div className="flex items-baseline gap-3">
                    <p className="text-2xl font-bold">{selectedPrice.toLocaleString("sr-RS")} RSD</p>
                    {product.discountPrice != null && product.price != null && (
                      <span className="text-sm text-muted-foreground line-through opacity-70">{product.price.toLocaleString("sr-RS")} RSD</span>
                    )}
                  </div>
                  {(product as any).saleEndsAt && <SaleCountdown endsAt={(product as any).saleEndsAt} />}
                </div>
              )}
              <p className="text-sm mt-3">{product.stock > 0 ? `${product.stock} kom. dostupno` : "Trenutno nema na stanju"}</p>
              {product.deliveryBusinessDaysOverride != null && <p className="mt-2 text-sm text-muted-foreground" data-testid="text-estimated-delivery">Procenjena isporuka: {product.deliveryBusinessDaysOverride} {product.deliveryBusinessDaysOverride === 1 ? "radni dan" : "radnih dana"}</p>}

              {!isPriceOnRequest && extendedProduct.bulkMatrixEnabled && extendedProduct.variants?.length ? (
                <BulkMatrixOrderTable productId={product.id} />
              ) : (
                <>
                  {extendedProduct.variants?.length ? (
                    <div className="mt-4">
                      <p className="text-sm font-medium mb-2">{product.variantType ?? "Varijanta"}</p>
                      <div className="flex flex-wrap gap-2">
                        {extendedProduct.variants.map(variant => (
                          <Button key={variant.value} type="button" size="sm" variant={variantValue === variant.value ? "default" : "outline"} disabled={variant.stock !== undefined && variant.stock <= 0} onClick={() => { setVariantValue(variant.value); if ((variant as ExtendedVariant).mainImageUrl) setActiveImage((variant as ExtendedVariant).mainImageUrl ?? null); }}>
                            {(variant as ExtendedVariant).swatch?.kind === "COLOR" && <div className="w-3 h-3 rounded-full mr-1.5 inline-block border" style={{ backgroundColor: ((variant as ExtendedVariant).swatch?.hex as string) }} />}
                            {variant.value}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {isPriceOnRequest ? (
                    <div className="mt-6">
                      <Button size="lg" className="w-full sm:w-auto" onClick={() => setShowInquiry(true)}>Pošalji upit za cenu / dostupnost</Button>
                    </div>
                  ) : (
                    <Button className="mt-5" disabled={cartBusy || Boolean(extendedProduct.variants?.length && !variantValue)} onClick={() => { if (!shopCartMutationQueue.isBusy()) addCartItem.mutate({ data: { productId: product.id, ...(variantValue ? { variantValue } : {}) } }); }}>
                      <ShoppingCart className="w-4 h-4 mr-2"/> Dodaj u korpu
                    </Button>
                  )}
                </>
              )}
              <PriceInquiryDialog open={showInquiry} onOpenChange={setShowInquiry} supplierId={product.supplierId} productId={product.id} productName={product.name} />

              {product.stock <= 0 && !extendedProduct.priceOnRequest && (
                <div className="mt-6 p-4 rounded-xl border bg-muted/20">
                  <p className="font-semibold text-amber-700 mb-3">Trenutno rasprodato</p>
                  {waitlistStatus?.subscribed ? (
                    <div className="space-y-3">
                      <p className="text-sm flex items-center text-emerald-600"><CheckCircle className="w-4 h-4 mr-2" /> Prijavljeni ste za obaveštenje kada proizvod bude dostupan.</p>
                      <Button variant="outline" size="sm" onClick={() => unsubscribeWaitlist.mutate({ productId: id })} disabled={unsubscribeWaitlist.isPending}>Odjavi se</Button>
                    </div>
                  ) : (
                    <Button variant="secondary" onClick={() => subscribeWaitlist.mutate({ productId: id })} disabled={subscribeWaitlist.isPending}><Bell className="w-4 h-4 mr-2" /> Obavesti me kada bude dostupno</Button>
                  )}
                </div>
              )}
            </div>
          </div>

          {product.relatedProducts.length > 0 && (
            <section data-testid="section-related-products">
              <h2 className="mb-4 text-xl font-bold">Slični proizvodi</h2>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {product.relatedProducts.map((related) => {
                  const relatedPrice = related.discountPrice ?? related.price;
                  return (
                    <Link key={related.id} href={`/vlasnik/shop/${supplierSlug}/proizvodi/${related.id}`} className="group overflow-hidden rounded-xl border bg-card" data-testid={`link-related-product-${related.id}`}>
                      <OptimizedImage src={related.imageUrl} alt={related.name} className="aspect-square w-full object-cover transition-transform group-hover:scale-105" width={320} height={320} preferredSize="thumbnail" />
                      <div className="p-3">
                        <p className="text-xs text-muted-foreground">{related.brand ?? "Proizvod"}</p>
                        <h3 className="mt-1 line-clamp-2 text-sm font-semibold">{related.name}</h3>
                        <p className="mt-2 font-semibold">{relatedPrice.toLocaleString("sr-RS")} RSD</p>
                        {related.discountPrice != null && <p className="text-xs text-muted-foreground line-through">{related.price.toLocaleString("sr-RS")} RSD</p>}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {upsellsData?.items && upsellsData.items.length > 0 && (
            <section data-testid="section-upsells">
              <h2 className="mb-4 text-xl font-bold">Bolja ponuda za vas</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {upsellsData.items.map((upsell) => (
                  <Link key={upsell.id} href={`/vlasnik/shop/${supplierSlug}/proizvodi/${upsell.id}`} className="flex items-center gap-4 rounded-xl border bg-card p-3 hover:shadow-md transition-shadow">
                    <OptimizedImage src={upsell.imageUrl || ""} alt={upsell.name} className="w-20 h-20 rounded-md object-cover bg-muted" width={80} height={80} preferredSize="thumbnail" />
                    <div>
                      <h3 className="line-clamp-2 text-sm font-semibold">{upsell.name}</h3>
                      <p className="mt-1 font-bold text-primary">{upsell.priceOnRequest ? "Cena na upit" : `${upsell.price?.toLocaleString("sr-RS")} RSD`}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-xl font-bold mb-3">Recenzije {product.averageRating && <span className="text-sm font-normal">★ {product.averageRating} ({product.reviewCount})</span>}</h2>
            <div className="space-y-3">
              {reviews.map((review) => (
                <Card key={review.id}>
                  <CardContent className="p-4">
                    <b>{review.salonName}</b>
                    <span className="ml-2 text-amber-500">{"★".repeat(review.rating)}</span>
                    <p className="text-sm mt-1">{review.comment}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card className="mt-4">
              <CardContent className="p-4">
                <b>Ostavite ili izmenite svoju recenziju</b>
                <div className="flex flex-col gap-4 mt-3">
                  <div className="flex gap-2 items-center">
                    <Input className="w-24" type="number" min="1" max="5" value={rating} onChange={e => setRating(Number(e.target.value))}/>
                    <Input value={comment} onChange={e => setComment(e.target.value)} placeholder="Vaše iskustvo (opciono)"/>
                  </div>

                  <Button disabled={mutation.isPending} className="w-fit" onClick={() => mutation.mutate({ productId: id, data: { rating, comment } }, { onSuccess: () => { toast.success("Recenzija uspešno sačuvana"); Promise.all([qc.invalidateQueries({ queryKey: getGetSupplierProductQueryKey(supplierSlug, id) }), qc.invalidateQueries({ queryKey: getListProductReviewsQueryKey(id) })]); } })}>
                    <Star className="w-4 h-4 mr-1"/>Sačuvaj
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>
        </main>
      </div>
    </BusinessLayout>
  );
}
