import React, { useState, useEffect } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, ArrowLeft, Check, Package, AlertTriangle, Truck, CreditCard, Receipt, FileText, ChevronRight, Lock, Plus, Minus, Trash2, Tag } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetShopCart,
  useUpdateShopCartItem,
  useRemoveShopCartItem,
  useSaveShopCartItemForLater,
  useRestoreSavedShopCartItem,
  useRemoveSavedShopCartItem,
  useAddShopCartItem,
  useGetShopCheckoutProfile,
  useGetShopCheckoutPreview,
  useCheckoutShopCart,
  useGetOrder,
  getGetShopCartQueryKey,
  getGetShopSummaryQueryKey,
  getGetShopCheckoutPreviewQueryKey,
  getListSalonNotificationsQueryKey,
  getGetOrderQueryKey,
  getApiErrorDetails,
  getApiErrorMessage,
  ShopCheckoutInputPaymentMethod,
} from "@workspace/api-client-react";

import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { OptimizedImage } from "@/components/optimized-image";
import { removeOptimisticCartItem, updateCartAndSummaryOptimistically, updateOptimisticCartQuantity } from "@/lib/optimistic-cart";
import { rollbackQueries } from "@/lib/optimistic-query";
import { SHOP_CART_MUTATION_KEY, shopCartMutationQueue, useMutationQueueBusy } from "@/lib/optimistic-mutation-queue";
import { CreateShopQuoteDialog } from "@/components/create-shop-quote-dialog";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

const SESSION_STORAGE_KEY = "lumera_checkout_draft";

const money = (n: number) => `${n.toLocaleString("sr-RS")} RSD`;

function CheckoutStepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center justify-center space-x-2 md:space-x-4 mb-8 text-sm md:text-base font-medium text-muted-foreground w-full max-w-2xl mx-auto overflow-hidden">
      <div className={`flex items-center transition-colors duration-300 ${step >= 1 ? "text-primary" : ""}`}>
        <div className={`w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center mr-2 border-2 transition-colors duration-300 ${step >= 1 ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-muted-foreground/30 bg-muted/20"}`}>
          {step > 1 ? <Check className="w-3 h-3 md:w-4 md:h-4" /> : 1}
        </div>
        <span className="hidden sm:inline">Korpa</span>
      </div>
      <div className={`flex-1 max-w-[2rem] sm:max-w-[4rem] md:max-w-[6rem] h-[2px] transition-colors duration-300 ${step >= 2 ? "bg-primary/50" : "bg-border"}`} />
      <div className={`flex items-center transition-colors duration-300 ${step >= 2 ? "text-primary" : ""}`}>
        <div className={`w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center mr-2 border-2 transition-colors duration-300 ${step >= 2 ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-muted-foreground/30 bg-muted/20"}`}>
          {step > 2 ? <Check className="w-3 h-3 md:w-4 md:h-4" /> : 2}
        </div>
        <span className="hidden sm:inline">Dostava</span>
      </div>
      <div className={`flex-1 max-w-[2rem] sm:max-w-[4rem] md:max-w-[6rem] h-[2px] transition-colors duration-300 ${step >= 3 ? "bg-primary/50" : "bg-border"}`} />
      <div className={`flex items-center transition-colors duration-300 ${step >= 3 ? "text-primary" : ""}`}>
        <div className={`w-6 h-6 md:w-8 md:h-8 rounded-full flex items-center justify-center mr-2 border-2 transition-colors duration-300 ${step >= 3 ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-muted-foreground/30 bg-muted/20"}`}>
          3
        </div>
        <span className="hidden sm:inline">Pregled</span>
      </div>
    </div>
  );
}

