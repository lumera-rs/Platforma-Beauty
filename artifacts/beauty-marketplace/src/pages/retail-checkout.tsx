import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, Minus, Plus, ShoppingBag, Trash2, Check, Tag } from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { OptimizedImage } from "@/components/optimized-image";
import { changedRetailCartItem, notifyRetailCartChanged } from "@/lib/retail-cart-events";
import {
  useGetRetailCart,
  updateRetailCartItem,
  useRemoveRetailCartItem,
  useSaveRetailCartItemForLater,
  useRestoreSavedRetailCartItem,
  useRemoveSavedRetailCartItem,
  getRetailCart,
  previewRetailCheckout,
  usePreviewRetailCheckout,
  useCheckoutRetailCart,
  useAddRetailCartItem,

  getGetRetailCartQueryKey,
  getApiErrorDetails,
  getApiErrorMessage,
  RetailCheckoutInputPaymentMethod,
  RetailCheckoutInputDeliveryMethod,
  type RetailCheckoutInput,
  type RetailCheckoutPreview,
  type CheckoutThresholdNextDescriptor,
  type CheckoutThresholdRewardDescriptor,
  type RetailCartItemsItem,
  type RetailCart,
} from "@workspace/api-client-react";

const money = (value: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(value);

function cartLinesForChange(items: RetailCartItemsItem[]) {
  return items.map((item) => ({
    id: item.id,
    productId: item.kind === "product" ? item.productId : `bundle:${item.bundleId}`,
    name: item.name,
    quantity: item.quantity,
  }));
}

function retailCartFingerprint(cart: RetailCart) {
  return JSON.stringify(cart.items.map((item) => [item.id, item.quantity]));
}

type UnavailableRetailItem = { productId: string; name: string };

function CartLines({
  cart,
  onLocalMutationStart,
  onLocalMutationSettled,
}: {
  cart: RetailCart;
  onLocalMutationStart?: () => void;
  onLocalMutationSettled?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const nameCounts = new Map<string, number>();
  for (const item of cart.items) {
    nameCounts.set(item.name, (nameCounts.get(item.name) ?? 0) + 1);
  }
  const updateItem = useMutation({
    mutationFn: async ({ cartItemId, data }: { cartItemId: string, data: { quantity: number } }) => {
      return updateRetailCartItem(cartItemId, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data) => {
      qc.setQueryData(getGetRetailCartQueryKey(), data);
      notifyRetailCartChanged(data.itemCount, changedRetailCartItem(
        cartLinesForChange(cart.items),
        cartLinesForChange(data.items),
      ));
    },
    onMutate: onLocalMutationStart,
    onSettled: onLocalMutationSettled,
    onError: (error: unknown) => {
      toast.error("Količina nije promenjena.", {
        description: getApiErrorMessage(error, "Osvežite korpu i pokušajte ponovo."),
      });
    },
  });
  const removeItem = useRemoveRetailCartItem({
    mutation: {
      onMutate: onLocalMutationStart,
      onSuccess: (data) => {
        qc.setQueryData(getGetRetailCartQueryKey(), data);
        notifyRetailCartChanged(data.itemCount, changedRetailCartItem(
          cartLinesForChange(cart.items),
          cartLinesForChange(data.items),
        ));
      },
      onError: (error: unknown) => {
        toast.error("Stavka nije uklonjena.", {
          description: getApiErrorMessage(error, "Osvežite korpu i pokušajte ponovo."),
        });
      },
      onSettled: onLocalMutationSettled,
    }
  });
  const saveItem = useSaveRetailCartItemForLater({
    mutation: {
      onMutate: onLocalMutationStart,
      onSuccess: (data) => {
        qc.setQueryData(getGetRetailCartQueryKey(), data);
        notifyRetailCartChanged(data.itemCount, changedRetailCartItem(
          cartLinesForChange(cart.items),
          cartLinesForChange(data.items),
        ));
        toast.success("Sačuvano za kasnije");
      },
      onSettled: onLocalMutationSettled,
      onError: (error: unknown) => {
        toast.error("Stavka nije sačuvana za kasnije.", {
          description: getApiErrorMessage(error, "Pokušajte ponovo."),
        });
      },
    }
  });

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border p-4 sm:p-6 space-y-6">
        {cart.items.map((item, i) => {
          const itemLabel = (nameCounts.get(item.name) ?? 0) > 1 && item.sku
            ? `${item.name} (šifra proizvoda ${item.sku})`
            : item.name;
          return (
          <div key={item.id} className="flex flex-col sm:flex-row gap-4 relative">
            {i > 0 && <div className="absolute -top-3 left-0 right-0 h-px bg-border/50" />}
            <div className="w-full sm:w-24 h-24 shrink-0 rounded-lg bg-muted overflow-hidden">
              {item.imageUrl ? (
                <OptimizedImage src={item.imageUrl} alt={item.name} width={96} height={96} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ShoppingBag /></div>
              )}
            </div>
            <div className="flex-1 flex flex-col justify-between">
              <div className="flex justify-between gap-4">
                <div>
                  <h3 className="font-bold">{item.name}</h3>
                  {item.kind === 'bundle' && <Badge variant="secondary" className="mt-1 mb-1">Paket</Badge>}
                  {item.kind === 'product' && item.variantLabel && (
                    <p className="text-sm text-muted-foreground mt-1">Varijanta: {item.variantLabel}</p>
                  )}
                  {item.sku && <p className="text-xs text-muted-foreground mt-1">SKU: {item.sku}</p>}
                  {item.lowStock && <p className="text-xs text-amber-600 font-medium mt-1">Niske zalihe</p>}
                </div>
                <div className="text-right">
                  <p className="font-bold text-primary">{money(item.unitPrice)}</p>
                </div>
              </div>
              <div className="flex justify-between items-end mt-4">
                <div className="flex items-center gap-1 border rounded-lg p-1">
                  <Button aria-label={`Smanji količinu za ${itemLabel}`} size="icon" variant="ghost" className="h-8 w-8" onClick={() => item.quantity > 1 ? updateItem.mutate({ cartItemId: item.id, data: { quantity: item.quantity - 1 } }) : removeItem.mutate({ cartItemId: item.id })} disabled={updateItem.isPending}><Minus className="h-3.5 w-3.5" /></Button>
                  <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                  <Button aria-label={`Povećaj količinu za ${itemLabel}`} size="icon" variant="ghost" className="h-8 w-8" onClick={() => updateItem.mutate({ cartItemId: item.id, data: { quantity: item.quantity + 1 } })} disabled={updateItem.isPending}><Plus className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-primary" onClick={() => saveItem.mutate({ cartItemId: item.id })} disabled={saveItem.isPending}>Sačuvaj</Button>
                  <Button aria-label={`Ukloni ${itemLabel} iz korpe`} size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => removeItem.mutate({ cartItemId: item.id })} disabled={removeItem.isPending}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

export function RetailCartPage() {
  const { data: cart, isLoading } = useGetRetailCart();
  const qc = useQueryClient();
  const { toast } = useToast();
  const cartRef = useRef<RetailCart | undefined>(cart);
  const localMutationCountRef = useRef(0);
  const cartGenerationRef = useRef(0);

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  const onLocalMutationStart = () => {
    cartGenerationRef.current += 1;
    localMutationCountRef.current += 1;
  };
  const onLocalMutationSettled = () => {
    localMutationCountRef.current = Math.max(0, localMutationCountRef.current - 1);
  };

  useEffect(() => {
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking || localMutationCountRef.current > 0) return;
      checking = true;
      const generation = cartGenerationRef.current;
      try {
        const latest = await getRetailCart();
        if (!active || localMutationCountRef.current > 0 || generation !== cartGenerationRef.current) return;
        const current = cartRef.current;
        if (
          current
          && retailCartFingerprint(latest) === retailCartFingerprint(current)
          && latest.subtotal === current.subtotal
        ) return;
        qc.setQueryData(getGetRetailCartQueryKey(), latest);
        if (current) {
          notifyRetailCartChanged(latest.itemCount, changedRetailCartItem(
            cartLinesForChange(current.items),
            cartLinesForChange(latest.items),
          ));
        }
      } catch {
        // A later focus or interval check retries transient failures.
      } finally {
        checking = false;
      }
    };
    const interval = window.setInterval(() => { void check(); }, 4_000);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [qc]);

  const restoreItem = useRestoreSavedRetailCartItem({
    mutation: {
      onMutate: onLocalMutationStart,
      onSuccess: (data) => {
        qc.setQueryData(getGetRetailCartQueryKey(), data);
        notifyRetailCartChanged(data.itemCount);
        toast.success("Stavka vraćena u korpu");
      },
      onError: (error: unknown) => {
        toast.error("Stavka nije vraćena u korpu.", {
          description: getApiErrorMessage(error, "Pokušajte ponovo."),
        });
      },
      onSettled: onLocalMutationSettled,
    }
  });

  const removeSaved = useRemoveSavedRetailCartItem({
    mutation: {
      onMutate: onLocalMutationStart,
      onSuccess: (data) => qc.setQueryData(getGetRetailCartQueryKey(), data),
      onError: (error: unknown) => {
        toast.error("Sačuvana stavka nije uklonjena.", {
          description: getApiErrorMessage(error, "Pokušajte ponovo."),
        });
      },
      onSettled: onLocalMutationSettled,
    }
  });

  const addItem = useAddRetailCartItem({
    mutation: {
      onMutate: onLocalMutationStart,
      onSuccess: (data) => {
        qc.setQueryData(getGetRetailCartQueryKey(), data);
        notifyRetailCartChanged(data.itemCount);
        toast.success("Dodato u korpu");
      },
      onError: (error: unknown) => {
        toast.error("Dodavanje u korpu nije uspelo.", {
          description: getApiErrorMessage(error, "Proverite dostupnost proizvoda i pokušajte ponovo."),
        });
      },
      onSettled: onLocalMutationSettled,
    }
  });

  return (
    <Layout>
      <main className="mx-auto min-h-screen max-w-4xl px-4 py-10">
        <h1 className="font-serif text-4xl font-bold mb-2">Vaša korpa</h1>

        {isLoading ? (
          <div className="flex justify-center mt-10"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>
        ) : !cart || !cart.items.length ? (
          <div className="mt-10 rounded-2xl border p-12 text-center bg-card shadow-sm">
            <ShoppingBag className="mx-auto h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h2 className="text-xl font-semibold">Korpa je prazna</h2>
            <p className="mt-2 text-muted-foreground max-w-sm mx-auto">Korpa je prazna. Pregledajte naš katalog i pronađite nešto za sebe.</p>
            <Button asChild className="mt-6" size="lg"><Link href="/proizvodi">Pregledajte proizvode</Link></Button>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8 mt-8 items-start">
            <div className="lg:col-span-2 space-y-8">
              <CartLines
                cart={cart}
                onLocalMutationStart={onLocalMutationStart}
                onLocalMutationSettled={onLocalMutationSettled}
              />

              {cart.savedItems?.length > 0 && (
                <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
                  <div className="p-4 bg-muted/30 border-b"><h3 className="font-bold">Sačuvano za kasnije ({cart.savedItems.length})</h3></div>
                  <div className="p-4 space-y-3">
                    {cart.savedItems.map((saved) => (
                      <div key={saved.id} className="flex justify-between items-center p-3 border rounded-lg bg-background">
                        <div className="flex flex-col"><span className="font-medium">Sačuvan artikal</span><span className="text-xs text-muted-foreground">Količina: {saved.quantity}</span></div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => restoreItem.mutate({ savedItemId: saved.id })} disabled={restoreItem.isPending}>Vrati u korpu</Button>
                          <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeSaved.mutate({ savedItemId: saved.id })}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {cart.crossSellProducts?.length > 0 && (
                <div>
                  <h3 className="font-bold text-xl mb-4">Možda će vas zanimati</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {cart.crossSellProducts.map((p) => (
                      <Card key={p.id} className="overflow-hidden">
                        <div className="aspect-square bg-muted"><OptimizedImage src={p.imageUrl} alt={p.name} width={200} height={200} className="w-full h-full object-cover" /></div>
                        <CardContent className="p-3">
                          <p className="text-xs text-muted-foreground truncate">{p.brand}</p>
                          <h4 className="font-medium text-sm line-clamp-2 mt-1 h-10">{p.name}</h4>
                          <div className="mt-2 font-bold text-primary">{money(p.discountPrice ?? p.price)}</div>
                          <Button size="sm" className="w-full mt-3" variant="secondary" onClick={() => addItem.mutate({ data: { productId: p.id, quantity: 1 } })} disabled={addItem.isPending}>Dodaj u korpu</Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="lg:col-span-1">
              <div className="rounded-xl border bg-card shadow-sm sticky top-6">
                <div className="h-2 bg-primary w-full rounded-t-xl" />
                <div className="p-5 space-y-4">
                  <h3 className="font-bold text-lg mb-2">Rezime korpe</h3>
                  <div className="flex justify-between text-muted-foreground text-sm">
                    <span>Proizvodi ({cart.itemCount})</span>
                    <span>{money(cart.subtotal)}</span>
                  </div>
                  <div className="h-px bg-border/60 my-2" />
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Međuzbir</span>
                    <strong className="text-xl text-primary">{money(cart.subtotal)}</strong>
                  </div>

                  {cart.freeShippingProgress && (
                    <div className="mt-4 p-3 bg-primary/5 rounded-lg border border-primary/20">
                      {cart.freeShippingProgress.remaining === 0 ? (
                         <p className="text-sm font-medium text-emerald-600 flex items-center"><Check className="w-4 h-4 mr-1" /> Besplatna dostava!</p>
                      ) : (
                         <p className="text-sm text-muted-foreground">Još <strong className="text-primary">{money(cart.freeShippingProgress.remaining)}</strong> do besplatne dostave.</p>
                      )}
                    </div>
                  )}
                  {cart.showLoyaltyPoints && (
                    <div className="mt-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
                       <p className="text-sm text-amber-900 font-medium">Trenutno: {cart.currentLoyaltyPoints} bodova</p>
                       <p className="text-sm text-amber-700 mt-1">Nakon kupovine: {cart.projectedLoyaltyPoints} bodova</p>
                    </div>
                  )}
                  {cart.estimatedDeliveryDate && (
                    <p className="text-sm text-muted-foreground text-center mt-4">Procenjena isporuka: {new Date(cart.estimatedDeliveryDate).toLocaleDateString("sr-RS")}</p>
                  )}

                  <Button asChild size="lg" className="w-full mt-6"><Link href="/korpa/placanje">Nastavi na plaćanje</Link></Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </Layout>
  );
}

export function RetailCheckoutPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [form, setForm] = useState<Pick<RetailCheckoutInput, "firstName" | "lastName" | "email" | "phone" | "street" | "city" | "postalCode" | "note" | "paymentMethod" | "deliveryMethod">>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    street: "",
    city: "",
    postalCode: "",
    note: "",
    paymentMethod: RetailCheckoutInputPaymentMethod.BANK_TRANSFER,
    deliveryMethod: RetailCheckoutInputDeliveryMethod.courier,
  });
  const [desiredCredit, setDesiredCredit] = useState(0);
  const [idempotencyKey] = useState(() => `retail-checkout-${crypto.randomUUID()}`);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | undefined>(undefined);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [previewOverride, setPreviewOverride] = useState<RetailCheckoutPreview | null>(null);
  const [refreshingPreview, setRefreshingPreview] = useState(false);
  const [quoteRefreshMessage, setQuoteRefreshMessage] = useState<string | null>(null);
  const [quoteRefreshError, setQuoteRefreshError] = useState<string | null>(null);
  const [cartChangedElsewhere, setCartChangedElsewhere] = useState(false);
  const [unavailableItems, setUnavailableItems] = useState<UnavailableRetailItem[] | null>(null);

  const { data: cart } = useGetRetailCart();

  useEffect(() => {
    const savedCoupon = sessionStorage.getItem("lumera_retail_coupon");
    if (savedCoupon) setAppliedCoupon(savedCoupon);
  }, []);

  const previewParams = {
    deliveryMethod: form.deliveryMethod,
    city: form.city,
    desiredReferralCreditRsd: desiredCredit,
    couponCode: appliedCoupon
  } as const;
  const {
    data: queriedPreview,
    isLoading: queriedPreviewLoading,
    isError: previewIsError,
    error: previewErrorObj,
  } = usePreviewRetailCheckout(previewParams, {
    query: {
      enabled: !!cart && cart.items.length > 0,
      queryKey: ['retailCheckoutPreview', cart?.id, form.deliveryMethod, form.city, desiredCredit, appliedCoupon],
      retry: false,
    }
  });
  const preview = previewOverride ?? queriedPreview;
  const previewLoading = queriedPreviewLoading || refreshingPreview;

  useEffect(() => {
    setPreviewOverride(null);
    setQuoteRefreshMessage(null);
    setQuoteRefreshError(null);
    setCartChangedElsewhere(false);
    setUnavailableItems(null);
  }, [form.deliveryMethod, form.city, desiredCredit, appliedCoupon]);

  useEffect(() => {
    const { code, message, data } = getApiErrorDetails(previewErrorObj);
    if (previewIsError && code === "CHECKOUT_QUOTE_CHANGED" && Array.isArray(data?.unavailableItems)) {
      setUnavailableItems(data.unavailableItems.filter((item): item is UnavailableRetailItem =>
        Boolean(item && typeof item === "object" && "productId" in item && "name" in item)));
      return;
    }
    if (previewIsError && code?.startsWith("COUPON_")) {
      setCouponError(message ?? "Kupon nije moguće primeniti.");
      setAppliedCoupon(undefined);
      sessionStorage.removeItem("lumera_retail_coupon");
    }
  }, [previewIsError, previewErrorObj]);

  const checkout = useCheckoutRetailCart();
  const qc = useQueryClient();

  useEffect(() => {
    if (form.deliveryMethod === "personal_belgrade" && !/beograd/i.test(form.city)) {
      setForm((current) => ({ ...current, deliveryMethod: "courier" }));
    }
  }, [form.city, form.deliveryMethod]);

  const refreshCheckoutQuote = async (previousPreview: RetailCheckoutPreview | null) => {
    setRefreshingPreview(true);
    setPreviewOverride(null);
    setQuoteRefreshMessage(null);
    setQuoteRefreshError(null);
    setCartChangedElsewhere(false);
    setUnavailableItems(null);
    try {
      const currentCart = await getRetailCart();
      qc.setQueryData(getGetRetailCartQueryKey(), currentCart);
      if (!currentCart.items.length) return;

      const nextPreview = await previewRetailCheckout(previewParams);
      qc.setQueryData(getGetRetailCartQueryKey(), nextPreview.cart);
      setPreviewOverride(nextPreview);
      const previousShipping = previousPreview?.shipping.shippingCost;
      const previousTotal = previousPreview?.total;
      const shippingChange = previousShipping !== undefined && previousShipping !== nextPreview.shipping.shippingCost
        ? ` (prethodno ${money(previousShipping)})`
        : "";
      const totalChange = previousTotal !== undefined && previousTotal !== nextPreview.total
        ? ` (prethodno ${money(previousTotal)})`
        : "";
      setQuoteRefreshMessage(
        `Pregled je osvežen. Dostava je sada ${money(nextPreview.shipping.shippingCost)}${shippingChange}, ukupno za plaćanje ${money(nextPreview.total)}${totalChange}.`,
      );
    } catch (error) {
      const details = getApiErrorDetails(error);
      const unavailable = details.data?.unavailableItems;
      if (details.code === "CHECKOUT_QUOTE_CHANGED" && Array.isArray(unavailable)) {
        setUnavailableItems(unavailable.filter((item): item is UnavailableRetailItem =>
          Boolean(item && typeof item === "object" && "productId" in item && "name" in item)));
      } else {
        const message = details.message ?? "Pregled porudžbine nije mogao da se osveži.";
        setQuoteRefreshError(message);
        toast.error(message);
      }
    } finally {
      setRefreshingPreview(false);
    }
  };

  useEffect(() => {
    if (!cart || cartChangedElsewhere || refreshingPreview) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const latest = await getRetailCart();
        if (!active || retailCartFingerprint(latest) === retailCartFingerprint(cart)) return;
        notifyRetailCartChanged(latest.itemCount, changedRetailCartItem(
          cartLinesForChange(cart.items),
          cartLinesForChange(latest.items),
        ));
        if (!latest.items.length) {
          qc.setQueryData(getGetRetailCartQueryKey(), latest);
          setPreviewOverride(null);
        } else if (!cart.items.length) {
          qc.setQueryData(getGetRetailCartQueryKey(), latest);
          await refreshCheckoutQuote(null);
        } else {
          setCartChangedElsewhere(true);
        }
      } catch {
        // Confirmation still revalidates the cart server-side.
      } finally {
        checking = false;
      }
    };
    const interval = window.setInterval(() => { void check(); }, 4_000);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cart, cartChangedElsewhere, refreshingPreview, qc]);

  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const handleApplyCoupon = () => {
    if (!couponInput.trim()) return;
    setCouponError(null);
    const code = couponInput.trim().toUpperCase();
    setAppliedCoupon(code);
    sessionStorage.setItem("lumera_retail_coupon", code);
    setCouponInput("");
  };

  const handleRemoveCoupon = () => {
    setCouponError(null);
    setAppliedCoupon(undefined);
    sessionStorage.removeItem("lumera_retail_coupon");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!preview) return;
    checkout.mutate({
      data: {
        ...form,
        idempotencyKey,
        expectedSubtotal: preview.cart.subtotal,
        expectedShippingCost: preview.shipping.shippingCost,
        expectedTotal: preview.total,
        desiredReferralCreditRsd: desiredCredit,
        couponCode: appliedCoupon,
      } as any
    }, {
      onSuccess: (order) => {
        sessionStorage.setItem("retail-order", JSON.stringify(order));
        sessionStorage.removeItem("lumera_retail_coupon");
        qc.setQueryData(getGetRetailCartQueryKey(), null);
        notifyRetailCartChanged(0);
        setLocation(`/korpa/uspeh?order=${encodeURIComponent(order.orderNumber)}`);
      },
      onError: (error: unknown) => {
        if (getApiErrorDetails(error).code === "CHECKOUT_QUOTE_CHANGED") {
          void refreshCheckoutQuote(preview);
          return;
        }
        toast.error("Porudžbina nije potvrđena.", {
          description: getApiErrorMessage(error, "Proverite podatke i pokušajte ponovo. Uneti podaci su sačuvani."),
        });
      }
    });
  };

  const personalAvailable = /beograd/i.test(form.city);

  if (!cart || cart.items.length === 0) {
    return <Layout><main className="mx-auto min-h-screen max-w-4xl px-4 py-10"><h1 className="font-serif text-4xl font-bold">Dostava i plaćanje</h1><div className="mt-10 rounded-2xl border p-8 text-center"><ShoppingBag className="mx-auto h-10 w-10 text-muted-foreground" /><p className="mt-3">Korpa je prazna.</p><Button asChild className="mt-5"><Link href="/proizvodi">Pregledajte proizvode</Link></Button></div></main></Layout>;
  }

  if (unavailableItems) {
    const productNames = unavailableItems.map((item) => item.name);
    const unavailableHeading = productNames.length > 1 ? "Proizvodi više nisu dostupni" : "Proizvod više nije dostupan";
    const unavailableMessage = productNames.length === 0
      ? <>Jedan od proizvoda u vašoj korpi je rasprodat ili više nije aktivan. Porudžbina nije kreirana.</>
      : productNames.length === 1
        ? <>Proizvod <strong>{productNames[0]}</strong> je rasprodat ili više nije aktivan. Porudžbina nije kreirana.</>
        : <>Proizvodi <strong>{productNames.join(", ")}</strong> su rasprodati ili više nisu aktivni. Porudžbina nije kreirana.</>;
    return (
      <Layout>
        <main className="mx-auto min-h-screen max-w-2xl px-4 py-10">
          <h1 className="font-serif text-3xl font-bold sm:text-4xl">Dostava i plaćanje</h1>
          <div data-testid="unavailable-item-recovery" role="alert" aria-live="assertive" className="mt-10 rounded-2xl border border-destructive/30 bg-destructive/5 p-8">
            <h2 className="text-xl font-semibold">{unavailableHeading}</h2>
            <p className="mt-3 text-muted-foreground">{unavailableMessage}</p>
            <p className="mt-2 text-muted-foreground">Vratite se u korpu da uklonite proizvod ili nastavite sa pregledom drugih proizvoda.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="outline" asChild><Link href="/korpa">Vrati se u korpu</Link></Button>
              <Button asChild><Link href="/proizvodi">Nastavi sa kupovinom</Link></Button>
            </div>
          </div>
        </main>
      </Layout>
    );
  }

  return (
    <Layout>
      <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:py-10">
        <h1 className="mb-8 font-serif text-3xl font-bold sm:text-4xl">Dostava i plaćanje</h1>
        <form onSubmit={submit} className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-6">
            <section className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
              <h2 className="font-bold text-xl mb-4">Kontakt podaci</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {[["firstName","Ime"],["lastName","Prezime"],["email","Email"],["phone","Telefon"],["street","Adresa"],["city","Grad"],["postalCode","Poštanski broj"]].map(([key,label]) => (
                  <div key={key} className={key === "street" ? "sm:col-span-2" : ""}>
                    <Label>{label}</Label>
                    <Input required type={key === "email" ? "email" : "text"} value={(form as Record<string,string>)[key]} onChange={(e) => update(key,e.target.value)} className="mt-1" />
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <Label>Napomena za dostavu (opciono)</Label>
                <Input value={form.note} onChange={(e) => update("note", e.target.value)} className="mt-1" />
              </div>
            </section>

            <section className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
              <h2 className="font-bold text-xl mb-4">Način isporuke</h2>
              <div className="space-y-3">
                <label className="flex items-start gap-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/20 data-[checked=true]:border-primary data-[checked=true]:bg-primary/5" data-checked={form.deliveryMethod === "courier"}>
                  <input type="radio" className="mt-1" checked={form.deliveryMethod === "courier"} onChange={() => update("deliveryMethod","courier")} />
                  <div>
                    <p className="font-medium">Kurirska dostava</p>
                    <p className="text-sm text-muted-foreground">Dostava na vašu adresu na teritoriji Srbije.</p>
                  </div>
                </label>
                <label className={`flex items-start gap-3 p-4 border rounded-lg ${personalAvailable ? 'cursor-pointer hover:bg-muted/20' : 'opacity-50 cursor-not-allowed'} data-[checked=true]:border-primary data-[checked=true]:bg-primary/5`} data-checked={form.deliveryMethod === "personal_belgrade"}>
                  <input type="radio" className="mt-1" disabled={!personalAvailable} checked={form.deliveryMethod === "personal_belgrade"} onChange={() => update("deliveryMethod","personal_belgrade")} />
                  <div>
                    <p className="font-medium">Lična dostava (Samo Beograd)</p>
                    <p className="text-sm text-muted-foreground">Isporuka našim vozilom istog ili narednog dana.</p>
                    {!personalAvailable && <p className="text-xs text-amber-600 mt-1">Unesite Beograd kao grad da biste izabrali ovu opciju.</p>}
                  </div>
                </label>
              </div>
            </section>

            <section className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
              <h2 className="font-bold text-xl mb-4">Plaćanje</h2>
              <div className="space-y-3">
                {[["BANK_TRANSFER","Uplata na račun (uplatnicom)"],["CASH_ON_DELIVERY","Plaćanje pouzećem (gotovinom kuriru)"]].map(([value,label]) => (
                  <label key={value} className="flex items-center gap-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/20 data-[checked=true]:border-primary data-[checked=true]:bg-primary/5" data-checked={form.paymentMethod === value}>
                    <input type="radio" checked={form.paymentMethod === value} onChange={() => update("paymentMethod",value)} />
                    <span className="font-medium">{label}</span>
                  </label>
                ))}
              </div>
            </section>
          </div>

          <aside className="sticky top-6 h-fit min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
            <h2 className="font-bold text-xl mb-4">Pregled porudžbine</h2>

            {preview && preview.thresholdNext && (
              <div className="mb-4 bg-muted/30 p-3 rounded-lg border text-sm">
                <p className="font-medium text-foreground">
                  Fali još <strong className="text-primary">{money(preview.thresholdNext.remainingRsd)}</strong> za nagradu:
                  <span className="font-bold ml-1">
                    {preview.thresholdNext.kind === "FREE_SHIPPING" && "Besplatna dostava"}
                    {preview.thresholdNext.kind === "GIFT_PRODUCT" && "Poklon proizvod"}
                    {preview.thresholdNext.kind === "PERCENT_DISCOUNT" && "Dodatni popust"}
                  </span>
                </p>
                <div className="mt-2 h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-500 ease-out"
                    style={{ width: `${Math.min(100, (preview.thresholdQualificationSubtotalRsd / preview.thresholdNext.thresholdRsd) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <div className="space-y-3 max-h-64 overflow-y-auto pr-2 mb-6">
              {cart.items.map(item => (
                <div key={item.id} className="flex justify-between text-sm items-center">
                  <div className="flex flex-col w-2/3">
                    <span className="truncate" title={item.name}>{item.quantity}x {item.name}</span>
                  </div>
                  <span className="font-medium">{money(item.lineTotal)}</span>
                </div>
              ))}
              {preview?.rewardGifts?.map((gift, i) => (
                <div key={`gift-${i}`} className="flex justify-between text-sm items-center text-emerald-600 bg-emerald-500/10 p-2 rounded">
                  <div className="flex flex-col w-2/3">
                    <span className="truncate font-semibold flex items-center gap-1">🎁 1x {gift.productName}</span>
                  </div>
                  <span className="font-bold">Besplatno</span>
                </div>
              ))}
            </div>

            {cartChangedElsewhere && (
              <div role="alert" aria-live="assertive" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">Korpa je u međuvremenu izmenjena</p>
                <p className="mt-1 text-muted-foreground">Sadržaj korpe je promenjen. Osvežite pregled pre potvrde porudžbine.</p>
                <Button type="button" variant="outline" size="sm" className="mt-3" disabled={previewLoading} onClick={() => void refreshCheckoutQuote(preview ?? null)}>
                  Osveži pregled
                </Button>
              </div>
            )}
            {quoteRefreshMessage && (
              <div role="status" aria-live="polite" className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <p className="font-medium">Promena iznosa je osvežena</p>
                <p className="mt-1 text-muted-foreground">{quoteRefreshMessage}</p>
              </div>
            )}

            {previewLoading && !preview ? (
              <div className="py-8 flex justify-center"><Loader2 className="animate-spin h-6 w-6 text-primary" /></div>
            ) : couponError && ((previewIsError && !previewOverride) || !preview) ? (
              <div className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Unesite kupon kod"
                    value={couponInput}
                    onChange={(event) => setCouponInput(event.target.value)}
                    className="h-9 bg-background"
                  />
                  <Button type="button" variant="secondary" onClick={handleApplyCoupon} disabled={!couponInput.trim()} className="h-9">
                    Primeni
                  </Button>
                </div>
                <p className="text-xs text-destructive" role="alert">{couponError}</p>
              </div>
            ) : quoteRefreshError || (previewIsError && !previewOverride) || !preview ? (
              <div role="alert" aria-live="assertive" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                <p className="font-medium text-destructive">Pregled nije osvežen</p>
                <p className="mt-1 text-muted-foreground">
                  {quoteRefreshError ?? getApiErrorDetails(previewErrorObj).message ?? "Nije moguće izračunati troškove isporuke."}
                </p>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refreshCheckoutQuote(null)}>
                  Pokušaj ponovo
                </Button>
                <Button type="submit" className="mt-4 h-12 w-full text-lg" disabled>
                  Potvrdi porudžbinu
                </Button>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="py-2 border-y border-border/50 my-2">
                  {appliedCoupon ? (
                    <div className="flex items-center justify-between p-3 bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-200 dark:border-emerald-800/30 rounded-lg">
                      <div className="flex flex-col">
                        <span className="font-medium flex items-center gap-2 text-emerald-800 dark:text-emerald-400">
                          <Tag className="w-4 h-4" /> {appliedCoupon}
                        </span>
                        {(preview as Record<string, any>).coupon?.freeShipping && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">Besplatna dostava</span>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleRemoveCoupon}
                        disabled={previewLoading}
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
                          disabled={previewLoading}
                          className="h-9"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleApplyCoupon}
                          disabled={previewLoading || !couponInput.trim()}
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

                <div className="flex justify-between gap-4 text-muted-foreground"><span>Međuzbir robe</span><span className="shrink-0">{money(preview.merchandiseSubtotalRsd ?? preview.cart.subtotal)}</span></div>

                {preview.automaticPromotionDiscountRsd != null && preview.automaticPromotionDiscountRsd > 0 && (
                  <div className="flex justify-between text-emerald-600 font-medium"><span>X+Y popust</span><span>-{money(preview.automaticPromotionDiscountRsd)}</span></div>
                )}
                {preview.thresholdRewardDiscountRsd != null && preview.thresholdRewardDiscountRsd > 0 && (
                  <div className="flex justify-between text-emerald-600 font-medium"><span>Nivo korpe popust</span><span>-{money(preview.thresholdRewardDiscountRsd)}</span></div>
                )}
                {(preview as Record<string, any>).couponDiscountRsd != null && (preview as Record<string, any>).couponDiscountRsd > 0 && (
                  <div className="flex justify-between text-emerald-600 font-medium">
                     <span>Popust (kupon)</span>
                     <span>-{money((preview as Record<string, any>).couponDiscountRsd)}</span>
                  </div>
                )}

                {preview.referralCreditAvailableRsd != null && preview.referralCreditAvailableRsd > 0 && (
                  <div className="py-3 border-y border-border/50 my-2">
                    <div className="mb-2 text-primary font-medium">
                      <span>Kredit od preporuka (dostupno: {money(preview.referralCreditAvailableRsd)})</span>
                    </div>
                    <div className="flex min-w-0 gap-2">
                      <Input type="number" min={0} max={Math.min(preview.referralCreditAvailableRsd, (preview as any).merchandiseSubtotalRsd ?? preview.cart.subtotal)} value={desiredCredit} onChange={(e) => setDesiredCredit(Math.min(Number(e.target.value) || 0, Math.min(preview.referralCreditAvailableRsd ?? 0, (preview as any).merchandiseSubtotalRsd ?? preview.cart.subtotal)))} className="h-9 min-w-0" />
                      <Button type="button" variant="secondary" className="h-9 shrink-0" onClick={() => setDesiredCredit(Math.min(preview.referralCreditAvailableRsd ?? 0, (preview as any).merchandiseSubtotalRsd ?? preview.cart.subtotal))}>Maks</Button>
                    </div>
                    {preview.referralCreditAppliedRsd != null && preview.referralCreditAppliedRsd > 0 && (
                      <div className="flex justify-between text-emerald-600 mt-3 font-medium"><span>Primenjen kredit</span><span>-{money(preview.referralCreditAppliedRsd)}</span></div>
                    )}
                  </div>
                )}

                <div className="flex justify-between">
                  <span>Dostava</span>
                  {preview.thresholdFreeShipping ? (
                    <span className="text-emerald-600 font-bold">Besplatno</span>
                  ) : (
                    <span>{money(preview.shipping.shippingCost)}</span>
                  )}
                </div>

                <div className="flex justify-between border-t pt-4 mt-2">
                  <span className="font-bold text-lg">Ukupno za uplatu</span>
                  <strong className="text-2xl text-primary">{money(preview.total)}</strong>
                </div>

                <Button type="submit" className="w-full mt-6 h-12 text-lg" disabled={checkout.isPending || previewLoading || cartChangedElsewhere || !preview}>
                  {checkout.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                  Potvrdi porudžbinu
                </Button>
              </div>
            )}
          </aside>
        </form>
      </main>
    </Layout>
  );
}

export function RetailSuccessPage() {
  const [, setLocation] = useLocation();
  const query = new URLSearchParams(window.location.search);
  const order = query.get("order");
  const token = query.get("token");

  return (
    <Layout>
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-6">
          <Check className="h-10 w-10" />
        </div>
        <h1 className="font-serif text-4xl font-bold">Porudžbina je primljena</h1>
        <p className="mt-4 text-muted-foreground text-lg">Broj porudžbine: <strong>{order}</strong></p>
        <p className="mt-2 text-muted-foreground">Poslali smo vam email sa potvrdom i detaljima porudžbine.</p>
        <div className="mt-8 flex gap-4">
          <Button variant="outline" asChild size="lg"><Link href="/proizvodi">Nastavi kupovinu</Link></Button>
          {token && <Button onClick={() => setLocation(`/provera-statusa?token=${encodeURIComponent(token)}`)} size="lg">Prati porudžbinu</Button>}
        </div>
      </main>
    </Layout>
  );
}
