import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Gift, Award, Check, Crown, Truck, BadgeCheck, Percent } from "lucide-react";
import {
  useGetLoyaltyStatus,
  useGetCurrentUser,
  useListLoyaltyTiers,
  useGetCustomerLoyaltyPricing,
  getGetLoyaltyStatusQueryKey,
  getListLoyaltyTiersQueryKey,
  getGetCustomerLoyaltyPricingQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

export default function OwnerLoyalty() {
  const { data: userResp } = useGetCurrentUser();
  const { data: status, isLoading } = useGetLoyaltyStatus({ query: { enabled: !!userResp?.user, queryKey: getGetLoyaltyStatusQueryKey() }});
  const { data: pricingProgress } = useGetCustomerLoyaltyPricing({ query: { enabled: !!userResp?.user, queryKey: getGetCustomerLoyaltyPricingQueryKey() }});
  const { data: tiers = [] } = useListLoyaltyTiers({ query: { enabled: !!userResp?.user, queryKey: getListLoyaltyTiersQueryKey() } });

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/loyalty" />

        <div className="flex-1 space-y-6 w-full">
          <div>
            <h1 className="text-3xl font-serif font-bold">Loyalty Program</h1>
            <p className="text-muted-foreground">Nagrade za naše najbolje partnere</p>
          </div>

          {pricingProgress && (
            <Card className="bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-emerald-800 dark:text-emerald-400">
                  <Percent className="w-5 h-5" /> Nivo cena i popusti na robu
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-sm text-muted-foreground">Vaš trenutni B2B nivo popusta:</p>
                    {pricingProgress.effectiveTier ? (
                      <p className="text-2xl font-bold text-foreground mt-1">
                        {pricingProgress.effectiveTier.name} <span className="text-emerald-600">(-{pricingProgress.effectiveTier.discountPercent}%)</span>
                      </p>
                    ) : (
                      <p className="text-xl font-bold text-foreground mt-1">Osnovne cene</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Potrošnja (poslednjih 30 dana)</p>
                    <p className="text-xl font-bold text-foreground">{pricingProgress.netSettledSpendRsd.toLocaleString()} RSD</p>
                  </div>
                </div>

                {pricingProgress.nextTier && (
                  <div className="pt-4 border-t border-border/50">
                    <div className="flex justify-between text-sm mb-2">
                      <span>Sledeći nivo: <strong>{pricingProgress.nextTier.name}</strong></span>
                      <span className="text-emerald-600 font-medium">Još {(pricingProgress.nextTier.spendThresholdRsd - pricingProgress.netSettledSpendRsd).toLocaleString()} RSD</span>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${pricingProgress.nextTier.progressPercent}%` }} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {status && (
            <>
              <div className="bg-gradient-to-r from-accent/20 to-primary/10 rounded-2xl p-8 border border-accent/20">
                 <div className="flex flex-col md:flex-row items-center gap-8 text-center md:text-left">
                    <div className="w-32 h-32 rounded-full bg-accent text-accent-foreground flex items-center justify-center border-4 border-white shadow-xl shrink-0">
                       <Award className="w-16 h-16" />
                    </div>
                    <div className="flex-1">
                       <h2 className="text-4xl font-serif font-bold mb-2">{status.currentTier} Partner</h2>
                       <p className="text-lg text-foreground/80 mb-4">Vaš trud se isplati. Uživajte u ekskluzivnim benefitima.</p>
                       <div className="w-full bg-background rounded-full h-3 mb-2 shadow-inner overflow-hidden border">
                          <div className="bg-accent h-full rounded-full" style={{width: `${Math.min(100, (status.monthlySpend / status.tierThreshold) * 100)}%`}}></div>
                       </div>
                       <p className="text-sm font-medium">Potrošnja: {status.monthlySpend.toLocaleString()} / {status.tierThreshold.toLocaleString()} RSD</p>
                    </div>
                 </div>
              </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <Card>
                    <CardHeader>
                       <CardTitle className="flex items-center gap-2"><Gift className="w-5 h-5 text-primary" /> Vaši Benefiti</CardTitle>
                    </CardHeader>
                    <CardContent>
                       <ul className="space-y-3">
                          <li className="flex items-start gap-2">
                             <Check className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                             <span><strong>{status.productDiscountPercent}% popusta</strong> na celokupan asortiman B2B shopa</span>
                          </li>
                          <li className="flex items-start gap-2">
                             <Check className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                             <span><strong>{status.subscriptionDiscountPercent}% popusta</strong> na mesečnu pretplatu platforme</span>
                          </li>
                          {status.benefits.map((b,i) => (
                            <li key={i} className="flex items-start gap-2">
                               <Check className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                               <span>{b}</span>
                            </li>
                          ))}
                       </ul>
                    </CardContent>
                 </Card>

                 <Card>
                    <CardHeader>
                       <CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-accent" /> Kako do sledećeg nivoa?</CardTitle>
                    </CardHeader>
                    <CardContent>
                       <div className="text-center p-6 bg-muted/50 rounded-xl">
                          <p className="text-lg font-bold mb-2">Fali vam još</p>
                          <p className="text-3xl font-serif text-primary mb-2">{status.amountToNextTier.toLocaleString()} RSD</p>
                          <p className="text-muted-foreground mb-4">potrošnje ovog meseca da biste prešli na <span className="font-bold">{status.nextTier}</span> nivo.</p>
                          <Button variant="outline" className="w-full" asChild><a href="/vlasnik/shop">Poseti B2B Shop</a></Button>
                       </div>
                    </CardContent>
                 </Card>
              </div>
               <section className="space-y-4">
                 <div><h2 className="text-2xl font-serif font-bold">Svi loyalty nivoi</h2><p className="text-muted-foreground">Uporedite tačno šta svaki nivo donosi vašem salonu.</p></div>
                 <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
                   {tiers.map((tier) => {
                     const current = tier.name === status.currentTier;
                     const next = tier.name === status.nextTier;
                     return <Card key={tier.id} className={current ? "border-primary ring-2 ring-primary/20 shadow-md" : next ? "border-accent" : ""}>
                       <CardHeader className="pb-3"><div className="flex items-center justify-between gap-2"><CardTitle className="text-lg">{tier.name}</CardTitle>{current ? <BadgeCheck className="h-5 w-5 text-primary" /> : <Crown className="h-5 w-5 text-muted-foreground" />}</div>{current && <p className="text-xs font-semibold text-primary">VI STE OVDE</p>}{next && !current && <p className="text-xs font-semibold text-accent-foreground">SLEDEĆI CILJ</p>}</CardHeader>
                       <CardContent className="space-y-3 text-sm"><p><strong>{tier.spendThreshold.toLocaleString()} RSD</strong> potrošnje po {tier.period === "quarterly" ? "kvartalu" : "mesecu"}</p><div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-2"><span>Pretplata<br/><strong>{tier.freeSubscription ? "Besplatna" : `${tier.subscriptionDiscountPercent}% popusta`}</strong></span><span>Proizvodi<br/><strong>{tier.productDiscountPercent}% popusta</strong></span></div><p className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600" />Premium listing: <strong>{tier.premiumListing ? "Da" : "Ne"}</strong></p><p className="flex items-center gap-2"><Truck className="h-4 w-4 text-emerald-600" />Besplatna dostava: <strong>{tier.freeShipping ? "Da" : "Ne"}</strong></p><ul className="space-y-1 border-t pt-3">{tier.benefits.map((benefit) => <li key={benefit} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{benefit}</li>)}</ul></CardContent>
                     </Card>;
                   })}
                 </div>
               </section>
            </>
          )}
        </div>
      </div>
    </BusinessLayout>
  )
}