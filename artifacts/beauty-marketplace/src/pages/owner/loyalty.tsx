import { Layout } from "@/components/layout";
import { OwnerSidebar } from "./dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star, TrendingUp, Gift, Award, Check } from "lucide-react";
import { useGetLoyaltyStatus, useGetCurrentUser, getGetLoyaltyStatusQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";

export default function OwnerLoyalty() {
  const { data: userResp } = useGetCurrentUser();
  const { data: status, isLoading } = useGetLoyaltyStatus({ query: { enabled: !!userResp?.user, queryKey: getGetLoyaltyStatusQueryKey() }});

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/loyalty" />
        
        <div className="flex-1 space-y-6 w-full">
          <div>
            <h1 className="text-3xl font-serif font-bold">Loyalty Program</h1>
            <p className="text-muted-foreground">Nagrade za naše najbolje partnere</p>
          </div>
          
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
            </>
          )}
        </div>
      </div>
    </Layout>
  )
}