import { Layout } from "@/components/layout";
import { OptimizedImage } from "@/components/optimized-image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useListRetailProductSubscriptions,
  usePauseRetailProductSubscription,
  useResumeRetailProductSubscription,
  useCancelRetailProductSubscription,
  getListRetailProductSubscriptionsQueryKey,
} from "@workspace/api-client-react";
import { extractApiError } from "@/lib/admin-form-utils";
import { useToast } from "@/hooks/use-toast";
import { CalendarClock, Loader2, Pause, Play, Ban, RefreshCcw, Package } from "lucide-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

const money = (value: number) => new Intl.NumberFormat("sr-RS", {
  style: "currency", currency: "RSD", maximumFractionDigits: 0,
}).format(value);

const freqLabel: Record<string, string> = {
  WEEKLY: "Nedeljno",
  BIWEEKLY: "Na dve nedelje",
  MONTHLY: "Mesečno",
  EVERY_TWO_MONTHS: "Na dva meseca",
};

const statusColors: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800 border-transparent",
  PAUSED: "bg-amber-100 text-amber-800 border-transparent",
  CANCELLED: "bg-muted text-muted-foreground border-transparent",
};

const statusLabels: Record<string, string> = {
  ACTIVE: "Aktivno",
  PAUSED: "Pauzirano",
  CANCELLED: "Otkazano",
};

export default function CustomerSubscriptionsPage() {
  const { data: subs, isLoading, isError } = useListRetailProductSubscriptions({ query: { queryKey: getListRetailProductSubscriptionsQueryKey() } });

  const pauseMutation = usePauseRetailProductSubscription();
  const resumeMutation = useResumeRetailProductSubscription();
  const cancelMutation = useCancelRetailProductSubscription();

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const refetch = () => queryClient.invalidateQueries({ queryKey: getListRetailProductSubscriptionsQueryKey() });

  const handlePause = (id: string) => {
    pauseMutation.mutate({ subscriptionId: id }, {
      onSuccess: () => { toast.success("Pretplata je pauzirana."); refetch(); },
      onError: (err) => toast.error(extractApiError(err, "Nije moguće pauzirati pretplatu."))
    });
  };

  const handleResume = (id: string) => {
    resumeMutation.mutate({ subscriptionId: id }, {
      onSuccess: () => { toast.success("Pretplata je ponovo aktivna."); refetch(); },
      onError: (err) => toast.error(extractApiError(err, "Nije moguće aktivirati pretplatu."))
    });
  };

  const handleCancel = (id: string) => {
    if (!confirm("Da li ste sigurni da želite da trajno otkažete ovu pretplatu?")) return;
    cancelMutation.mutate({ subscriptionId: id }, {
      onSuccess: () => { toast.success("Pretplata je otkazana."); refetch(); },
      onError: (err) => toast.error(extractApiError(err, "Nije moguće otkazati pretplatu."))
    });
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-primary/10 text-primary rounded-full">
            <CalendarClock className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">Moje pretplate</h1>
            <p className="text-muted-foreground mt-1">Upravljajte redovnom isporukom proizvoda</p>
          </div>
        </div>

        {isLoading ? (
          <div className="py-24 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : isError ? (
          <div className="py-24 text-center text-destructive">Došlo je do greške prilikom učitavanja pretplata.</div>
        ) : !subs || subs.length === 0 ? (
          <div className="py-24 text-center border rounded-2xl bg-muted/20">
            <RefreshCcw className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-20" />
            <h2 className="text-xl font-serif font-bold">Nemate aktivne pretplate</h2>
            <p className="text-muted-foreground mt-2 mb-6">Pronađite omiljene proizvode i podesite redovnu isporuku uz popust.</p>
            <Button asChild><Link href="/proizvodi">Istraži proizvode</Link></Button>
          </div>
        ) : (
          <div className="space-y-4">
            {subs.map((sub) => (
              <div key={sub.id} className="border rounded-xl bg-card p-5 shadow-sm flex flex-col md:flex-row gap-6 items-start md:items-center">
                <div className="w-20 h-20 bg-muted rounded-lg flex items-center justify-center shrink-0 border">
                  <Package className="w-8 h-8 text-muted-foreground/30" />
                </div>

                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={statusColors[sub.status]}>{statusLabels[sub.status] || sub.status}</Badge>
                    <Badge variant="outline">{freqLabel[sub.frequency] || sub.frequency}</Badge>
                  </div>
                  <h3 className="font-serif font-bold text-lg">Proizvod #{sub.productId.slice(0,8)}</h3>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Količina: <strong className="text-foreground">{sub.quantity} kom</strong></p>
                    <p>Ostvareni popust: <strong className="text-emerald-600">{sub.discountPercent}%</strong></p>
                    {sub.status === "ACTIVE" && sub.nextDueAt && (
                      <p>Sledeća isporuka: <strong className="text-foreground">{new Date(sub.nextDueAt).toLocaleDateString("sr-RS")}</strong></p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 w-full md:w-auto md:flex-col justify-end">
                  {sub.status === "ACTIVE" && (
                    <Button variant="secondary" size="sm" onClick={() => handlePause(sub.id)} disabled={pauseMutation.isPending}>
                      <Pause className="w-4 h-4 mr-2" /> Pauziraj
                    </Button>
                  )}
                  {sub.status === "PAUSED" && (
                    <Button variant="default" size="sm" onClick={() => handleResume(sub.id)} disabled={resumeMutation.isPending}>
                      <Play className="w-4 h-4 mr-2" /> Aktiviraj
                    </Button>
                  )}
                  {sub.status !== "CANCELLED" && (
                    <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => handleCancel(sub.id)} disabled={cancelMutation.isPending}>
                      <Ban className="w-4 h-4 mr-2" /> Otkaži
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
