import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { useGetCurrentUser, useGetReferralDashboard, getGetReferralDashboardQueryKey } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Loader2, BookOpen, ArrowRight, Building2, CheckCircle2, GraduationCap, Gift, ChevronRight, Users, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const VERIFICATION_STATUS_LABELS: Record<string, string> = {
  pending: "Na čekanju",
  verified: "Verifikovan",
  suspended: "Obustavljen",
};

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: "Aktivna",
  pending: "Na čekanju",
  inactive: "Nije aktivirana",
  canceled: "Otkazana",
  cancelled: "Otkazana",
  expired: "Istekla",
};

export default function BusinessHub() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetCurrentUser();
  const user = data?.user;
  const [centerStatus, setCenterStatus] = useState<{ verificationStatus: string; subscriptionStatus: string | null; eligible: boolean; verificationNote: string | null } | null>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [plans, setPlans] = useState<Array<{ id: string; name: string; price: number; trialDays: number; features: string[]; limits: Record<string, number> }>>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);
  const [planMessage, setPlanMessage] = useState("");

  const { data: refDash } = useGetReferralDashboard({
    query: { enabled: user?.role === "EDUKATIVNI_CENTAR", queryKey: getGetReferralDashboardQueryKey() }
  });
  const refChannelC = refDash?.channels.find(c => c.channel === "C");
  const refChannelA = refDash?.channels.find(c => c.channel === "A");

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setLocation("/poslovna-prijava");
      return;
    }
    if (user.role === "SALON_OWNER") {
      setLocation("/vlasnik");
    } else if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      setLocation("/admin");
    } else if (user.role === "CUSTOMER") {
      setLocation("/moj-nalog");
    }
  }, [user, isLoading, setLocation]);
  useEffect(() => {
    if (user?.role !== "EDUKATIVNI_CENTAR") return;
    fetch("/api/education/center/status").then((response) => response.ok ? response.json() : []).then((centers) => setCenterStatus(centers[0] ?? null)).catch(() => setCenterStatus(null));
  }, [user?.role]);
  useEffect(() => {
    if (user?.role !== "EDUKATIVNI_CENTAR") return;
    Promise.all([
      fetch("/api/education/subscription/status").then((response) => response.ok ? response.json() : null),
      fetch("/api/education/subscription/plans").then((response) => response.ok ? response.json() : []),
    ]).then(([status, availablePlans]) => {
      setSubscription(status);
      setPlans(availablePlans);
      if (!selectedPlanId && availablePlans[0]) setSelectedPlanId(availablePlans[0].id);
    }).catch(() => setPlanMessage("Podaci o planovima trenutno nisu dostupni."));
  }, [user?.role]);

  const choosePlan = async () => {
    if (!selectedPlanId) return;
    setSavingPlan(true); setPlanMessage("");
    try {
      const response = await fetch("/api/education/subscription/select-plan", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: selectedPlanId, billingCycle: "monthly" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Plan nije moguće aktivirati.");
      setSubscription((current: any) => ({ ...(current ?? {}), subscription: body, operational: body.status === "trial" || body.status === "active" }));
      setPlanMessage(body.status === "trial" ? "Aktiviran je probni period od 30 dana." : "Plan je sačuvan. Instrukcije za uplatu su dostupne u podešavanjima.");
    } catch (error) {
      setPlanMessage(error instanceof Error ? error.message : "Plan nije moguće aktivirati.");
    } finally { setSavingPlan(false); }
  };

  if (isLoading || !user || user.role !== "EDUKATIVNI_CENTAR") {
    return (
      <BusinessLayout>
        <div className="flex-1 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </BusinessLayout>
    );
  }

  return (
    <BusinessLayout>
      <div className="bg-muted/30 pb-16 min-h-screen">
        <div className="bg-foreground text-background py-16 px-4 mb-8">
          <div className="container mx-auto max-w-6xl">
            <h1 className="text-4xl font-serif font-bold mb-4 text-white">Dobrodošli nazad, {user.firstName}.</h1>
            <p className="text-background/80 text-lg max-w-2xl font-light">
              Vaš poslovni nalog je odvojen od klijentskog marketplacea i spreman za upravljanje edukativnim sadržajem.
            </p>
          </div>
        </div>

        <div className="container mx-auto px-4 max-w-6xl -mt-12 relative z-10">
          <Card className="border-none shadow-md mb-12">
            <CardHeader>
              <CardDescription>Status poslovnog naloga i prodaje</CardDescription>
              <CardTitle className="flex items-center gap-3 text-2xl font-serif">
                <CheckCircle2 className={`h-6 w-6 ${centerStatus?.eligible ? "text-emerald-600" : "text-amber-600"}`} />
                {centerStatus?.eligible ? "Centar može da objavljuje i prodaje edukacije" : "Verifikacija ili pretplata je na čekanju"}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 text-sm">
              <div className="rounded-xl border bg-muted/20 p-4">
                <p className="text-muted-foreground mb-1">Vlasnik naloga</p>
                <p className="font-semibold">{user.firstName} {user.lastName}</p>
              </div>
              <div className="rounded-xl border bg-muted/20 p-4">
                <p className="text-muted-foreground mb-1">Kontakt</p>
                <p className="font-semibold">{user.email}</p>
              </div>
              <div className="rounded-xl border bg-muted/20 p-4">
                <p className="text-muted-foreground mb-1">Verifikacija centra</p>
                <p className="font-semibold">
                  {centerStatus?.verificationStatus
                    ? VERIFICATION_STATUS_LABELS[centerStatus.verificationStatus.toLowerCase()] ?? "Nepoznat status"
                    : "Učitavanje..."}
                </p>
              </div>
              <div className="rounded-xl border bg-muted/20 p-4">
                <p className="text-muted-foreground mb-1">Pretplata</p>
                <p className="font-semibold">
                  {centerStatus?.subscriptionStatus
                    ? SUBSCRIPTION_STATUS_LABELS[centerStatus.subscriptionStatus.toLowerCase()] ?? "Nepoznat status"
                    : "Nije aktivirana"}
                </p>
              </div>
            </CardContent>
             {centerStatus && !centerStatus.eligible ? <CardContent className="pt-0 text-sm text-muted-foreground">Kursevi ostaju sačuvani kao nacrt dok LUMERA administrator ne verifikuje centar i ne aktivira pretplatu.{centerStatus.verificationNote ? ` Napomena: ${centerStatus.verificationNote}` : ""}</CardContent> : null}
          </Card>

           {!subscription?.subscription && (
             <Card className="mb-12 border-primary/20 shadow-sm">
               <CardHeader>
                 <CardTitle className="flex items-center gap-2 font-serif"><CreditCard className="h-5 w-5 text-primary" />Izaberite plan za Education centar</CardTitle>
                 <CardDescription>Izbor plana je obavezan za rad centra. Prvi nalog dobija jedan probni period od 30 dana.</CardDescription>
               </CardHeader>
               <CardContent className="space-y-5">
                 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                   {plans.map((plan) => (
                     <label key={plan.id} className={`cursor-pointer rounded-xl border p-4 transition ${selectedPlanId === plan.id ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border"}`}>
                       <input className="sr-only" type="radio" name="education-plan" value={plan.id} checked={selectedPlanId === plan.id} onChange={() => setSelectedPlanId(plan.id)} aria-describedby={`plan-help-${plan.id}`} />
                       <span className="block font-semibold">{plan.name}</span>
                       <span className="mt-1 block text-2xl font-serif">{plan.price.toLocaleString("sr-RS")} RSD <span className="text-sm font-normal text-muted-foreground">/ mesečno</span></span>
                       <span id={`plan-help-${plan.id}`} className="mt-2 block text-sm text-muted-foreground">{plan.features?.slice(0, 3).join(" · ") || "Osnovne Education funkcije"}</span>
                     </label>
                   ))}
                 </div>
                 <Button onClick={choosePlan} disabled={!selectedPlanId || savingPlan}>{savingPlan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Sačuvaj izbor plana</Button>
                 {planMessage ? <p role="status" className="text-sm text-muted-foreground">{planMessage}</p> : null}
               </CardContent>
             </Card>
           )}

          {(refChannelC || refChannelA) && (
            <div className="grid sm:grid-cols-2 gap-4 mb-12">
              {refChannelC && (
                <Link href="/preporuke">
                  <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center justify-between hover:bg-primary/10 transition-colors cursor-pointer group">
                    <div className="flex items-center gap-4">
                      <div className="bg-primary text-primary-foreground p-3 rounded-full">
                        <Gift className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-primary">Studentske Preporuke (C)</p>
                        <p className="text-sm text-muted-foreground">{refChannelC.qualified} uspesnih, {refChannelC.pending} na čekanju</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-primary group-hover:translate-x-1 transition-transform" />
                  </div>
                </Link>
              )}
              {refChannelA && (
                <Link href="/preporuke">
                  <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 flex items-center justify-between hover:bg-accent/10 transition-colors cursor-pointer group">
                    <div className="flex items-center gap-4">
                      <div className="bg-accent text-accent-foreground p-3 rounded-full">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-accent">Preporuke Biznisa (A)</p>
                        <p className="text-sm text-muted-foreground">{refChannelA.qualified} uspesnih, {refChannelA.pending} na čekanju</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-accent group-hover:translate-x-1 transition-transform" />
                  </div>
                </Link>
              )}
            </div>
          )}

           <div className={`grid md:grid-cols-2 gap-8 mb-12 ${subscription?.operational === false ? "opacity-60" : ""}`}>
            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-serif font-bold text-foreground">Brze Akcije</h2>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                 <Button disabled={subscription?.operational === false} variant="outline" className="h-28 flex flex-col items-center justify-center gap-3 bg-card hover:bg-primary/5 hover:text-primary hover:border-primary/30 border-border shadow-sm group transition-all" asChild>
                  <Link href="/biznis/polaznici">
                    <Users className="w-7 h-7 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Polaznici</span>
                  </Link>
                </Button>
                 <Button disabled={subscription?.operational === false} variant="outline" className="h-28 flex flex-col items-center justify-center gap-3 bg-card hover:bg-primary/5 hover:text-primary hover:border-primary/30 border-border shadow-sm group transition-all" asChild>
                  <Link href="/biznis/edukacije">
                    <BookOpen className="w-7 h-7 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Katalog edukacija</span>
                  </Link>
                </Button>
                 <Button disabled={subscription?.operational === false} variant="outline" className="h-28 flex flex-col items-center justify-center gap-3 bg-card hover:bg-primary/5 hover:text-primary hover:border-primary/30 border-border shadow-sm group transition-all" asChild>
                  <Link href="/biznis/poslovi">
                    <GraduationCap className="w-7 h-7 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Poslovi u lepoti</span>
                  </Link>
                </Button>
                 <Button disabled={subscription?.operational === false} variant="outline" className="h-28 flex flex-col items-center justify-center gap-3 bg-card hover:bg-accent/10 hover:text-accent hover:border-accent/30 border-border shadow-sm group transition-all" asChild>
                  <Link href="/biznis/b2b">
                    <Building2 className="w-7 h-7 text-muted-foreground group-hover:text-accent transition-colors" />
                    <span className="font-medium">B2B nabavka</span>
                  </Link>
                </Button>
              </div>
            </div>
          </div>
          
          <div className="bg-foreground text-background rounded-3xl p-8 md:p-10 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-8 shadow-xl">
            <div className="absolute right-0 top-0 w-64 h-64 bg-accent/20 rounded-full blur-3xl translate-x-1/3 -translate-y-1/3 pointer-events-none"></div>
            <div className="absolute left-0 bottom-0 w-48 h-48 bg-primary/20 rounded-full blur-3xl -translate-x-1/3 translate-y-1/3 pointer-events-none"></div>
            
            <div className="relative z-10 max-w-xl">
              <div className="flex items-center gap-2 mb-4">
                <GraduationCap className="w-5 h-5 text-accent" />
                <span className="text-accent font-medium text-sm tracking-widest uppercase">Lumera Edukacije</span>
              </div>
              <h3 className="text-2xl md:text-3xl font-serif font-bold text-white mb-3">Predstavite svoje edukacije pravoj publici</h3>
              <p className="text-background/70 text-base leading-relaxed">
                Poslovni katalog povezuje programe, salone i edukativne centre na jednom mestu.
              </p>
            </div>
            <Button size="lg" className="relative z-10 shrink-0 bg-accent text-accent-foreground hover:bg-accent/90 shadow-lg shadow-accent/20 transition-transform hover:scale-105 h-14 px-8 text-base" asChild>
              <Link href="/biznis/edukacije">Pregledaj katalog <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </div>
    </BusinessLayout>
  );
}
