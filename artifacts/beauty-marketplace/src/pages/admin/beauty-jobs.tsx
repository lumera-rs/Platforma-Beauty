import { useEffect, useState } from "react";
import { format } from "date-fns";
import { srLatn } from "date-fns/locale";
import {
  useGetBeautyJobModerationQueue,
  getGetBeautyJobModerationQueueQueryKey,
  useGetBeautyJobSettings,
  getGetBeautyJobSettingsQueryKey,
  useUpdateBeautyJobSettings,
  useSweepExpiredBeautyJobs,
  useModerateBeautyJob,
  useResolveBeautyJobReport,
  useGetBeautyJobDeliveryIssues,
  getGetBeautyJobDeliveryIssuesQueryKey,
  useRetryBeautyJobDelivery,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/pages/admin/layout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Settings, Trash2, CheckCircle2, XCircle, Flag, Clock, MailWarning, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

const deliveryTypeLabels = {
  beauty_job_new_contact: "Novi kontakt",
  beauty_job_author_reply: "Odgovor autora",
  beauty_job_moderation: "Moderacija oglasa",
  beauty_job_expiry_warning: "Upozorenje o isteku",
};

const deliveryIssueLabels = {
  delayed: "Dugo na čekanju",
  temporary: "Prolazna greška",
  permanent: "Trajna greška",
  configuration: "Slanje preskočeno",
};

export default function AdminBeautyJobsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("queue");
  
  const { data: queue, isLoading: isLoadingQueue } = useGetBeautyJobModerationQueue({ query: { queryKey: getGetBeautyJobModerationQueueQueryKey() } });
  const { data: settings, isLoading: isLoadingSettings } = useGetBeautyJobSettings({ query: { queryKey: getGetBeautyJobSettingsQueryKey() } });
  const { data: deliveryIssues, isLoading: isLoadingDeliveryIssues } = useGetBeautyJobDeliveryIssues({
    query: {
      queryKey: getGetBeautyJobDeliveryIssuesQueryKey(),
      refetchInterval: 60_000,
    },
  });

  const moderateMutation = useModerateBeautyJob();
  const resolveReportMutation = useResolveBeautyJobReport();
  const updateSettingsMutation = useUpdateBeautyJobSettings();
  const sweepMutation = useSweepExpiredBeautyJobs();
  const retryDeliveryMutation = useRetryBeautyJobDelivery();
  const actionGuard = useImmediateActionGuard();

  // Settings State
  const [hourlyPostingLimit, setHourlyPostingLimit] = useState<number | "">(0);
  const [expiryDays, setExpiryDays] = useState<number | "">(0);
  const [isSettingsDirty, setIsSettingsDirty] = useState(false);

  useEffect(() => {
    if (!settings || isSettingsDirty) return;
    setHourlyPostingLimit(settings.hourlyPostingLimit);
    setExpiryDays(settings.listingExpiryDays);
  }, [settings, isSettingsDirty]);

  const [rejectReason, setRejectReason] = useState("");
  const [reportResolution, setReportResolution] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  const handleModerate = (jobId: string, action: "approve" | "reject", reason?: string) => {
    moderateMutation.mutate({ listingId: jobId, data: { action, reason } }, {
      onSuccess: () => {
        toast.success(action === "approve" ? "Oglas je odobren." : "Oglas je odbijen.");
        setSelectedJobId(null);
        setRejectReason("");
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobModerationQueueQueryKey() });
      },
      onError: () => toast.error("Došlo je do greške prilikom moderacije.")
    });
  };

  const handleResolveReport = (reportId: string, status: "dismissed" | "resolved") => {
    resolveReportMutation.mutate({ reportId, data: { status, resolutionNote: reportResolution } }, {
      onSuccess: () => {
        toast.success("Prijava je rešena.");
        setSelectedReportId(null);
        setReportResolution("");
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobModerationQueueQueryKey() });
      },
      onError: () => toast.error("Došlo je do greške prilikom rešavanja prijave.")
    });
  };

  const handleSaveSettings = () => {
    if (typeof hourlyPostingLimit !== "number" || typeof expiryDays !== "number") return;
    updateSettingsMutation.mutate({ data: { hourlyPostingLimit, listingExpiryDays: expiryDays } }, {
      onSuccess: () => {
        toast.success("Podešavanja sačuvana.");
        setIsSettingsDirty(false);
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobSettingsQueryKey() });
      },
      onError: () => toast.error("Došlo je do greške.")
    });
  };

  const handleSweep = () => {
    if (confirm("Da li ste sigurni da želite da ručno pokrenete čišćenje isteklih oglasa? Ovo se inače radi automatski.")) {
      sweepMutation.mutate(undefined, {
        onSuccess: (data) => {
          toast.success(`Čišćenje uspešno. Isteklo je ${data.expired} oglasa.`);
          queryClient.invalidateQueries({ queryKey: getGetBeautyJobModerationQueueQueryKey() });
        }
      });
    }
  };

  const handleDeliveryRetry = (deliveryId: string) => {
    const guardKey = `beauty-job-delivery-retry:${deliveryId}`;
    if (!actionGuard.begin(guardKey)) return;
    retryDeliveryMutation.mutate({ deliveryId }, {
      onSuccess: (result) => {
        toast.success(
          result.status === "sent"
            ? "Mejl je uspešno poslat."
            : "Ponovni pokušaj je pokrenut.",
        );
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobDeliveryIssuesQueryKey() });
        actionGuard.end(guardKey);
      },
      onError: () => {
        toast.error("Ponovni pokušaj nije pokrenut.", {
          description: "Zapis više nije u retry stanju ili ga drugi administrator već obrađuje.",
        });
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobDeliveryIssuesQueryKey() });
        actionGuard.end(guardKey);
      },
    });
  };

  return (
    <AdminLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Poslovi & Oglasi</h1>
        <p className="text-muted-foreground">Moderacija oglasa, rešavanje prijava i globalna podešavanja platforme.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-8 overflow-x-auto w-full justify-start h-12 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="queue" className="gap-2 h-10 rounded-lg">
            <Shield className="w-4 h-4" /> Moderacija
            {queue?.listings?.length ? (
              <Badge variant="destructive" className="ml-1 px-1.5 py-0 min-w-[20px] rounded-full h-5 text-xs">
                {queue.listings.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2 h-10 rounded-lg">
            <Flag className="w-4 h-4" /> Prijave
            {queue?.reports?.length ? (
              <Badge variant="destructive" className="ml-1 px-1.5 py-0 min-w-[20px] rounded-full h-5 text-xs">
                {queue.reports.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="email-deliveries" className="gap-2 h-10 rounded-lg">
            <MailWarning className="w-4 h-4" /> Isporuka mejlova
            {deliveryIssues?.summary.totalIssueCount ? (
              <Badge variant="destructive" className="ml-1 px-1.5 py-0 min-w-[20px] rounded-full h-5 text-xs">
                {deliveryIssues.summary.totalIssueCount}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2 h-10 rounded-lg">
            <Settings className="w-4 h-4" /> Podešavanja
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-6">
          <h2 className="text-xl font-bold font-serif">Oglasi na čekanju</h2>
          {isLoadingQueue ? (
            <div className="space-y-4"><Skeleton className="h-24 w-full rounded-xl" /></div>
          ) : queue?.listings?.length === 0 ? (
            <div className="text-center py-12 bg-card border border-dashed rounded-xl text-muted-foreground shadow-sm">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
              Nema oglasa koji čekaju moderaciju.
            </div>
          ) : (
            <div className="space-y-4">
              {queue?.listings?.map((job) => (
                <div key={job.id} className="p-5 rounded-xl border bg-card shadow-sm space-y-4">
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant="outline">{job.type}</Badge>
                        <Badge variant="secondary">{job.categoryName}</Badge>
                      </div>
                      <h4 className="font-bold text-lg">{job.title}</h4>
                      <p className="text-sm text-muted-foreground">Autor: {job.authorDisplayName}</p>
                    </div>
                    <Link href={`/poslovi/pregled/${job.id}`} target="_blank" className="text-sm font-medium text-primary hover:underline">
                      Otvori oglas ↗
                    </Link>
                  </div>
                  <div className="bg-muted/30 p-4 rounded-lg text-sm text-foreground/90 whitespace-pre-wrap max-h-[150px] overflow-y-auto custom-scrollbar border border-muted">
                    {job.description}
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <Dialog open={selectedJobId === job.id} onOpenChange={(open) => {
                      if (open) { setSelectedJobId(job.id); setRejectReason(""); }
                      else setSelectedJobId(null);
                    }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="destructive" className="gap-1.5">
                          <XCircle className="w-4 h-4" /> Odbij
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Odbij oglas</DialogTitle>
                          <DialogDescription>Unesite razlog odbijanja. Autor će biti obavešten.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 pt-4">
                          <div className="space-y-2">
                            <Label>Razlog odbijanja</Label>
                            <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Npr. Oglas krši pravila..." />
                          </div>
                          <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setSelectedJobId(null)}>Odustani</Button>
                            <Button type="button" variant="destructive" onClick={() => handleModerate(job.id, "reject", rejectReason)} disabled={!rejectReason || moderateMutation.isPending}>
                              Potvrdi odbijanje
                            </Button>
                          </DialogFooter>
                        </div>
                      </DialogContent>
                    </Dialog>
                    
                    <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleModerate(job.id, "approve")} disabled={moderateMutation.isPending}>
                      <CheckCircle2 className="w-4 h-4" /> Odobri
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="email-deliveries" className="space-y-6">
          <div>
            <h2 className="text-xl font-bold font-serif">Beauty Poslovi mejlovi koji zahtevaju pažnju</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Prikaz ne sadrži adresu primaoca, ime, sadržaj poruke ni sirovu provider grešku.
            </p>
          </div>

          {isLoadingDeliveryIssues ? (
            <div className="space-y-4"><Skeleton className="h-28 w-full rounded-xl" /></div>
          ) : deliveryIssues ? (
            <>
              {deliveryIssues.summary.terminalIssueCount >= deliveryIssues.summary.alertThreshold && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert" data-testid="beauty-job-delivery-threshold-alert">
                  <strong>Prag za monitoring upozorenje je dostignut.</strong>{" "}
                  Sistem upozorava administratore kada ima najmanje {deliveryIssues.summary.alertThreshold} terminalno neisporučenih poruka.
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border bg-card p-5 shadow-sm">
                  <p className="text-sm text-muted-foreground">Dugo na čekanju</p>
                  <p className="mt-2 text-3xl font-bold" data-testid="beauty-job-delivery-delayed-count">{deliveryIssues.summary.delayedQueuedCount}</p>
                  <p className="mt-1 text-xs text-muted-foreground">duže od {deliveryIssues.summary.staleAfterMinutes} minuta</p>
                </div>
                <div className="rounded-xl border bg-card p-5 shadow-sm">
                  <p className="text-sm text-muted-foreground">Neuspešno</p>
                  <p className="mt-2 text-3xl font-bold text-destructive" data-testid="beauty-job-delivery-failed-count">{deliveryIssues.summary.failedCount}</p>
                </div>
                <div className="rounded-xl border bg-card p-5 shadow-sm">
                  <p className="text-sm text-muted-foreground">Preskočeno</p>
                  <p className="mt-2 text-3xl font-bold text-amber-700" data-testid="beauty-job-delivery-skipped-count">{deliveryIssues.summary.skippedCount}</p>
                </div>
              </div>

              {deliveryIssues.deliveries.length ? (
                <div className="overflow-hidden rounded-xl border bg-card shadow-sm" data-testid="beauty-job-delivery-list">
                  <div className="divide-y">
                    {deliveryIssues.deliveries.map((delivery) => {
                      const guardKey = `beauty-job-delivery-retry:${delivery.id}`;
                      return (
                        <div key={delivery.id} className="grid gap-4 p-5 md:grid-cols-[1.4fr_.9fr_.9fr_auto] md:items-center">
                          <div>
                            <p className="font-medium">{deliveryTypeLabels[delivery.emailType]}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Kreirano {format(new Date(delivery.createdAt), "dd.MM.yyyy. HH:mm", { locale: srLatn })}
                            </p>
                          </div>
                          <div>
                            <Badge variant={delivery.status === "failed" ? "destructive" : "secondary"}>
                              {deliveryIssueLabels[delivery.issueKind]}
                            </Badge>
                            <p className="mt-1 text-xs text-muted-foreground">Pokušaji: {delivery.retryCount}</p>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {delivery.nextRetryAt
                              ? `Sledeći automatski pokušaj: ${format(new Date(delivery.nextRetryAt), "dd.MM. HH:mm", { locale: srLatn })}`
                              : delivery.retryAvailable
                                ? "Automatski pokušaji su iscrpljeni."
                                : "Ručni retry nije dozvoljen za ovo stanje."}
                          </p>
                          {delivery.retryAvailable ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-2"
                              onClick={() => handleDeliveryRetry(delivery.id)}
                              disabled={retryDeliveryMutation.isPending || actionGuard.isActive(guardKey)}
                              data-testid={`beauty-job-delivery-retry-${delivery.id}`}
                            >
                              <RefreshCw className={`h-4 w-4 ${actionGuard.isActive(guardKey) ? "animate-spin" : ""}`} />
                              Pokušaj ponovo
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Bez ručne akcije</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed bg-card py-12 text-center text-muted-foreground">
                  <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
                  Nema Beauty Poslovi mejlova koji zahtevaju pažnju.
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-sm text-destructive">
              Pregled isporuke trenutno nije dostupan.
            </div>
          )}
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <h2 className="text-xl font-bold font-serif">Prijavljeni oglasi</h2>
          {isLoadingQueue ? (
            <div className="space-y-4"><Skeleton className="h-24 w-full rounded-xl" /></div>
          ) : queue?.reports?.length === 0 ? (
            <div className="text-center py-12 bg-card border border-dashed rounded-xl text-muted-foreground shadow-sm">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
              Nema otvorenih prijava.
            </div>
          ) : (
            <div className="space-y-4">
              {queue?.reports?.map((report) => (
                <div key={report.id} className="p-5 rounded-xl border border-destructive/20 bg-destructive/5 shadow-sm space-y-4">
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant="destructive" className="gap-1"><Flag className="w-3 h-3" /> Prijava</Badge>
                        <span className="text-xs font-medium text-muted-foreground">{format(new Date(report.createdAt), "dd.MM.yyyy. HH:mm", { locale: srLatn })}</span>
                      </div>
                      <h4 className="font-bold">Oglas ID: {report.listingId}</h4>
                      <p className="text-sm text-muted-foreground">Prijavio korisnik ID: {report.reporterUserId}</p>
                    </div>
                    <Link href={`/poslovi/pregled/${report.listingId}`} target="_blank" className="text-sm font-medium text-primary hover:underline">
                      Otvori oglas ↗
                    </Link>
                  </div>
                  
                  <div>
                    <h5 className="text-sm font-semibold mb-1">Razlog prijave:</h5>
                    <div className="bg-card p-4 rounded-lg text-sm text-foreground/90 whitespace-pre-wrap border">
                      {report.reason}
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Dialog open={selectedReportId === report.id} onOpenChange={(open) => {
                      if (open) { setSelectedReportId(report.id); setReportResolution(""); }
                      else setSelectedReportId(null);
                    }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          Reši prijavu
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Rešavanje prijave</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 pt-4">
                          <div className="space-y-2">
                            <Label>Beleška o rešavanju (opciono)</Label>
                            <Textarea value={reportResolution} onChange={e => setReportResolution(e.target.value)} placeholder="Za internu evidenciju..." />
                          </div>
                          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
                            <Button type="button" variant="outline" className="flex-1" onClick={() => handleResolveReport(report.id, "dismissed")} disabled={resolveReportMutation.isPending}>
                              Odbaci prijavu (Oglas ostaje)
                            </Button>
                            <Button type="button" variant="destructive" className="flex-1" onClick={() => handleResolveReport(report.id, "resolved")} disabled={resolveReportMutation.isPending}>
                              Ukloni oglas iz javnog prikaza
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="space-y-6 max-w-2xl">
          <h2 className="text-xl font-bold font-serif mb-6">Podešavanja Berze Poslova</h2>
          
          <div className="p-6 rounded-xl border bg-card shadow-sm space-y-6">
            {isLoadingSettings ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Ograničenje broja oglasa po satu (po korisniku)</Label>
                  <Input 
                    type="number" 
                    min={1} 
                    value={hourlyPostingLimit} 
                    onChange={e => { setHourlyPostingLimit(e.target.value === "" ? "" : Number(e.target.value)); setIsSettingsDirty(true); }} 
                  />
                  <p className="text-xs text-muted-foreground">Sprečava spam objavljivanje velike količine oglasa u kratkom vremenu.</p>
                </div>
                
                <div className="space-y-2">
                  <Label>Trajanje oglasa (dani)</Label>
                  <Input 
                    type="number" 
                    min={1} 
                    value={expiryDays} 
                    onChange={e => { setExpiryDays(e.target.value === "" ? "" : Number(e.target.value)); setIsSettingsDirty(true); }} 
                  />
                  <p className="text-xs text-muted-foreground">Nakon koliko dana se oglas automatski zatvara (ističe).</p>
                </div>

                <div className="pt-4 flex justify-end">
                  <Button onClick={handleSaveSettings} disabled={!isSettingsDirty || updateSettingsMutation.isPending}>
                    {updateSettingsMutation.isPending ? "Čuvanje..." : "Sačuvaj izmene"}
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="p-6 rounded-xl border border-destructive/20 bg-destructive/5 shadow-sm space-y-4">
            <div>
              <h3 className="font-bold text-destructive flex items-center gap-2 mb-1">
                <Trash2 className="w-5 h-5" /> Ručno čišćenje
              </h3>
              <p className="text-sm text-destructive/80">
                Pokrenite čišćenje isteklih oglasa ručno. Sistem ovo obično radi automatski svakog sata.
              </p>
            </div>
            <Button variant="destructive" className="gap-2" onClick={handleSweep} disabled={sweepMutation.isPending}>
              {sweepMutation.isPending ? "Čišćenje u toku..." : <><Clock className="w-4 h-4" /> Pokreni čišćenje sada</>}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}