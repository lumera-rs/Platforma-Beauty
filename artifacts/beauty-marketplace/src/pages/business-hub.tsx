import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import {
  useGetCurrentUser,
  useGetReferralDashboard,
  getGetReferralDashboardQueryKey,
  useGetEducationCenterStatus,
  getGetEducationCenterStatusQueryKey,
  useGetEducationSubscriptionStatus,
  useListEducationSubscriptionPlans,
  getListEducationSubscriptionPlansQueryKey,
  useSelectEducationSubscriptionPlan,
  useUpdateEducationSubscriptionAutoRenew,
  useRequestEducationCustomPlan,
  getGetEducationSubscriptionStatusQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BusinessLayout } from "@/components/business-layout";
import { Loader2, BookOpen, ArrowRight, Building2, CheckCircle2, GraduationCap, Gift, ChevronRight, Users, CreditCard, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { EducationFieldHelp } from "@/components/education/education-field-help";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { srLatn } from "date-fns/locale";
import { educationPlanChangeSelection } from "@/lib/education-plan-change";

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
  trial: "Probni period",
  past_due: "Čeka uplatu",
  suspended: "Obustavljena",
  free_via_loyalty: "Aktivna kroz pogodnost",
};

export default function BusinessHub() {
  const [, setLocation] = useLocation();
  const { data: userResp, isLoading: userLoading } = useGetCurrentUser();
  const user = userResp?.user;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: centerStatusData, isLoading: centerLoading } = useGetEducationCenterStatus({ query: { enabled: user?.role === "EDUKATIVNI_CENTAR", queryKey: getGetEducationCenterStatusQueryKey() } });
  const centerStatus = centerStatusData?.[0] ?? null;

  const { data: subStatus, isLoading: subLoading } = useGetEducationSubscriptionStatus({ query: { enabled: user?.role === "EDUKATIVNI_CENTAR", queryKey: getGetEducationSubscriptionStatusQueryKey() } });
  const { data: plans = [], isLoading: plansLoading } = useListEducationSubscriptionPlans({ query: { enabled: user?.role === "EDUKATIVNI_CENTAR", queryKey: getListEducationSubscriptionPlansQueryKey() } });

  const selectPlanMut = useSelectEducationSubscriptionPlan();
  const autoRenewMut = useUpdateEducationSubscriptionAutoRenew();
  const requestCustomMut = useRequestEducationCustomPlan();

  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");

  // Custom request state
  const [customRequestOpen, setCustomRequestOpen] = useState(false);
  const [customCourseLimit, setCustomCourseLimit] = useState("");
  const [customMessage, setCustomMessage] = useState("");

  // Downgrade selection state
  const [downgradeOpen, setDowngradeOpen] = useState(false);
  const [targetDowngradeLimit, setTargetDowngradeLimit] = useState(0);
  const [targetKeepCount, setTargetKeepCount] = useState(0);
  const [selectedKeepIds, setSelectedKeepIds] = useState<string[]>([]);
  const [pendingSelectionArgs, setPendingSelectionArgs] = useState<{ planId: string, billingCycle: "monthly" | "yearly" } | null>(null);

  const { data: refDash } = useGetReferralDashboard({
    query: { enabled: user?.role === "EDUKATIVNI_CENTAR", queryKey: getGetReferralDashboardQueryKey() }
  });
  const refChannelC = refDash?.channels.find(c => c.channel === "C");
  const refChannelA = refDash?.channels.find(c => c.channel === "A");

  useEffect(() => {
    if (userLoading) return;
    if (!user) { setLocation("/poslovna-prijava"); return; }
    if (user.role === "SALON_OWNER") setLocation("/vlasnik");
    else if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") setLocation("/admin");
    else if (user.role === "CUSTOMER") setLocation("/moj-nalog");
  }, [user, userLoading, setLocation]);

  useEffect(() => {
    if (plans.length > 0 && !selectedPlanId) {
      // Default to current plan if active, else first plan
      const currentPlan = subStatus?.subscription?.planId;
      setSelectedPlanId(currentPlan || plans[0].id);
    }
  }, [plans, subStatus, selectedPlanId]);

  if (userLoading || centerLoading || subLoading || plansLoading || !user || user.role !== "EDUKATIVNI_CENTAR") {
    return (
      <BusinessLayout>
        <div className="flex-1 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </BusinessLayout>
    );
  }

  const handlePlanSelect = () => {
    if (!selectedPlanId) return;
    const plan = plans.find(p => p.id === selectedPlanId);
    if (!plan) return;

    const published = subStatus?.publishedCourses || [];
    const selection = educationPlanChangeSelection({
      currentCourseLimit: subStatus?.subscription?.currentCourseLimitSnapshot
        ?? subStatus?.subscription?.plan.courseLimit,
      targetCourseLimit: plan.courseLimit,
      publishedCourseCount: published.length,
    });

    if (selection.requiresSelection) {
      setTargetDowngradeLimit(plan.courseLimit);
      setTargetKeepCount(selection.requiredKeepCount);
      setPendingSelectionArgs({ planId: selectedPlanId, billingCycle });
      setSelectedKeepIds([]);
      setDowngradeOpen(true);
      return;
    }

    // Direct selection
    selectPlanMut.mutate({ data: { planId: selectedPlanId, billingCycle } }, {
      onSuccess: () => {
        toast.success("Plan je izabran. Instrukcije su spremne.");
        queryClient.invalidateQueries({ queryKey: getGetEducationSubscriptionStatusQueryKey() });
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  const submitDowngrade = () => {
    if (!pendingSelectionArgs) return;
    if (selectedKeepIds.length !== targetKeepCount) {
      toast.error(`Morate izabrati tačno ${targetKeepCount} kurseva.`);
      return;
    }

    selectPlanMut.mutate({ data: { ...pendingSelectionArgs, keepCourseIds: selectedKeepIds } }, {
      onSuccess: () => {
        toast.success("Plan je izabran. Promena će stupiti na snagu po isteku tekućeg perioda.");
        queryClient.invalidateQueries({ queryKey: getGetEducationSubscriptionStatusQueryKey() });
        setDowngradeOpen(false);
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  const handleCustomRequest = () => {
    const limit = Number(customCourseLimit);
    if (!limit || limit < 1) { toast.error("Unesite validan broj kurseva."); return; }
    if (customMessage.trim().length < 10) { toast.error("Unesite poruku od barem 10 karaktera."); return; }

    requestCustomMut.mutate({ data: { requestedCourseLimit: limit, message: customMessage } }, {
      onSuccess: () => {
        toast.success("Zahtev poslat", { description: "LUMERA tim će vas kontaktirati ubrzo." });
        setCustomRequestOpen(false);
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  const toggleAutoRenew = (enabled: boolean) => {
    autoRenewMut.mutate({ data: { autoRenew: enabled } }, {
      onSuccess: () => {
        toast.success(enabled ? "Automatsko obnavljanje je uključeno." : "Automatsko obnavljanje je isključeno.");
        queryClient.invalidateQueries({ queryKey: getGetEducationSubscriptionStatusQueryKey() });
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  const toggleKeepCourse = (id: string, checked: boolean) => {
    if (checked) {
      if (selectedKeepIds.length >= targetKeepCount) return;
      setSelectedKeepIds(prev => [...prev, id]);
    } else {
      setSelectedKeepIds(prev => prev.filter(x => x !== id));
    }
  };

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
          <Card className="border-none shadow-md mb-8">
            <CardHeader>
              <CardDescription>Status poslovnog naloga i prodaje</CardDescription>
              <CardTitle className="flex items-center gap-3 text-2xl font-serif">
                <CheckCircle2 className={`h-6 w-6 ${centerStatus?.eligible ? "text-emerald-600" : "text-amber-600"}`} />
                {centerStatus?.eligible ? "Centar može da objavljuje i prodaje edukacije" : "Verifikacija ili pretplata je na čekanju"}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 text-sm">
              <div className="rounded-xl border bg-muted/20 p-4">
                <p className="text-muted-foreground mb-1">Kontakt</p>
                <p className="font-semibold truncate">{user.email}</p>
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
                  {subStatus?.subscription?.status
                    ? SUBSCRIPTION_STATUS_LABELS[subStatus.subscription.status.toLowerCase()] ?? "Nepoznat status"
                    : "Nije aktivirana"}
                </p>
              </div>
              <div className="rounded-xl border bg-primary/5 p-4 relative overflow-hidden group">
                 <div className="absolute inset-0 bg-primary/5 translate-y-[100%] group-hover:translate-y-0 transition-transform"></div>
                 <div className="relative">
                   <p className="text-muted-foreground mb-1">Trenutni plan</p>
                   <p className="font-semibold text-primary">
                     {subStatus?.subscription?.planId ? (plans.find(p => p.id === subStatus.subscription!.planId)?.name || "Nepoznat") : "Nema"}
                   </p>
                 </div>
              </div>
            </CardContent>
             {centerStatus && !centerStatus.eligible && (
               <CardContent className="pt-0 text-sm text-muted-foreground">
                 Kursevi ostaju sačuvani kao nacrt dok LUMERA administrator ne verifikuje centar i ne aktivira pretplatu.{centerStatus.verificationNote ? ` Napomena: ${centerStatus.verificationNote}` : ""}
               </CardContent>
             )}
          </Card>

          {subStatus?.subscription && subStatus.subscription.status !== 'trial' && (
            <Card className="mb-8 shadow-sm">
              <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <RefreshCw className="w-5 h-5 text-primary" /> Automatsko obnavljanje
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                    Kada je isključeno, po isteku plaćenog perioda usluga se pauzira. Isključivanje ne kreira povraćaj novca za već plaćeni period. Trenutni period važi do {subStatus.subscription.currentPeriodEnd ? format(new Date(subStatus.subscription.currentPeriodEnd), "dd.MM.yyyy.", { locale: srLatn }) : "nepoznato"}.
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Switch
                    checked={subStatus.subscription.autoRenew}
                    onCheckedChange={toggleAutoRenew}
                    disabled={autoRenewMut.isPending}
                  />
                  <span className="font-medium">{subStatus.subscription.autoRenew ? "Uključeno" : "Isključeno"}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {subStatus?.subscription?.pendingPlanEffectiveAt && (
             <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-amber-900">
               <RefreshCw className="w-5 h-5 shrink-0 mt-0.5" />
               <div>
                 <h4 className="font-semibold">Promena plana u pripremi</h4>
                 <p className="text-sm mt-1">Vaš plan će biti promenjen dana {format(new Date(subStatus.subscription.pendingPlanEffectiveAt), "dd.MM.yyyy.", { locale: srLatn })}.</p>
               </div>
             </div>
          )}

          <Card className="mb-12 border-primary/20 shadow-sm">
             <CardHeader>
                <CardTitle className="flex items-center gap-2 font-serif">
                  <CreditCard className="h-5 w-5 text-primary" />
                  {subStatus?.subscription ? "Promenite Education plan" : "Izaberite plan za Education centar"}
                </CardTitle>
                <CardDescription>
                  Niži plan se primenjuje po isteku tekućeg perioda. Viši plan zahteva proporcionalnu doplatu za preostali period.
                  Sve cene su sa uključenim PDV-om ukoliko je naznačeno.
                </CardDescription>
             </CardHeader>
             <CardContent className="space-y-6">
               <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                 {plans.map((plan) => (
                   <label key={plan.id} className={`relative flex flex-col cursor-pointer rounded-2xl border-2 p-5 transition-all ${selectedPlanId === plan.id ? "border-primary bg-primary/5 shadow-md scale-[1.02]" : "border-border hover:border-primary/30"}`}>
                     <input className="sr-only" type="radio" name="education-plan" value={plan.id} checked={selectedPlanId === plan.id} onChange={() => setSelectedPlanId(plan.id)} />

                     <div className="flex justify-between items-start mb-2">
                       <span className="font-bold text-lg">{plan.name}</span>
                       {subStatus?.subscription?.planId === plan.id && <span className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded-full font-medium">Trenutni</span>}
                     </div>

                     <div className="mt-2 mb-4">
                       <span className="text-3xl font-serif font-bold">{plan.price.toLocaleString("sr-RS")}</span>
                       <span className="text-sm font-normal text-muted-foreground ml-1">RSD / {plan.priceCopy || "mesečno"}</span>
                       <p className="text-xs text-muted-foreground mt-1">{plan.vatIncluded ? "PDV uključen" : "PDV nije uključen"}</p>
                     </div>

                     <div className="text-sm text-foreground space-y-2 mt-auto">
                       <div className="flex items-center gap-2 bg-background p-2 rounded-md border">
                         <BookOpen className="w-4 h-4 text-primary" />
                         <span className="font-medium">{plan.courseLimit} kurseva</span>
                       </div>
                       {plan.features?.slice(0, 3).map((f, i) => (
                         <div key={i} className="flex items-start gap-2 text-muted-foreground">
                           <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                           <span className="text-xs">{f}</span>
                         </div>
                       ))}
                     </div>
                   </label>
                 ))}
               </div>

               <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 p-5 bg-muted/20 rounded-xl border border-border">
                 <div className="space-y-4 max-w-sm">
                   <label className="block space-y-2 text-sm font-medium">
                     <span className="flex items-center gap-2">Ciklus naplate <EducationFieldHelp id="business-hub-billing-cycle-help" label="Ciklus naplate" text="Mesečni ciklus se obnavlja svakog meseca. Godišnji ciklus unapred obračunava dvanaest meseci uz popust." /></span>
                     <select
                       aria-describedby="business-hub-billing-cycle-help"
                       className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2"
                       value={billingCycle}
                       onChange={(event) => setBillingCycle(event.target.value as "monthly" | "yearly")}
                     >
                       <option value="monthly">Mesečno</option>
                       <option value="yearly">Godišnje</option>
                     </select>
                   </label>
                 </div>

                 <div className="flex flex-col gap-2 sm:items-end">
                   <Button size="lg" onClick={handlePlanSelect} disabled={!selectedPlanId || selectPlanMut.isPending} className="w-full sm:w-auto px-8">
                     {selectPlanMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                     Sačuvaj izbor plana
                   </Button>
                   <Button variant="link" size="sm" onClick={() => setCustomRequestOpen(true)} className="text-muted-foreground hover:text-primary">
                     Trebaju vam prilagođeni uslovi? Zatražite dogovor.
                   </Button>
                 </div>
               </div>
             </CardContent>
           </Card>

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

           <div className={`grid md:grid-cols-2 gap-8 mb-12 ${subStatus?.operational === false ? "opacity-60" : ""}`}>
            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-serif font-bold text-foreground">Brze Akcije</h2>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                 <Button disabled={subStatus?.operational === false} variant="outline" className="h-28 flex flex-col items-center justify-center gap-3 bg-card hover:bg-primary/5 hover:text-primary hover:border-primary/30 border-border shadow-sm group transition-all" asChild>
                  <Link href="/biznis/polaznici">
                    <Users className="w-7 h-7 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Polaznici</span>
                  </Link>
                </Button>
                 <Button disabled={subStatus?.operational === false} variant="outline" className="h-28 flex flex-col items-center justify-center gap-3 bg-card hover:bg-primary/5 hover:text-primary hover:border-primary/30 border-border shadow-sm group transition-all" asChild>
                  <Link href="/biznis/edukacije">
                    <BookOpen className="w-7 h-7 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Katalog edukacija</span>
                  </Link>
                </Button>
                 <Button disabled={subStatus?.operational === false} variant="outline" className="h-28 flex flex-col items-center justify-center gap-3 bg-card hover:bg-primary/5 hover:text-primary hover:border-primary/30 border-border shadow-sm group transition-all" asChild>
                  <Link href="/biznis/poslovi">
                    <GraduationCap className="w-7 h-7 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Poslovi u lepoti</span>
                  </Link>
                </Button>
                 <Button disabled={subStatus?.operational === false} variant="outline" className="h-28 flex flex-col items-center justify-center gap-3 bg-card hover:bg-accent/10 hover:text-accent hover:border-accent/30 border-border shadow-sm group transition-all" asChild>
                  <Link href="/biznis/b2b">
                    <Building2 className="w-7 h-7 text-muted-foreground group-hover:text-accent transition-colors" />
                    <span className="font-medium">B2B nabavka</span>
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Downgrade Limit Dialog */}
      <Dialog open={downgradeOpen} onOpenChange={setDowngradeOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Prekoračenje ograničenja novog plana</DialogTitle>
            <DialogDescription>
              Novi plan smanjuje limit na <strong>{targetDowngradeLimit}</strong> objavljenih kurseva. Trenutno imate <strong>{subStatus?.publishedCourses?.length}</strong>.
              Izaberite tačno {targetKeepCount} kurseva koje želite da zadržite. Ostali kursevi će preći u nacrt (neće biti obrisani, ali više neće biti javno vidljivi ni dostupni za kupovinu).
              Trenutni polaznici neće izgubiti pristup materijalima.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4 max-h-[300px] overflow-y-auto">
            <div className="sticky top-0 bg-background pb-2 text-sm font-medium flex justify-between">
              <span>Izabrano: {selectedKeepIds.length} / {targetKeepCount}</span>
              {selectedKeepIds.length === targetKeepCount && <span className="text-emerald-600">Spremno</span>}
            </div>
            {subStatus?.publishedCourses?.map(c => (
              <div key={c.id} className="flex items-center space-x-3 bg-card p-3 rounded-lg border">
                <Checkbox
                  id={`keep-${c.id}`}
                  checked={selectedKeepIds.includes(c.id)}
                  onCheckedChange={(checked) => toggleKeepCourse(c.id, checked === true)}
                  disabled={!selectedKeepIds.includes(c.id) && selectedKeepIds.length >= targetKeepCount}
                />
                <label htmlFor={`keep-${c.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                  {c.title}
                </label>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDowngradeOpen(false)}>Odustani</Button>
            <Button onClick={submitDowngrade} disabled={selectedKeepIds.length !== targetKeepCount || selectPlanMut.isPending}>
              {selectPlanMut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Potvrdi promenu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Plan Request Dialog */}
      <Dialog open={customRequestOpen} onOpenChange={setCustomRequestOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Zahtev za prilagođeni ugovor</DialogTitle>
            <DialogDescription>
              Ako standardni planovi ne ispunjavaju vaše potrebe, zatražite prilagođeni ugovor po dogovoru.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Potreban broj kurseva</Label>
              <Input type="number" min="1" value={customCourseLimit} onChange={e => setCustomCourseLimit(e.target.value)} placeholder="Npr. 50" />
            </div>
            <div className="space-y-2">
              <Label>Dodatne informacije</Label>
              <Textarea value={customMessage} onChange={e => setCustomMessage(e.target.value)} placeholder="Opišite vaše potrebe..." rows={4} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomRequestOpen(false)}>Odustani</Button>
            <Button onClick={handleCustomRequest} disabled={requestCustomMut.isPending}>
              {requestCustomMut.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Pošalji zahtev
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BusinessLayout>
  );
}
