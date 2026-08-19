import { Layout } from "@/components/layout";
import { OwnerSidebar } from "./dashboard";
import { useListProducts, useGetShopSummary, useCreateOrder, useGetCurrentUser, getGetShopSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Package, Star, ArrowRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function OwnerShop() {
  const { data: userResp } = useGetCurrentUser();
  const { data: products, isLoading: isLoadingProd } = useListProducts();
  const { data: summary, isLoading: isLoadingSum } = useGetShopSummary({ query: { enabled: !!userResp?.user, queryKey: getGetShopSummaryQueryKey() }});
  
  const [cart, setCart] = useState<{id: string, qty: number}[]>([]);
  const { toast } = useToast();
  const orderMutation = useCreateOrder();

  const addToCart = (id: string) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === id);
      if (existing) return prev.map(i => i.id === id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { id, qty: 1 }];
    });
    toast.success("Dodato u korpu");
  };

  const cartTotal = cart.reduce((sum, item) => {
    const prod = products?.find(p => p.id === item.id);
    const price = prod?.discountPrice || prod?.price || 0;
    return sum + (price * item.qty);
  }, 0);

  const placeOrder = () => {
    if (cart.length === 0) return;
    orderMutation.mutate({
      data: {
        items: cart.map(c => ({ productId: c.id, quantity: c.qty })),
        shippingName: userResp?.user?.firstName + " " + userResp?.user?.lastName,
        shippingAddress: "Adresa Salona",
        paymentMethod: "CASH_ON_DELIVERY"
      }
    }, {
      onSuccess: () => {
        toast.success("Porudžbina poslata!");
        setCart([]);
      }
    });
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/shop" />
        
        <div className="flex-1 space-y-6 w-full">
          <div>
            <h1 className="text-3xl font-serif font-bold">B2B Profesionalna Oprema</h1>
            <p className="text-muted-foreground">Kupujte materijale po povlašćenim cenama za partnere</p>
          </div>

          {/* Loyalty Banner */}
          {!isLoadingSum && summary && (
            <div className="bg-primary text-primary-foreground p-6 rounded-2xl flex flex-col md:flex-row justify-between items-center gap-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-10">
                <Star className="w-32 h-32" />
              </div>
              <div className="relative z-10">
                <Badge variant="outline" className="border-primary-foreground/30 text-primary-foreground mb-3 bg-primary-foreground/10">Vaš status</Badge>
                <h2 className="text-2xl font-bold mb-1">{summary.currentTier} Nivo</h2>
                <p className="text-primary-foreground/80">Imate {summary.subscriptionDiscount}% popusta na asortiman zbog vašeg nivoa.</p>
              </div>
              <div className="relative z-10 text-right">
                <div className="text-sm text-primary-foreground/80 mb-1">Mesečna potrošnja</div>
                <div className="text-3xl font-bold">{summary.monthlySpend.toLocaleString()} RSD</div>
                {summary.amountToNextTier > 0 && (
                  <div className="text-sm mt-1 text-primary-foreground/90">Fali {summary.amountToNextTier.toLocaleString()} RSD do sledećeg nivoa</div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="lg:col-span-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {isLoadingProd ? (
                  <div className="col-span-full py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                ) : products?.map(product => (
                  <Card key={product.id} className="overflow-hidden group flex flex-col">
                    <div className="aspect-square bg-muted relative">
                      <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      {product.discountPrice && (
                        <Badge className="absolute top-2 left-2 bg-destructive hover:bg-destructive text-white border-none">Akcija</Badge>
                      )}
                    </div>
                    <CardContent className="p-4 flex-1">
                      <p className="text-xs text-muted-foreground mb-1">{product.category}</p>
                      <h3 className="font-bold leading-tight mb-2 line-clamp-2">{product.name}</h3>
                      <div className="mt-auto flex items-end justify-between">
                        <div>
                          {product.discountPrice ? (
                            <>
                              <span className="text-xs text-muted-foreground line-through block">{product.price} RSD</span>
                              <span className="font-bold text-primary">{product.discountPrice} RSD</span>
                            </>
                          ) : (
                            <span className="font-bold">{product.price} RSD</span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">/{product.unit}</span>
                      </div>
                    </CardContent>
                    <CardFooter className="p-4 pt-0">
                      <Button className="w-full gap-2" variant="secondary" onClick={() => addToCart(product.id)}>
                        <ShoppingCart className="w-4 h-4" /> Dodaj
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </div>

            {/* Cart Widget */}
            <div className="lg:col-span-1">
              <Card className="sticky top-24">
                <CardHeader className="bg-muted/30 border-b pb-4">
                  <CardTitle className="text-lg flex items-center justify-between">
                    Vaša korpa
                    <Badge variant="secondary">{cart.reduce((s,i) => s + i.qty, 0)}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 min-h-[150px]">
                  {cart.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8 flex flex-col items-center">
                      <Package className="w-8 h-8 opacity-20 mb-2" />
                      <p className="text-sm">Korpa je prazna</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {cart.map(item => {
                        const p = products?.find(prod => prod.id === item.id);
                        if(!p) return null;
                        return (
                          <div key={item.id} className="flex justify-between items-start text-sm border-b pb-2">
                            <div className="pr-2">
                              <span className="font-medium line-clamp-1">{p.name}</span>
                              <span className="text-muted-foreground">{item.qty}x</span>
                            </div>
                            <span className="font-semibold whitespace-nowrap">{(p.discountPrice || p.price) * item.qty} RSD</span>
                          </div>
                        )
                      })}
                      <div className="pt-2 flex justify-between items-center font-bold text-lg">
                        <span>Ukupno:</span>
                        <span className="text-primary">{cartTotal.toLocaleString()} RSD</span>
                      </div>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="p-4 border-t bg-muted/10">
                  <Button 
                    className="w-full" 
                    disabled={cart.length === 0 || orderMutation.isPending}
                    onClick={placeOrder}
                  >
                    {orderMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Poruči"}
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