export function OwnerCartPage() {
  const queryClient = useQueryClient();
  const { data: cart, isLoading, isError } = useGetShopCart();
  const { toast } = useToast();
  const cartBusy = useMutationQueueBusy(shopCartMutationQueue);
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  const updateItem = useUpdateShopCartItem({
    mutation: {
      mutationKey: SHOP_CART_MUTATION_KEY,
      onMutate: async ({ cartItemId, data }) => {
        const release = await shopCartMutationQueue.acquire();
        try {
          const snapshots = await updateCartAndSummaryOptimistically(
            queryClient,
            (current) => updateOptimisticCartQuantity(current, cartItemId, data.quantity),
          );
          return { snapshots, release };
        } catch (error) {
          release();
          throw error;
        }
      },
      onSuccess: (serverCart) => queryClient.setQueryData(getGetShopCartQueryKey(), serverCart),
      onError: (_error, _variables, context) => {
        rollbackQueries(queryClient, context?.snapshots);
        toast.error("Nije uspelo ažuriranje količine.");
      },
      onSettled: async (_data, _error, _variables, context) => {
        try {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getGetShopCartQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetShopSummaryQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetShopCheckoutPreviewQueryKey() }),
          ]);
        } finally {
          context?.release();
        }
      },
    },
  });
  const removeItem = useRemoveShopCartItem({
    mutation: {
      mutationKey: SHOP_CART_MUTATION_KEY,
      onMutate: async ({ cartItemId }) => {
        const release = await shopCartMutationQueue.acquire();
        try {
          const snapshots = await updateCartAndSummaryOptimistically(
            queryClient,
            (current) => removeOptimisticCartItem(current, cartItemId),
          );
          return { snapshots, release };
        } catch (error) {
          release();
          throw error;
        }
      },
      onSuccess: (serverCart) => queryClient.setQueryData(getGetShopCartQueryKey(), serverCart),
      onError: (_error, _variables, context) => {
        rollbackQueries(queryClient, context?.snapshots);
        toast.error("Nije uspelo uklanjanje stavke.");
      },
      onSettled: async (_data, _error, _variables, context) => {
        try {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getGetShopCartQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetShopSummaryQueryKey() }),
            queryClient.invalidateQueries({ queryKey: getGetShopCheckoutPreviewQueryKey() }),
          ]);
        } finally {
          context?.release();
        }
      },
    },
  });

  const saveItem = useSaveShopCartItemForLater({
    mutation: {
      onSuccess: (serverCart) => {
        queryClient.setQueryData(getGetShopCartQueryKey(), serverCart);
        toast.success("Stavka sačuvana za kasnije.");
        queryClient.invalidateQueries({ queryKey: getGetShopCartQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetShopSummaryQueryKey() });
      }
    }
  });

  const restoreItem = useRestoreSavedShopCartItem({
    mutation: {
      onSuccess: (serverCart) => {
        queryClient.setQueryData(getGetShopCartQueryKey(), serverCart);
        toast.success("Stavka vraćena u korpu.");
        queryClient.invalidateQueries({ queryKey: getGetShopCartQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetShopSummaryQueryKey() });
      }
    }
  });

  const removeSavedItem = useRemoveSavedShopCartItem({
    mutation: {
      onSuccess: (serverCart) => {
        queryClient.setQueryData(getGetShopCartQueryKey(), serverCart);
        queryClient.invalidateQueries({ queryKey: getGetShopCartQueryKey() });
      }
    }
  });

  const addCartItem = useAddShopCartItem({
    mutation: {
      onSuccess: (serverCart) => {
        queryClient.setQueryData(getGetShopCartQueryKey(), serverCart);
        toast.success("Proizvod dodat u korpu.");
        queryClient.invalidateQueries({ queryKey: getGetShopCartQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetShopSummaryQueryKey() });
      },
      onError: () => toast.error("Nije uspelo dodavanje u korpu.")
    }
  });

  const handleUpdateQuantity = (cartItemId: string, currentQty: number, delta: number, stock: number) => {
    if (shopCartMutationQueue.isBusy()) return;
    const newQty = currentQty + delta;
    if (newQty < 1) return;
    if (newQty > stock) {
      toast.error(`Nedovoljno na stanju. Dostupno je samo ${stock} komada.`);
      return;
    }
    updateItem.mutate({ cartItemId, data: { quantity: newQty } });
  };

  const handleRemove = (cartItemId: string) => {
    if (shopCartMutationQueue.isBusy()) return;
    removeItem.mutate({ cartItemId });
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto max-w-5xl overflow-x-clip px-4 py-8">
        <Button variant="ghost" asChild className="mb-6 -ml-4 text-muted-foreground hover:text-foreground">
          <Link href="/vlasnik/shop"><ArrowLeft className="w-4 h-4 mr-2" /> Nazad u prodavnicu</Link>
        </Button>
        <CheckoutStepper step={1} />
        <div className="mb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-primary mb-2">Vaša korpa</h1>
          <p className="text-muted-foreground">Pregledajte proizvode pre nastavka kupovine</p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError ? (
           <Alert variant="destructive">
             <AlertTriangle className="h-4 w-4" />
             <AlertTitle>Greška</AlertTitle>
             <AlertDescription>Nismo uspeli da učitamo korpu. Molimo pokušajte ponovo.</AlertDescription>
           </Alert>
        ) : !cart || cart.items.length === 0 ? (
          <Card className="text-center py-16 shadow-sm border-border/50">
            <CardContent className="flex flex-col items-center justify-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Package className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-bold mb-2 text-foreground">Vaša korpa je prazna</h2>
              <p className="text-muted-foreground mb-8 max-w-sm">Nemate dodatih proizvoda. Istražite naš katalog i pronađite profesionalnu opremu za vaš salon.</p>
              <Button asChild size="lg">
                 <Link href="/vlasnik/shop">Nastavi kupovinu</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid min-w-0 items-start gap-8 lg:grid-cols-3">
            <div className="min-w-0 space-y-4 lg:col-span-2">
              <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden">
                <div className="p-4 md:p-6 space-y-6">
                  {cart.items.map((item, i) => (
                    <React.Fragment key={item.id}>
                      {i > 0 && <Separator className="bg-border/40" />}
                      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 relative group">
                        <div className="w-full sm:w-24 h-24 rounded-lg bg-muted/30 border border-border/30 overflow-hidden flex-shrink-0">
                          <OptimizedImage src={item.productImageUrl ?? ""} alt={item.productName} width={96} height={96} preferredSize="thumbnail" responsiveSizes="96px" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col justify-between">
                          <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
                            <div className="min-w-0">
                              <h3 className="break-words font-bold text-lg leading-tight text-foreground">{item.productName}</h3>
                              {item.kind === 'bundle' && (
                                <Badge className="mt-1 mb-1" variant="secondary">Paket</Badge>
                              )}
                              <p className="text-sm text-muted-foreground mt-1">
                                {item.variantLabel ? `${item.variantLabel}: ` : ""}{item.variantValue ?? "Standard"}
                              </p>
                              {item.productSku && <p className="text-xs text-muted-foreground/70 mt-1">SKU: {item.productSku}</p>}
                              {item.lowStock && <p className="text-xs text-amber-600 font-medium mt-1">Niske zalihe</p>}
                            </div>
                            <div className="shrink-0 text-left sm:text-right">
                              <p className="font-bold text-lg text-primary">{money(item.unitPrice)}</p>
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <div className="flex shrink-0 items-center space-x-1 rounded-lg border border-border/50 bg-muted/20 p-1">
                              <Button
                                aria-label={`Smanji količinu za ${item.productName}`}
                                data-testid={`button-cart-decrement-${item.id}`}
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => handleUpdateQuantity(item.id, item.quantity, -1, item.availableStock)}
                                disabled={item.quantity <= 1 || cartBusy}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                              <Button
                                aria-label={`Povećaj količinu za ${item.productName}`}
                                data-testid={`button-cart-increment-${item.id}`}
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => handleUpdateQuantity(item.id, item.quantity, 1, item.availableStock)}
                                disabled={item.quantity >= item.availableStock || cartBusy}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                            <Button
                              data-testid={`button-cart-remove-${item.id}`}
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => handleRemove(item.id)}
                              disabled={cartBusy}
                            >
                              <Trash2 className="h-4 w-4 mr-2" /> Ukloni
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-primary"
                              onClick={() => saveItem.mutate({ cartItemId: item.id })}
                              disabled={saveItem.isPending}
                            >
                              Sačuvaj za kasnije
                            </Button>
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {cart.savedItems?.length > 0 && (
                <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden mt-6">
                  <div className="p-4 md:p-6 bg-muted/20 border-b border-border/50">
                    <h3 className="font-bold text-lg">Sačuvano za kasnije ({cart.savedItems.length})</h3>
                  </div>
                  <div className="p-4 md:p-6 space-y-4">
                    {cart.savedItems.map((saved) => (
                      <div key={saved.id} className="flex min-w-0 flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 flex-col">
                          <span className="font-medium">Sačuvan artikal</span>
                          <span className="text-xs text-muted-foreground">Količina: {saved.quantity}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => restoreItem.mutate({ savedItemId: saved.id })} disabled={restoreItem.isPending}>
                            Vrati u korpu
                          </Button>
                          <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeSavedItem.mutate({ savedItemId: saved.id })}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {cart.crossSellProducts?.length > 0 && (
                <div className="mt-8">
                  <h3 className="font-bold text-xl mb-4">Možda će vas zanimati</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {cart.crossSellProducts.map((product) => (
                      <Card key={product.id} className="overflow-hidden">
                        <div className="aspect-square bg-muted">
                          <OptimizedImage src={product.imageUrl} alt={product.name} width={200} height={200} className="w-full h-full object-cover" />
                        </div>
                        <CardContent className="p-3">
                          <p className="text-xs text-muted-foreground">{product.brand}</p>
                          <h4 className="font-medium text-sm line-clamp-2 mt-1">{product.name}</h4>
                          <div className="mt-2 flex min-w-0 flex-wrap items-baseline gap-2">
                            <span className="break-words font-bold text-primary">{money(product.discountPrice ?? product.price)}</span>
                            {product.discountPrice != null && <span className="text-xs text-muted-foreground line-through">{money(product.price)}</span>}
                          </div>
                          <Button size="sm" className="w-full mt-3" variant="secondary" onClick={() => addCartItem.mutate({ data: { productId: product.id, quantity: 1 } })}>
                            <Plus className="w-3 h-3 mr-1" /> Dodaj
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="min-w-0 lg:sticky lg:top-8 lg:col-span-1">
              <Card className="shadow-sm border-border/50 overflow-hidden">
                <div className="h-2 bg-primary w-full" />
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl">Rezime korpe</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm pb-6">
                  <div className="flex min-w-0 justify-between gap-3 text-muted-foreground">
                    <span>Proizvodi ({cart.itemCount})</span>
                    <span className="min-w-0 break-words text-right">{money(cart.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Težina pošiljke</span>
                    <span>{(cart.totalWeightGrams / 1000).toFixed(1)} kg</span>
                  </div>
                  <Separator className="bg-border/50" />
                  <div className="flex min-w-0 justify-between gap-3 font-bold text-lg text-foreground">
                    <span>Međuzbir</span>
                    <span className="min-w-0 break-words text-right text-primary">{money(cart.subtotal)}</span>
                  </div>
                  {cart.freeShippingProgress && (
                    <div className="mt-4 p-3 bg-primary/5 rounded-lg border border-primary/20">
                      {cart.freeShippingProgress.remaining === 0 ? (
                         <p className="text-sm font-medium text-emerald-600 flex items-center"><Check className="w-4 h-4 mr-1" /> Ostvarili ste besplatnu dostavu!</p>
                      ) : (
                         <p className="text-sm text-muted-foreground">Još <strong className="text-primary">{money(cart.freeShippingProgress.remaining)}</strong> do besplatne dostave.</p>
                      )}
                    </div>
                  )}
                  {cart.showLoyaltyPoints && (
                    <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
                       <p className="text-sm text-amber-900 font-medium">Trenutno bodova: {cart.currentLoyaltyPoints}</p>
                       <p className="text-sm text-amber-700 mt-1">Nakon ove kupovine: {cart.projectedLoyaltyPoints} bodova</p>
                    </div>
                  )}
                  {cart.estimatedDeliveryDate && (
                    <p className="text-sm text-muted-foreground mt-4 text-center">Procenjena isporuka: {new Date(cart.estimatedDeliveryDate).toLocaleDateString("sr-RS")}</p>
                  )}
                  <p className="text-xs text-muted-foreground text-center mt-2">Dostava se obračunava u sledećem koraku.</p>
                </CardContent>

                <div className="p-4 bg-muted/10 border-t border-border/30 flex flex-col gap-3">
                  <Button size="lg" className="w-full text-base font-medium h-12" asChild>
                    <Link href="/vlasnik/prodavnica/dostava">
                      Nastavi na dostavu <ChevronRight className="h-5 w-5 ml-2" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" className="w-full text-base font-medium h-12" onClick={() => setShowQuoteDialog(true)}>
                    <FileText className="h-5 w-5 mr-2" /> Kreiraj PDF ponudu
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        )}
        <CreateShopQuoteDialog open={showQuoteDialog} onOpenChange={setShowQuoteDialog} />
      </div>

    </BusinessLayout>
  );
}


const deliverySchema = z.object({
  useSalonAddress: z.boolean(),
  deliveryMethod: z.enum(["courier", "personal_belgrade"]),
  deliveryAddress: z.object({
    recipientName: z.string().min(2, "Unesite ime primaoca"),
    street: z.string().min(2, "Unesite ulicu i broj"),
    city: z.string().min(2, "Unesite grad"),
    postalCode: z.string().min(2, "Unesite poštanski broj"),
    phone: z.string().min(6, "Unesite broj telefona"),
    email: z.string().email("Unesite validnu email adresu"),
  }).optional(),
  useBilling: z.boolean(),
  billingDetails: z.object({
    companyName: z.string().min(2, "Unesite naziv firme"),
    pib: z.string().min(8, "Unesite PIB").max(10, "Neispravan PIB"),
    registrationNumber: z.string().min(8, "Unesite matični broj"),
    street: z.string().min(2, "Unesite ulicu i broj"),
    city: z.string().min(2, "Unesite grad"),
    postalCode: z.string().min(2, "Unesite poštanski broj"),
  }).optional(),
}).superRefine((data, ctx) => {
  if (!data.useSalonAddress) {
    if (!data.deliveryAddress?.recipientName) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Obavezno polje", path: ["deliveryAddress", "recipientName"] });
    if (!data.deliveryAddress?.street) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Obavezno polje", path: ["deliveryAddress", "street"] });
    if (!data.deliveryAddress?.city) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Obavezno polje", path: ["deliveryAddress", "city"] });
    if (!data.deliveryAddress?.postalCode) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Obavezno polje", path: ["deliveryAddress", "postalCode"] });
    if (!data.deliveryAddress?.phone) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Obavezno polje", path: ["deliveryAddress", "phone"] });
    if (!data.deliveryAddress?.email) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Obavezno polje", path: ["deliveryAddress", "email"] });
  }
  if (data.useBilling) {
    if (!data.billingDetails?.companyName) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Obavezno polje", path: ["billingDetails", "companyName"] });
    if (!data.billingDetails?.pib) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Obavezno polje", path: ["billingDetails", "pib"] });
    if (!data.billingDetails?.registrationNumber) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Obavezno polje", path: ["billingDetails", "registrationNumber"] });
    if (!data.billingDetails?.street) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Obavezno polje", path: ["billingDetails", "street"] });
    if (!data.billingDetails?.city) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Obavezno polje", path: ["billingDetails", "city"] });
    if (!data.billingDetails?.postalCode) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Obavezno polje", path: ["billingDetails", "postalCode"] });
  }
});

type DeliveryFormValues = z.infer<typeof deliverySchema>;

export function OwnerCheckoutDeliveryPage() {
  const [, setLocation] = useLocation();
  const { data: profile, isLoading, isError } = useGetShopCheckoutProfile();
  const { data: preview } = useGetShopCheckoutPreview();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const form = useForm<DeliveryFormValues>({
    resolver: zodResolver(deliverySchema),
    defaultValues: {
      useSalonAddress: true,
      deliveryMethod: "courier",
      useBilling: false,
    }
  });

  useEffect(() => {
    if (!profile) return;
    const savedSalonAddressIsComplete = [
      profile.salonAddress.recipientName,
      profile.salonAddress.street,
      profile.salonAddress.city,
      profile.salonAddress.postalCode,
      profile.salonAddress.phone,
      profile.salonAddress.email,
    ].every((value) => value?.trim());
    try {
      const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        form.reset({ ...parsed, useSalonAddress: savedSalonAddressIsComplete ? parsed.useSalonAddress : false });
      } else {
        form.reset({
          useSalonAddress: savedSalonAddressIsComplete,
          useBilling: !!profile.billingDefaults,
           deliveryMethod: "courier",
          billingDetails: profile.billingDefaults ? {
            companyName: profile.billingDefaults.companyName,
            pib: profile.billingDefaults.pib,
            registrationNumber: profile.billingDefaults.registrationNumber,
            street: profile.billingDefaults.street,
            city: profile.billingDefaults.city,
            postalCode: profile.billingDefaults.postalCode,
          } : undefined,
          deliveryAddress: {
             recipientName: profile.salonAddress.recipientName,
             street: profile.salonAddress.street,
             city: profile.salonAddress.city,
             postalCode: profile.salonAddress.postalCode,
             phone: profile.salonAddress.phone,
             email: profile.salonAddress.email,
          }
        });
      }
    } catch (e) {
      // Ignored
    }
  }, [profile, form]);

  const onSubmit = (values: DeliveryFormValues) => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(values));
    setLocation("/vlasnik/prodavnica/pregled");
  };

  const useSalonAddress = form.watch("useSalonAddress");
  const useBilling = form.watch("useBilling");
  const deliveryMethod = form.watch("deliveryMethod");
  const destinationCity = useSalonAddress ? profile?.salonAddress.city : form.watch("deliveryAddress.city");
  const personalOption = preview?.shipping.availableMethods.find(method => method.id === "personal_belgrade");
  const personalAvailable = !!personalOption?.available && /beograd/i.test(destinationCity ?? "");
  const savedSalonAddressIsComplete = !!profile && [
    profile.salonAddress.recipientName,
    profile.salonAddress.street,
    profile.salonAddress.city,
    profile.salonAddress.postalCode,
    profile.salonAddress.phone,
    profile.salonAddress.email,
  ].every((value) => value?.trim());

  if (!mounted) return null;

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Button variant="ghost" asChild className="mb-6 -ml-4 text-muted-foreground hover:text-foreground">
          <Link href="/vlasnik/prodavnica/korpa"><ArrowLeft className="w-4 h-4 mr-2" /> Nazad u korpu</Link>
        </Button>
        <CheckoutStepper step={2} />

        <div className="mb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-primary mb-2">Dostava i faktura</h1>
          <p className="text-muted-foreground">Unesite podatke o lokaciji za isporuku</p>
        </div>

        {isLoading ? (
          <div className="space-y-4 max-w-3xl mx-auto"><Skeleton className="h-[400px] w-full" /></div>
        ) : isError || !profile ? (
          <Alert variant="destructive" className="max-w-3xl mx-auto"><AlertTriangle className="h-4 w-4" /><AlertTitle>Greška</AlertTitle><AlertDescription>Nismo uspeli da učitamo vaš profil. Pokušajte ponovo.</AlertDescription></Alert>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8 items-start">
            <div className="lg:col-span-2">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" id="delivery-form">
                   {!savedSalonAddressIsComplete && (
                     <Alert className="border-amber-300 bg-amber-50 text-amber-950">
                       <AlertTriangle className="h-4 w-4" />
                       <AlertTitle>Dopunite adresu za ovu porudžbinu</AlertTitle>
                       <AlertDescription>
                         Adresi salona nedostaje poštanski broj. Unesite ga u nastavku; sačuvaćemo je uz ovu porudžbinu.
                       </AlertDescription>
                     </Alert>
                   )}

                  {/* DELIVERY SECTION */}
                  <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden">
                    <div className="bg-muted/30 px-6 py-4 border-b border-border/30 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Truck className="w-4 h-4" /></div>
                      <h2 className="text-lg font-bold text-foreground">Adresa isporuke</h2>
                    </div>
                    <div className="p-6 space-y-6">
                      <FormField
                        control={form.control}
                        name="useSalonAddress"
                        render={({ field }) => (
                          <FormItem className="space-y-4">
                            <FormControl>
                              <RadioGroup
                                onValueChange={(val) => field.onChange(val === "true")}
                                defaultValue={field.value ? "true" : "false"}
                                className="grid sm:grid-cols-2 gap-4"
                              >
                                <div>
                                  <RadioGroupItem value="true" id="salon" className="peer sr-only" disabled={!savedSalonAddressIsComplete} />
                                  <Label
                                    htmlFor="salon"
                                    className={`flex flex-col items-start justify-between rounded-xl border-2 border-border/50 bg-card p-4 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all ${savedSalonAddressIsComplete ? "cursor-pointer hover:bg-muted/20" : "cursor-not-allowed opacity-60"}`}
                                  >
                                    <div className="flex items-center gap-2 mb-2">
                                      <div className="w-4 h-4 rounded-full border border-primary flex items-center justify-center">
                                        {field.value && <div className="w-2 h-2 rounded-full bg-primary" />}
                                      </div>
                                      <span className="font-bold">Moj salon</span>
                                    </div>
                                    <div className="text-sm text-muted-foreground font-normal space-y-1">
                                       <p className="font-medium text-foreground">{profile.salonName}</p>
                                      <p>{profile.salonAddress.recipientName}</p>
                                      <p>{profile.salonAddress.street}</p>
                                      <p>{profile.salonAddress.postalCode} {profile.salonAddress.city}</p>
                                      <p>{profile.salonAddress.phone}</p>
                                       <p>{profile.salonAddress.email}</p>
                                     {!savedSalonAddressIsComplete && <p className="pt-1 text-amber-700">Nedostaje poštanski broj</p>}
                                    </div>
                                  </Label>
                                </div>
                                <div>
                                  <RadioGroupItem value="false" id="other" className="peer sr-only" />
                                  <Label
                                    htmlFor="other"
                                    className="flex flex-col items-start justify-between rounded-xl border-2 border-border/50 bg-card p-4 hover:bg-muted/20 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer h-full transition-all"
                                  >
                                    <div className="flex items-center gap-2 mb-2">
                                      <div className="w-4 h-4 rounded-full border border-primary flex items-center justify-center">
                                        {!field.value && <div className="w-2 h-2 rounded-full bg-primary" />}
                                      </div>
                                      <span className="font-bold">Druga adresa</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground font-normal">Unesite alternativnu adresu za isporuku ove porudžbine.</p>
                                  </Label>
                                </div>
                              </RadioGroup>
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      {!useSalonAddress && (
                        <div className="pt-4 space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
                          <div className="grid sm:grid-cols-2 gap-4">
                            <FormField control={form.control} name="deliveryAddress.recipientName" render={({ field }) => (
                              <FormItem><FormLabel>Ime i prezime primaoca</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name="deliveryAddress.phone" render={({ field }) => (
                              <FormItem><FormLabel>Telefon</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                            )} />
                          </div>
                          <FormField control={form.control} name="deliveryAddress.email" render={({ field }) => (
                            <FormItem><FormLabel>Email adresa</FormLabel><FormControl><Input type="email" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <FormField control={form.control} name="deliveryAddress.street" render={({ field }) => (
                            <FormItem><FormLabel>Ulica i broj</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <div className="grid sm:grid-cols-2 gap-4">
                            <FormField control={form.control} name="deliveryAddress.postalCode" render={({ field }) => (
                              <FormItem><FormLabel>Poštanski broj</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name="deliveryAddress.city" render={({ field }) => (
                              <FormItem><FormLabel>Grad</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                            )} />
                          </div>
                        </div>
                      )}
                      <FormField control={form.control} name="deliveryMethod" render={({ field }) => (
                        <FormItem className="pt-2">
                          <FormLabel>Način dostave</FormLabel>
                          <FormControl><RadioGroup value={field.value} onValueChange={field.onChange} className="grid gap-3 sm:grid-cols-2">
                            <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 has-[[data-state=checked]]:border-primary">
                              <RadioGroupItem value="courier" /><span><b>Kurirska služba</b><small className="mt-1 block text-muted-foreground">Cena se računa prema težini pošiljke.</small></span>
                            </Label>
                            <Label className={`flex items-start gap-3 rounded-lg border p-4 ${personalAvailable ? "cursor-pointer has-[[data-state=checked]]:border-primary" : "cursor-not-allowed opacity-60"}`}>
                              <RadioGroupItem value="personal_belgrade" disabled={!personalAvailable} /><span><b>{personalOption?.name ?? "Lična dostava u Beogradu"}</b><small className="mt-1 block text-muted-foreground">{personalAvailable ? `${money(personalOption?.price ?? 0)} · ${personalOption?.description ?? ""}` : "Dostupno samo za adresu u Beogradu."}</small></span>
                            </Label>
                          </RadioGroup></FormControl>
                          {deliveryMethod === "personal_belgrade" && !personalAvailable && <FormDescription className="text-destructive">Izaberite adresu u Beogradu ili kurirsku dostavu.</FormDescription>}
                        </FormItem>
                      )} />
                    </div>
                  </div>

                  {/* BILLING SECTION */}
                  <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden">
                    <div className="bg-muted/30 px-6 py-4 border-b border-border/30 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Receipt className="w-4 h-4" /></div>
                      <h2 className="text-lg font-bold text-foreground">Podaci za račun</h2>
                    </div>
                    <div className="p-6 space-y-6">
                      <FormField
                        control={form.control}
                        name="useBilling"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border/50 p-4 bg-card hover:bg-muted/10 transition-colors">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base cursor-pointer">Želim fakturu na firmu (B2B)</FormLabel>
                              <FormDescription>Poreski identifikacioni podaci za izdavanje e-fakture</FormDescription>
                            </div>
                            <FormControl>
                              <Checkbox checked={field.value} onCheckedChange={field.onChange} className="w-5 h-5" />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      {useBilling && (
                        <div className="pt-2 space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
                          <FormField control={form.control} name="billingDetails.companyName" render={({ field }) => (
                            <FormItem><FormLabel>Pun naziv firme</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <div className="grid sm:grid-cols-2 gap-4">
                            <FormField control={form.control} name="billingDetails.pib" render={({ field }) => (
                              <FormItem><FormLabel>PIB</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name="billingDetails.registrationNumber" render={({ field }) => (
                              <FormItem><FormLabel>Matični broj</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                            )} />
                          </div>
                          <FormField control={form.control} name="billingDetails.street" render={({ field }) => (
                            <FormItem><FormLabel>Sedište (Ulica i broj)</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <div className="grid sm:grid-cols-2 gap-4">
                            <FormField control={form.control} name="billingDetails.postalCode" render={({ field }) => (
                              <FormItem><FormLabel>Poštanski broj</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={form.control} name="billingDetails.city" render={({ field }) => (
                              <FormItem><FormLabel>Grad</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                            )} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end hidden lg:flex">
                     <Button type="submit" size="lg" className="h-12 px-8 text-base shadow-sm">Nastavi na pregled i plaćanje <ChevronRight className="w-5 h-5 ml-2" /></Button>
                  </div>
                </form>
              </Form>
            </div>

            {/* RIGHT COLUMN: MINI SUMMARY */}
            <div className="lg:col-span-1 sticky top-8">
              <Card className="shadow-sm border-border/50">
                <CardHeader className="bg-muted/10 border-b border-border/30 pb-4">
                  <CardTitle className="text-lg">Vaša porudžbina</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 space-y-4 text-sm">
                  {preview ? (
                    <>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Proizvodi ({preview.cart.itemCount})</span>
                        <span>{money(preview.cart.subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Težina</span>
                        <span>{(preview.cart.totalWeightGrams / 1000).toFixed(1)} kg</span>
                      </div>
                      <Separator className="bg-border/50" />
                      <div className="flex justify-between font-bold text-lg text-foreground">
                        <span>Međuzbir</span>
                        <span className="text-primary">{money(preview.cart.subtotal)}</span>
                      </div>
                    </>
                  ) : <Skeleton className="h-24 w-full" />}
                </CardContent>
                <div className="p-4 bg-muted/10 border-t border-border/30 lg:hidden">
                   <Button onClick={() => form.handleSubmit(onSubmit)()} size="lg" className="w-full text-base font-medium h-12 shadow-sm">
                     Nastavi <ChevronRight className="w-5 h-5 ml-2" />
                   </Button>
                </div>
              </Card>
              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                 <Lock className="w-3 h-3" />
                 <span>Sigurna SSL enkripcija</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </BusinessLayout>
  );
}


const reviewSchema = z.object({
  paymentMethod: z.nativeEnum(ShopCheckoutInputPaymentMethod),
  note: z.string().optional(),
  termsAccepted: z.boolean().refine(val => val === true, { message: "Morate prihvatiti uslove kupovine" }),
});

type ReviewFormValues = z.infer<typeof reviewSchema>;

export function OwnerCheckoutReviewPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [desiredCredit, setDesiredCredit] = useState(0);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | undefined>(undefined);
  const [couponError, setCouponError] = useState<string | null>(null);

  const { data: preview, isLoading, isError, error, isFetching } = useGetShopCheckoutPreview(
    { desiredReferralCreditRsd: desiredCredit, couponCode: appliedCoupon } as any,
    { query: { retry: (count: number, err: unknown) => {
      const { status } = getApiErrorDetails(err);
      return status !== undefined && status >= 400 && status < 500 ? false : count < 3;
    }, queryKey: getGetShopCheckoutPreviewQueryKey({ desiredReferralCreditRsd: desiredCredit, couponCode: appliedCoupon } as any) } as any }
  );

  const checkoutMutation = useCheckoutShopCart();
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [draft, setDraft] = useState<DeliveryFormValues | null>(null);

  useEffect(() => {
    setMounted(true);
    const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) {
      setDraft(JSON.parse(saved));
    } else {
      setLocation("/vlasnik/prodavnica/dostava");
    }
    const savedCoupon = sessionStorage.getItem("lumera_checkout_coupon");
    if (savedCoupon) setAppliedCoupon(savedCoupon);
  }, [setLocation]);

  useEffect(() => {
    const { code, message } = getApiErrorDetails(error);
    if (isError && code?.startsWith("COUPON_")) {
      setCouponError(message ?? "Kupon nije moguće primeniti.");
      setAppliedCoupon(undefined);
      sessionStorage.removeItem("lumera_checkout_coupon");
    }
  }, [isError, error]);

  const form = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      paymentMethod: ShopCheckoutInputPaymentMethod.BANK_TRANSFER,
      note: "",
      termsAccepted: false,
    }
  });

  const onSubmit = (values: ReviewFormValues) => {
    if (!draft) return;
    const payload = {
      useSalonAddress: draft.useSalonAddress,
      deliveryMethod: draft.deliveryMethod,
      deliveryAddress: draft.useSalonAddress ? undefined : draft.deliveryAddress,
      billingDetails: draft.useBilling ? draft.billingDetails : null,
      paymentMethod: values.paymentMethod,
      note: values.note || null,
      termsAccepted: values.termsAccepted,
      desiredReferralCreditRsd: desiredCredit,
      couponCode: appliedCoupon,
      expectedSubtotal: preview?.cart.subtotal,
      expectedTotal: preview?.total,
      expectedShippingCost: preview?.shipping.shippingCost,
    };

    checkoutMutation.mutate({ data: payload as any }, {
      onSuccess: (order) => {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        sessionStorage.removeItem("lumera_checkout_coupon");
        queryClient.invalidateQueries({ queryKey: getGetShopCartQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetShopCheckoutPreviewQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListSalonNotificationsQueryKey() });
        setLocation(`/vlasnik/prodavnica/porudzbina/${order.id}/potvrda`);
      },
      onError: async (error) => {
        const { data: errorData, status: errorStatus, code: responseCode } = getApiErrorDetails(error);
        if (responseCode === "APPROVAL_REQUIRED") {
          const approvalKey = sessionStorage.getItem("lumera_approval_request_key") ?? crypto.randomUUID();
          sessionStorage.setItem("lumera_approval_request_key", approvalKey);
          const response = await fetch("/api/shop/approval-requests", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              idempotencyKey: approvalKey,
              couponCode: appliedCoupon,
              desiredReferralCreditRsd: desiredCredit,
            }),
          });
          const approval = await response.json().catch(() => ({}));
          if (!response.ok) {
            toast.error("Zahtev nije poslat.", {
              description: approval.error ?? "Pokušajte ponovo ili se obratite vlasniku salona.",
            });
            return;
          }
          sessionStorage.removeItem("lumera_approval_request_key");
          toast.success("Zahtev je poslat vlasniku.", {
            description: "Zalihe i iznosi neće biti promenjeni dok vlasnik ne odobri porudžbinu.",
          });
          setLocation("/zaposleni");
          return;
        }
        if (errorStatus === 409) {
          const unavailableProducts = errorData?.unavailableProducts;
          const productNames = Array.isArray(unavailableProducts)
            ? unavailableProducts.filter((name): name is string => typeof name === "string")
            : [];
          const text = productNames.length === 1
            ? `Proizvod ${productNames[0]} je rasprodat, promenio cenu, ili je dobavljač neaktivan. Porudžbina nije kreirana.`
            : `Proizvodi: ${productNames.join(", ")} su rasprodati, promenili cenu, ili je dobavljač neaktivan. Porudžbina nije kreirana.`;

          toast.error("Promena u katalogu dobavljača", { description: text });

          await queryClient.invalidateQueries({ queryKey: getGetShopCartQueryKey() });
          await queryClient.invalidateQueries({ queryKey: getGetShopCheckoutPreviewQueryKey() });

          setLocation("/vlasnik/prodavnica/korpa");
          return;
        }

        toast.error("Porudžbina nije kreirana.", {
          description: getApiErrorMessage(error, "Proverite podatke za dostavu i pokušajte ponovo."),
        });
      }
    });
  };

  const handleApplyCoupon = () => {
    if (!couponInput.trim()) return;
    setCouponError(null);
    const code = couponInput.trim().toUpperCase();
    setAppliedCoupon(code);
    sessionStorage.setItem("lumera_checkout_coupon", code);
    setCouponInput("");
  };

  const handleRemoveCoupon = () => {
    setCouponError(null);
    setAppliedCoupon(undefined);
    sessionStorage.removeItem("lumera_checkout_coupon");
  };

  const submitOrder = form.handleSubmit(onSubmit);

  if (!mounted || !draft) return null;

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Button variant="ghost" asChild className="mb-6 -ml-4 text-muted-foreground hover:text-foreground">
          <Link href="/vlasnik/prodavnica/dostava"><ArrowLeft className="w-4 h-4 mr-2" /> Nazad na dostavu</Link>
        </Button>
        <CheckoutStepper step={3} />

        <div className="mb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-primary mb-2">Pregled i plaćanje</h1>
          <p className="text-muted-foreground">Proverite podatke i potvrdite vašu B2B porudžbinu</p>
        </div>

        {isLoading ? (
           <div className="space-y-4 max-w-3xl mx-auto"><Skeleton className="h-[400px] w-full" /></div>
        ) : isError || !preview ? (
           <Alert variant="destructive" className="max-w-3xl mx-auto"><AlertTriangle className="h-4 w-4" /><AlertTitle>Greška</AlertTitle><AlertDescription>Nismo uspeli da učitamo podatke. Pokušajte ponovo.</AlertDescription></Alert>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8 items-start">
            <div className="lg:col-span-2 space-y-8">

              {/* DRAFT REVIEW SUMMARY */}
              <div className="grid sm:grid-cols-2 gap-4">
                <Card className="shadow-sm border-border/50">
                  <CardHeader className="py-4 border-b border-border/30 bg-muted/10 flex flex-row justify-between items-center">
                    <CardTitle className="text-sm font-bold flex items-center gap-2"><Truck className="w-4 h-4 text-primary"/> Adresa isporuke</CardTitle>
                    <Link href="/vlasnik/prodavnica/dostava" className="text-xs text-primary hover:underline font-medium">Izmeni</Link>
                  </CardHeader>
                  <CardContent className="py-4 text-sm text-muted-foreground space-y-1">
                    {draft.useSalonAddress ? (
                       <p>{draft.deliveryMethod === "personal_belgrade" ? "Lična dostava na adresu salona u Beogradu." : "Kurirska isporuka na adresu salona iz profila."}</p>
                    ) : (
                      <>
                        <p className="font-medium text-foreground">{draft.deliveryAddress?.recipientName}</p>
                        <p>{draft.deliveryAddress?.street}</p>
                        <p>{draft.deliveryAddress?.postalCode} {draft.deliveryAddress?.city}</p>
                        <p>{draft.deliveryAddress?.phone}</p>
                      </>
                    )}
                  </CardContent>
                </Card>
                <Card className="shadow-sm border-border/50">
                  <CardHeader className="py-4 border-b border-border/30 bg-muted/10 flex flex-row justify-between items-center">
                    <CardTitle className="text-sm font-bold flex items-center gap-2"><Receipt className="w-4 h-4 text-primary"/> Račun / Faktura</CardTitle>
                    <Link href="/vlasnik/prodavnica/dostava" className="text-xs text-primary hover:underline font-medium">Izmeni</Link>
                  </CardHeader>
                  <CardContent className="py-4 text-sm text-muted-foreground space-y-1">
                    {draft.useBilling && draft.billingDetails ? (
                      <>
                        <p className="font-medium text-foreground">{draft.billingDetails.companyName}</p>
                        <p>PIB: {draft.billingDetails.pib}</p>
                        <p>MB: {draft.billingDetails.registrationNumber}</p>
                        <p>{draft.billingDetails.street}, {draft.billingDetails.city}</p>
                      </>
                    ) : (
                      <p>Standardni račun za fizičko lice (bez PIB-a).</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* PAYMENT & CONFIRM FORM */}
              <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden">
                 <div className="bg-muted/30 px-6 py-4 border-b border-border/30 flex items-center gap-3">
                   <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center"><CreditCard className="w-4 h-4" /></div>
                   <h2 className="text-lg font-bold text-foreground">Način plaćanja</h2>
                 </div>
                 <div className="p-6">
                   <Form {...form}>
                     <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" id="checkout-form">
                       <FormField
                         control={form.control}
                         name="paymentMethod"
                         render={({ field }) => (
                           <FormItem>
                             <FormControl>
                               <RadioGroup
                                 onValueChange={field.onChange}
                                 defaultValue={field.value}
                                 className="grid sm:grid-cols-3 gap-4"
                               >
                                 {preview.paymentMethods.includes("BANK_TRANSFER") && (
                                   <div>
                                     <RadioGroupItem value="BANK_TRANSFER" id="bank" className="peer sr-only" />
                                     <Label htmlFor="bank" className="flex flex-col items-center justify-center text-center rounded-xl border-2 border-border/50 bg-card p-4 hover:bg-muted/20 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer transition-all h-full gap-3">
                                       <FileText className="w-8 h-8 text-muted-foreground peer-data-[state=checked]:text-primary" />
                                       <span className="font-bold">Uplata na račun</span>
                                        <span className="text-xs text-muted-foreground font-normal">Uputstva za uplatu biće dostupna uz porudžbinu</span>
                                     </Label>
                                   </div>
                                 )}
                                 {preview.paymentMethods.includes("CARD") && (
                                   <div>
                                     <RadioGroupItem value="CARD" id="card" className="peer sr-only" />
                                     <Label htmlFor="card" className="flex flex-col items-center justify-center text-center rounded-xl border-2 border-border/50 bg-card p-4 hover:bg-muted/20 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer transition-all h-full gap-3">
                                       <CreditCard className="w-8 h-8 text-muted-foreground peer-data-[state=checked]:text-primary" />
                                       <span className="font-bold">Platna kartica</span>
                                        <span className="text-xs text-muted-foreground font-normal">Izbor kartice se evidentira; naplata se ne vrši sada</span>
                                     </Label>
                                   </div>
                                 )}
                                 {preview.paymentMethods.includes("CASH_ON_DELIVERY") && (
                                   <div>
                                     <RadioGroupItem value="CASH_ON_DELIVERY" id="cash" className="peer sr-only" />
                                     <Label htmlFor="cash" className="flex flex-col items-center justify-center text-center rounded-xl border-2 border-border/50 bg-card p-4 hover:bg-muted/20 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer transition-all h-full gap-3">
                                       <Truck className="w-8 h-8 text-muted-foreground peer-data-[state=checked]:text-primary" />
                                       <span className="font-bold">Pouzećem</span>
                                       <span className="text-xs text-muted-foreground font-normal">Gotovinom pri preuzimanju</span>
                                     </Label>
                                   </div>
                                 )}
                               </RadioGroup>
                             </FormControl>
                           </FormItem>
                         )}
                       />

                       <Separator className="bg-border/40" />

                       <FormField control={form.control} name="note" render={({ field }) => (
                         <FormItem>
                           <FormLabel>Napomena za kurira ili prodavca (opciono)</FormLabel>
                           <FormControl><Textarea placeholder="Npr. Zvoniti dvaput, lokal se nalazi u pasažu..." className="resize-none min-h-[80px]" {...field} value={field.value || ""} /></FormControl>
                         </FormItem>
                       )} />

                       <FormField control={form.control} name="termsAccepted" render={({ field }) => (
                         <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-border/50 bg-muted/10 p-4">
                           <FormControl>
                             <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                           </FormControl>
                           <div className="space-y-1 leading-none">
                             <FormLabel className="cursor-pointer">Saglasan sam sa <Link href="/uslovi-kupovine" className="text-primary hover:underline">uslovima kupovine</Link> i <Link href="/politika-privatnosti" className="text-primary hover:underline">politikom privatnosti</Link></FormLabel>
                             <FormDescription className="text-xs">Klikom na dugme "Potvrdi porudžbinu" obavezujete se na plaćanje poručenih artikala.</FormDescription>
                             <FormMessage />
                           </div>
                         </FormItem>
                       )} />
                     </form>
                   </Form>
                 </div>
              </div>
            </div>

            {/* RIGHT COLUMN: FULL SUMMARY */}
            <div className="lg:col-span-1 sticky top-8 space-y-4">
              <Card className="shadow-sm border-border/50 overflow-hidden">
                <div className="h-2 bg-primary w-full" />
                <CardHeader className="pb-4 border-b border-border/30 bg-muted/10">
                  <CardTitle className="text-lg">Konačan iznos</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-4 text-sm pb-4">
                   <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                     {preview.cart.items.map(item => (
                       <div key={item.id} className="flex justify-between items-start gap-2 text-xs">
                         <span className="text-muted-foreground truncate" title={item.productName}>{item.quantity}x {item.productName}</span>
                         <span className="font-medium whitespace-nowrap">{money(item.lineTotal)}</span>
                       </div>
                     ))}
                   </div>
                   <Separator className="bg-border/50" />

                   <div className="py-2">
                     {appliedCoupon ? (
                       <div className="flex items-center justify-between p-3 bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-200 dark:border-emerald-800/30 rounded-lg">
                         <div className="flex flex-col">
                           <span className="font-medium flex items-center gap-2 text-emerald-800 dark:text-emerald-400">
                             <Tag className="w-4 h-4" /> {appliedCoupon}
                           </span>
                           {(preview as any).coupon?.freeShipping && (
                             <span className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">Besplatna dostava</span>
                           )}
                         </div>
                         <Button
                           type="button"
                           variant="ghost"
                           size="sm"
                           onClick={handleRemoveCoupon}
                           disabled={isLoading || isFetching}
                           className="text-destructive hover:bg-destructive/10 h-8"
                         >
                           Ukloni
                         </Button>
                       </div>
                     ) : (
                       <div className="flex flex-col gap-2">
                         <div className="flex gap-2">
                           <Input
                             placeholder="Unesite kupon kod"
                             value={couponInput}
                             onChange={(e) => setCouponInput(e.target.value)}
                             disabled={isLoading || isFetching}
                             className="h-9"
                           />
                           <Button
                             type="button"
                             variant="secondary"
                             onClick={handleApplyCoupon}
                             disabled={isLoading || isFetching || !couponInput.trim()}
                             className="h-9"
                           >
                             Primeni
                           </Button>
                         </div>
                         {couponError && (
                           <p className="text-xs text-destructive animate-in fade-in">{couponError}</p>
                         )}
                       </div>
                     )}
                   </div>

                   <Separator className="bg-border/50" />

                   <div className="space-y-2">
                     {preview?.rewardGifts?.length > 0 && (
                       <div className="mb-4 space-y-2">
                         {preview.rewardGifts.map((gift, i) => (
                           <div key={`gift-${i}`} className="flex justify-between text-sm items-center text-emerald-600 bg-emerald-500/10 p-2 rounded">
                             <div className="flex flex-col w-2/3">
                               <span className="truncate font-semibold flex items-center gap-1">🎁 1x {gift.productName}</span>
                             </div>
                             <span className="font-bold">Besplatno</span>
                           </div>
                         ))}
                       </div>
                     )}

                     <div className="flex justify-between text-muted-foreground">
                        <span>Međuzbir robe</span>
                        <span>{money((preview as any).merchandiseSubtotalRsd ?? preview.cart.subtotal)}</span>
                     </div>
                     {preview.automaticPromotionDiscountRsd > 0 && (
                       <div className="flex justify-between text-emerald-600 font-medium">
                          <span>X+Y popust</span>
                          <span>-{money(preview.automaticPromotionDiscountRsd)}</span>
                       </div>
                     )}
                     {preview.thresholdRewardDiscountRsd > 0 && (
                       <div className="flex justify-between text-emerald-600 font-medium">
                          <span>Nivo korpe popust</span>
                          <span>-{money(preview.thresholdRewardDiscountRsd)}</span>
                       </div>
                     )}
                     {(preview as any).couponDiscountRsd != null && (preview as any).couponDiscountRsd > 0 && (
                       <div className="flex justify-between text-emerald-600 font-medium">
                          <span>Popust (kupon)</span>
                          <span>-{money((preview as any).couponDiscountRsd)}</span>
                       </div>
                     )}
                     {preview.referralCreditAvailableRsd > 0 && (
                       <div className="py-2">
                         <div className="flex justify-between text-sm mb-2">
                           <span className="text-primary font-medium flex items-center gap-1">Preporuke (Kredit: {money(preview.referralCreditAvailableRsd)})</span>
                         </div>
                         <div className="flex gap-2 items-center">
                           <Input
                             type="number"
                             min={0}
                             max={Math.min(preview.referralCreditAvailableRsd, (preview as any).merchandiseSubtotalRsd ?? preview.cart.subtotal)}
                             value={desiredCredit}
                             onChange={(e) => setDesiredCredit(Math.min(Number(e.target.value) || 0, Math.min(preview.referralCreditAvailableRsd, (preview as any).merchandiseSubtotalRsd ?? preview.cart.subtotal)))}
                             className="h-8 text-sm"
                           />
                           <Button
                             type="button"
                             variant="outline"
                             size="sm"
                             onClick={() => setDesiredCredit(Math.min(preview.referralCreditAvailableRsd, (preview as any).merchandiseSubtotalRsd ?? preview.cart.subtotal))}
                             className="h-8 whitespace-nowrap text-xs"
                           >
                             Maks
                           </Button>
                         </div>
                         <p className="text-[10px] text-muted-foreground mt-1">Kredit se može iskoristiti samo za robu, ne i za dostavu.</p>
                       </div>
                     )}
                     {preview.referralCreditAppliedRsd > 0 && (
                       <div className="flex justify-between text-emerald-600 font-medium">
                          <span>Primenjen kredit</span>
                          <span>-{money(preview.referralCreditAppliedRsd)}</span>
                       </div>
                     )}
                     <div className="flex justify-between text-muted-foreground">
                         <span>Dostava {draft.deliveryMethod === "personal_belgrade" ? "— lična BG" : `${(preview.shipping.totalWeightGrams / 1000).toFixed(1)}kg`}</span>
                         <span>{draft.deliveryMethod === "personal_belgrade" ? money(preview.shipping.availableMethods.find(m => m.id === "personal_belgrade")?.price ?? 0) : preview.shipping.freeShipping ? <span className="text-green-600 font-medium">Besplatna</span> : money(preview.shipping.shippingCost)}</span>
                     </div>
                     {preview.shipping.message && (
                       <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 p-2 rounded text-xs">
                         {preview.shipping.message}
                       </div>
                     )}
                   </div>
                   <Separator className="bg-border/50" />
                   <div className="flex justify-between font-black text-xl text-foreground items-end">
                     <span>Ukupno</span>
                      <span className="text-primary">{money(preview.total)}</span>
                   </div>
                   <p className="text-[10px] text-muted-foreground text-right leading-tight">Uključen PDV (ako je primenjivo).</p>
                </CardContent>
                <div className="p-4 bg-muted/10 border-t border-border/30">
                   <Button
                     type="button"
                     onClick={() => void submitOrder()}
                     size="lg"
                     className="w-full text-base font-bold h-14 shadow-md"
                     disabled={checkoutMutation.isPending}
                     aria-busy={checkoutMutation.isPending}
                     aria-controls="checkout-form"
                   >
                    {checkoutMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Check className="w-5 h-5 mr-2" />}
                    Potvrdi porudžbinu
                  </Button>
                </div>
              </Card>
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
                 <Lock className="w-3 h-3" />
                 <span>Vaši podaci su bezbedni</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </BusinessLayout>
  );
}


export function OwnerOrderConfirmationPage() {
  const [, params] = useRoute("/vlasnik/prodavnica/porudzbina/:id/potvrda");
  const orderId = params?.id;
  const { data: order, isLoading, isError } = useGetOrder(orderId || "", { query: { enabled: !!orderId, queryKey: getGetOrderQueryKey(orderId || "") }});

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-16 max-w-3xl text-center">
        {isLoading ? (
          <div className="space-y-6 flex flex-col items-center">
            <Skeleton className="w-24 h-24 rounded-full" />
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-64 w-full mt-8" />
          </div>
        ) : isError || !order ? (
          <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Greška</AlertTitle><AlertDescription>Porudžbina nije pronađena. Možda je link nevažeći.</AlertDescription></Alert>
        ) : (
          <div className="animate-in fade-in zoom-in-95 duration-500">
            <div className="w-24 h-24 rounded-full bg-green-100 dark:bg-green-900/30 border-4 border-green-500 text-green-600 dark:text-green-400 mx-auto flex items-center justify-center mb-6 shadow-sm">
              <Check className="w-12 h-12" strokeWidth={3} />
            </div>

            <h1 className="text-4xl font-serif font-bold text-foreground mb-4">Hvala vam na porudžbini!</h1>
            <p className="text-xl text-muted-foreground mb-2">Vaša porudžbina <strong className="text-foreground">#{order.id.slice(0,8).toUpperCase()}</strong> je uspešno primljena.</p>
            <p className="text-muted-foreground mb-10 max-w-xl mx-auto">
              Sačuvali smo podatke o porudžbini i vaš izabrani način plaćanja.
              {order.status === "pending" && " Naš tim će uskoro pregledati porudžbinu i javiti naredne korake."}
            </p>

            <Card className="text-left shadow-sm border-border/50 mb-10 overflow-hidden">
               <div className="bg-muted/30 px-6 py-4 border-b border-border/30 flex justify-between items-center">
                 <h2 className="font-bold text-foreground flex items-center gap-2"><Package className="w-4 h-4 text-primary" /> Detalji porudžbine</h2>
                 <span className="text-sm font-medium bg-primary/10 text-primary px-3 py-1 rounded-full">{order.status}</span>
               </div>
               <CardContent className="p-6">
                 <div className="grid sm:grid-cols-2 gap-8">
                   <div>
                     <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Dostava</h3>
                     <div className="text-sm space-y-1 text-foreground">
                        <p className="font-medium">{order.delivery.recipientName}</p>
                        <p>{order.delivery.address}</p>
                        <p>{order.delivery.postalCode} {order.delivery.city}</p>
                     </div>
                   </div>
                   <div>
                     <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Plaćanje</h3>
                     <div className="text-sm space-y-1 text-foreground">
                        <p>Ukupan iznos: <strong className="text-lg text-primary">{money(order.total)}</strong></p>
                        <p className="text-muted-foreground">Broj stavki: {order.itemCount}</p>
                     </div>
                   </div>
                 </div>
               </CardContent>
            </Card>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button asChild size="lg" className="w-full sm:w-auto h-12 px-8 shadow-sm">
                <Link href={`/vlasnik/porudzbine/${order.id}`}>Prati status porudžbine</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full sm:w-auto h-12 px-8">
                <Link href="/vlasnik/shop">Nastavi kupovinu</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </BusinessLayout>
  );
}
