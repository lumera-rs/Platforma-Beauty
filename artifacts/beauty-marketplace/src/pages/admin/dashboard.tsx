import { AdminLayout } from "./layout";
import { Link } from "wouter";
import { useGetAdminSummary, useAdminGetGrowthSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Users, Store, Calendar, TrendingUp, DollarSign, AlertCircle, ShieldCheck, Loader2, Zap, MessageSquare, Briefcase, Plus, Activity } from "lucide-react";

const DELIVERY_REPORT_PROVIDER_LABELS: Record<string, string> = {
  brevo: "Brevo (e-mail)",
  infobip: "Infobip (SMS)",
};

function formatCleanupTicketAge(ageMinutes: number | null): string {
  if (ageMinutes === null) return "Nema";
  if (ageMinutes < 60) return `${ageMinutes} min`;
  const hours = Math.floor(ageMinutes / 60);
  const minutes = ageMinutes % 60;
  if (hours < 24) return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} dan${days === 1 ? "" : "a"}`;
}

export default function AdminDashboard() {
  const { data: summary, isLoading, error } = useGetAdminSummary();
  const { data: growth, isLoading: isLoadingGrowth } = useAdminGetGrowthSummary();

  if (isLoading || isLoadingGrowth) return <AdminLayout><div className="flex justify-center p-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></AdminLayout>;
  if (error || !summary) return <AdminLayout><div className="p-10 text-destructive bg-destructive/10 rounded-xl text-center border border-destructive/20 font-medium">Došlo je do greške pri učitavanju pregleda platforme.</div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold mb-2 text-foreground">Pregled Platforme</h1>
          <p className="text-muted-foreground">Analitika, metrika i trenutni status LUMERA sistema.</p>
        </div>

        {summary.deliveryReportStaleProviders.length > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="delivery-report-alert">
            <strong>Potrebna je intervencija.</strong> Izveštaji o isporuci ne stižu za:{" "}
            {summary.deliveryReportStaleProviders.map((provider) => DELIVERY_REPORT_PROVIDER_LABELS[provider] ?? provider).join(", ")}.
            {" "}Automatske poruke se šalju, ali provajder ne javlja status isporuke — webhook je verovatno neispravan ili isključen.{" "}
            <Link href="/admin/integracije" className="font-medium underline underline-offset-2" data-testid="delivery-report-alert-link">
              Proverite webhook podešavanja u sekciji Integracije
            </Link>.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex justify-between items-start mb-2">
                <p className="text-sm font-medium text-muted-foreground">Korisnici</p>
                <Users className="w-4 h-4 text-muted-foreground" />
              </div>
              <h3 className="text-2xl font-bold text-foreground" data-testid="summary-total-users">{summary.totalUsers.toLocaleString()}</h3>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex justify-between items-start mb-2">
                <p className="text-sm font-medium text-muted-foreground">Aktivni Saloni</p>
                <Store className="w-4 h-4 text-muted-foreground" />
              </div>
              <h3 className="text-2xl font-bold text-foreground" data-testid="summary-active-salons">
                {summary.activeSalons} <span className="text-sm font-normal text-muted-foreground">od {summary.totalSalons}</span>
              </h3>
              <p className="text-xs mt-2 text-muted-foreground">
                Novi ovog meseca: <strong className="text-foreground">{summary.newSalonsThisMonth}</strong>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex justify-between items-start mb-2">
                <p className="text-sm font-medium text-muted-foreground">GMV (Promet)</p>
                <DollarSign className="w-4 h-4 text-muted-foreground" />
              </div>
              <h3 className="text-2xl font-bold text-foreground" data-testid="summary-gmv">{summary.grossMerchandiseValue.toLocaleString()} RSD</h3>
            </CardContent>
          </Card>

          <Card className="bg-primary/5 border-primary/20 shadow-sm">
            <CardContent className="p-6">
              <div className="flex justify-between items-start mb-2">
                <p className="text-sm font-medium text-primary">Aktivne Pretplate</p>
                <ShieldCheck className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-2xl font-bold text-primary" data-testid="summary-subscriptions">{summary.activeSubscriptions}</h3>
            </CardContent>
          </Card>
        </div>

        {growth && (
          <div className="space-y-4">
            <h2 className="text-xl font-serif font-bold text-foreground">Aktivnost novih modula</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                    <span>Automatizacije (Kampanje)</span>
                    <MessageSquare className="w-4 h-4" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{growth.automation.activeRules}</div>
                  <p className="text-xs text-muted-foreground mt-1">Aktivnih pravila</p>
                  <div className="mt-4 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>Ukupno pravila</span>
                      <span className="font-bold">{growth.automation.totalRules}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                    <span>Paketi Tretmana</span>
                    <Briefcase className="w-4 h-4" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{growth.packages.active}</div>
                  <p className="text-xs text-muted-foreground mt-1">Aktivnih paketa</p>
                  <div className="mt-4 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>Ukupno paketa</span>
                      <span className="font-bold">{growth.packages.total}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
                    <span>Kupovine Paketa</span>
                    <Activity className="w-4 h-4" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{growth.purchases.active}</div>
                  <p className="text-xs text-muted-foreground mt-1">Aktivnih kupovina</p>
                  <div className="mt-4 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span>Ukupno kupovina</span>
                      <span className="font-bold text-primary">{growth.purchases.total}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Na čekanju za uplatu</span>
                      <span className="font-bold text-amber-600">{growth.purchases.pendingPayment}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2 border-b border-border/50 bg-muted/30">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="w-5 h-5 text-muted-foreground" />
                Rezervacije
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-sm text-muted-foreground">Ovaj mesec</p>
                  <p className="text-4xl font-bold mt-1 text-foreground" data-testid="summary-bookings-this-month">{summary.bookingsThisMonth.toLocaleString()}</p>
                </div>
                <div className="text-right border-l pl-4 border-border/50">
                  <p className="text-sm text-muted-foreground">Prošli mesec</p>
                  <p className="text-xl font-semibold mt-1 text-muted-foreground" data-testid="summary-bookings-last-month">{summary.bookingsLastMonth.toLocaleString()}</p>
                </div>
              </div>
              <div className={`mt-6 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${summary.bookingsTrend >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30' : 'bg-red-50 text-red-700 dark:bg-red-950/30'}`}>
                <TrendingUp className={`w-4 h-4 ${summary.bookingsTrend < 0 ? 'rotate-180' : ''}`} />
                {summary.bookingsTrend >= 0 ? '+' : ''}{summary.bookingsTrend}% trend rasta
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 border-b border-border/50 bg-muted/30">
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-muted-foreground" />
                Sistemska Moderacija
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-background border border-border p-4 rounded-xl shadow-sm flex flex-col justify-center items-center text-center">
                  <p className="text-sm text-muted-foreground mb-1">Ukupno recenzija</p>
                  <p className="text-3xl font-bold text-foreground" data-testid="summary-total-reviews">
                    {summary.totalReviews}
                  </p>
                </div>
                <div className="bg-background border border-border p-4 rounded-xl shadow-sm flex flex-col justify-center items-center text-center">
                  <p className="text-sm text-muted-foreground mb-1">Skrivene recenzije</p>
                  <p className="text-3xl font-bold text-muted-foreground" data-testid="summary-hidden-reviews">
                    {summary.hiddenReviews}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className={summary.galleryCleanupHasRepeatedFailures ? "border-destructive/50 bg-destructive/5" : ""}>
          <CardHeader className="pb-2 border-b border-border/50 bg-muted/30">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertCircle className={`w-5 h-5 ${summary.galleryCleanupHasRepeatedFailures ? "text-destructive" : "text-muted-foreground"}`} />
              Čišćenje galerije
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {summary.galleryCleanupHasRepeatedFailures && (
              <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="gallery-cleanup-alert">
                <strong>Potrebna je intervencija.</strong> Proverite dostupnost App Storage-a i podešavanje zakazanog čišćenja; sistem će pokušati ponovo pri sledećem pokretanju.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-background border border-border p-4 rounded-xl shadow-sm">
                <p className="text-sm text-muted-foreground mb-1">Tiketi sa greškom</p>
                <p className="text-3xl font-bold text-foreground" data-testid="gallery-cleanup-failed-tickets">
                  {summary.galleryCleanupFailedTickets}
                </p>
              </div>
              <div className="bg-background border border-border p-4 rounded-xl shadow-sm">
                <p className="text-sm text-muted-foreground mb-1">Ukupno neuspešnih pokušaja</p>
                <p className="text-3xl font-bold text-foreground" data-testid="gallery-cleanup-failure-attempts">
                  {summary.galleryCleanupFailureAttempts}
                </p>
              </div>
              <div className="bg-background border border-border p-4 rounded-xl shadow-sm">
                <p className="text-sm text-muted-foreground mb-1">Najstariji kandidat za čišćenje</p>
                <p className="text-2xl font-bold text-foreground" data-testid="gallery-cleanup-oldest-ticket-age">
                  {formatCleanupTicketAge(summary.galleryCleanupOldestEligibleTicketAgeMinutes)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {summary.topCategories.length > 0 && (
          <Card>
            <CardHeader className="pb-4 border-b">
              <CardTitle className="text-lg">Top Kategorije po Rezervacijama</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {summary.topCategories.map((cat, idx) => (
                  <div key={cat.name} className="flex justify-between items-center p-4 hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="w-6 text-center text-muted-foreground font-serif text-lg italic">{idx + 1}.</span>
                      <span className="font-medium text-foreground">{cat.name}</span>
                    </div>
                    <span className="bg-primary text-primary-foreground font-bold px-3 py-1 rounded-full text-xs shadow-sm">
                      {cat.count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
