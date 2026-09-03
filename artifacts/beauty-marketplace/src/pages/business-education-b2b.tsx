import React, { useState } from "react";
import { 
  useGetEducationB2bBenefit, 
  useQuoteEducationB2bOrder, 
  useCheckoutEducationB2bOrder,
  useListEducationB2bProducts 
} from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, DollarSign, Gift, ArrowRight, Percent, Info, ShoppingCart, CheckCircle, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

export default function BusinessEducationB2b() {
  const { data: benefit, isLoading: isBenefitLoading } = useGetEducationB2bBenefit();
  const { data: productsData, isLoading: isProductsLoading } = useListEducationB2bProducts();
  
  const quoteMut = useQuoteEducationB2bOrder();
  // Stable per-checkout-attempt key: a retry of the same logical checkout
  // (e.g. a network timeout) reuses this key, so the server-side idempotency
  // guard recognizes it as a replay rather than a second order. It only
  // rotates once the attempt actually succeeds (see handleCheckout's
  // onSuccess below), so a genuinely new, later checkout gets a fresh key.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const checkoutMut = useCheckoutEducationB2bOrder({ request: { headers: { "Idempotency-Key": idempotencyKey } } });
  const { toast } = useToast();

  const [cart, setCart] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<any>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [orderConfirmed, setOrderConfirmed] = useState(false);

  const formatMoney = (val: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(val);

  const products = productsData?.products || [];

  const addToCart = (productId: string) => {
    setCart(prev => ({ ...prev, [productId]: (prev[productId] || 0) + 1 }));
    setQuote(null);
  };
  
  const removeFromCart = (productId: string) => {
    setCart(prev => {
      const copy = { ...prev };
      if (copy[productId] > 1) {
        copy[productId]--;
      } else {
        delete copy[productId];
      }
      return copy;
    });
    setQuote(null);
  };

  const cartItemsCount = Object.values(cart).reduce((a, b) => a + b, 0);

  const handleQuote = () => {
    if (cartItemsCount === 0) return;
    
    setIsQuoting(true);
    const lines = Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity }));
    
    quoteMut.mutate({ data: { lines } }, {
      onSuccess: (data) => {
        setQuote(data);
        setIsQuoting(false);
        toast.success("Ponuda generisana");
      },
      onError: () => {
        toast.error("Greška pri generisanju ponude");
        setIsQuoting(false);
      }
    });
  };

  const handleCheckout = () => {
    if (!quote) return;
    
    const lines = Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity }));
    
    checkoutMut.mutate({ 
      data: { 
        lines,
        expectedTotalRsd: quote.payableTotalRsd
      } 
    }, {
      onSuccess: () => {
        setOrderConfirmed(true);
        setCart({});
        setQuote(null);
        // This logical checkout attempt is done; the next one (a new cart)
        // must get its own key so it isn't treated as a replay of this one.
        setIdempotencyKey(crypto.randomUUID());
        toast.success("Porudžbina uspešna");
      },
      onError: () => {
        toast.error("Greška pri poručivanju");
      }
    });
  };

  if (isBenefitLoading || isProductsLoading) {
    return <BusinessLayout><div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div></BusinessLayout>;
  }

  const percent = benefit?.discountPercent || 0;
  const spend = benefit?.priorMonthSpendRsd || 0;
  const nextTier = benefit?.amountToNextTierRsd || 0;

  return (
    <BusinessLayout>
      <TooltipProvider>
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <div className="mb-8">
            <h1 className="text-3xl font-serif font-bold text-foreground">B2B pogodnosti</h1>
            <p className="text-muted-foreground mt-1">Pregled vašeg B2B statusa za nabavku materijala i opreme</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <Card className="bg-primary/5 border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Percent className="w-4 h-4 text-primary" />
                  Trenutni B2B Popust
                  <Tooltip><TooltipTrigger><Info className="w-3.5 h-3.5" /></TooltipTrigger><TooltipContent>Popust koji se automatski primenjuje na vaše porudžbine ovog meseca</TooltipContent></Tooltip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold text-primary">{percent}%</div>
                {benefit?.discountReason && <p className="text-sm text-muted-foreground mt-1">{benefit.discountReason}</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-500" />
                  Potrošnja (Prethodni mesec)
                  <Tooltip><TooltipTrigger><Info className="w-3.5 h-3.5" /></TooltipTrigger><TooltipContent>Ukupan iznos vaših porudžbina u prethodnom kalendarskom mesecu</TooltipContent></Tooltip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatMoney(spend)}</div>
                <p className="text-sm text-muted-foreground mt-1 text-emerald-600 font-medium">Kvalifikovano za trenutni popust</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Gift className="w-4 h-4 text-accent" />
                  Do sledećeg nivoa
                  <Tooltip><TooltipTrigger><Info className="w-3.5 h-3.5" /></TooltipTrigger><TooltipContent>Iznos koji vam nedostaje za veći procenat popusta</TooltipContent></Tooltip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-accent">{nextTier > 0 ? formatMoney(nextTier) : "Maksimalan nivo"}</div>
                {nextTier > 0 && <p className="text-sm text-muted-foreground mt-1">za veći B2B popust sledećeg meseca</p>}
              </CardContent>
            </Card>
          </div>

          {orderConfirmed && (
            <Card className="mb-8 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900 rounded-full flex items-center justify-center shrink-0">
                  <CheckCircle className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-emerald-800 dark:text-emerald-400">Porudžbina je uspešno potvrđena!</h3>
                  <p className="text-sm text-emerald-700 dark:text-emerald-500 mt-1">Vaš materijal će biti dostavljen u najkraćem roku.</p>
                </div>
                <Button variant="outline" className="ml-auto" onClick={() => setOrderConfirmed(false)}>Zatvori</Button>
              </CardContent>
            </Card>
          )}

          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <h2 className="text-xl font-bold font-serif flex items-center gap-2">
                <Package className="w-5 h-5" /> B2B Katalog materijala
              </h2>
              {products.length === 0 ? (
                <div className="text-center py-12 bg-muted/30 rounded-xl border border-dashed">
                  <p className="text-muted-foreground">Trenutno nema dostupnih proizvoda u katalogu.</p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  {products.map(product => (
                    <Card key={product.id}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">{product.name}</CardTitle>
                        <CardDescription className="line-clamp-2">{product.description}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="text-lg font-bold text-primary mb-1">{formatMoney(product.priceRsd)}</div>
                        <div className="text-sm text-muted-foreground mb-4">Dostupno na stanju: {product.stock}</div>
                      </CardContent>
                      <CardFooter>
                        {product.stock > 0 ? (
                          <div className="flex items-center gap-2 w-full">
                            <Button 
                              variant="outline" 
                              size="icon" 
                              onClick={() => removeFromCart(product.id)}
                              disabled={!cart[product.id]}
                            >
                              -
                            </Button>
                            <span className="flex-1 text-center font-medium">{cart[product.id] || 0}</span>
                            <Button 
                              variant="outline" 
                              size="icon" 
                              onClick={() => addToCart(product.id)}
                              disabled={(cart[product.id] || 0) >= product.stock}
                            >
                              +
                            </Button>
                          </div>
                        ) : (
                          <Button disabled variant="outline" className="w-full">Nema na stanju</Button>
                        )}
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Card className="sticky top-6">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Korpa</span>
                    <span className="bg-primary text-primary-foreground text-xs px-2 py-1 rounded-full">{cartItemsCount}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {cartItemsCount === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">
                      <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-20" />
                      Korpa je prazna
                    </div>
                  ) : (
                    <>
                      {Object.entries(cart).map(([productId, quantity]) => {
                        const product = products.find(p => p.id === productId);
                        if (!product) return null;
                        return (
                          <div key={productId} className="flex justify-between items-center text-sm">
                            <span className="font-medium">{quantity}x {product.name}</span>
                            <span>{formatMoney(product.priceRsd * quantity)}</span>
                          </div>
                        );
                      })}
                      
                      <Separator className="my-2" />
                      
                      {quote ? (
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Međuzbir:</span>
                            <span>{formatMoney(quote.subtotalRsd)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-medium text-emerald-600">
                            <span>Popust centra ({quote.benefit?.discountPercent || percent}%):</span>
                            <span>-{formatMoney(quote.educationCenterDiscountRsd)}</span>
                          </div>
                          <Separator className="my-2" />
                          <div className="flex justify-between text-lg font-bold text-primary">
                            <span>Ukupno:</span>
                            <span>{formatMoney(quote.payableTotalRsd)}</span>
                          </div>
                          <Button 
                            className="w-full mt-4" 
                            size="lg"
                            onClick={handleCheckout}
                            disabled={checkoutMut.isPending}
                          >
                            {checkoutMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                            Potvrdi porudžbinu
                          </Button>
                        </div>
                      ) : (
                        <Button 
                          className="w-full" 
                          variant="secondary"
                          onClick={handleQuote}
                          disabled={isQuoting}
                        >
                          {isQuoting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Zatraži obračun"}
                        </Button>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </TooltipProvider>
    </BusinessLayout>
  );
}
