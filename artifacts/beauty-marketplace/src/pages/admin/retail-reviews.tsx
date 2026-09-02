import { useState } from "react";
import {
  AdminListRetailProductReviewsStatus,
  getAdminGetRetailProductReviewQueryKey,
  getAdminListRetailProductReviewsQueryKey,
  type RetailProductReviewModerationInputAction,
  useAdminGetRetailProductReview,
  useAdminListRetailProductReviews,
  useAdminModerateRetailProductReview,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, Eye, Loader2, MessageSquare, RotateCcw, Star, Trash2 } from "lucide-react";
import { AdminLayout } from "./layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";
import { extractApiError } from "@/lib/admin-form-utils";

const statuses = [
  AdminListRetailProductReviewsStatus.REPORTED,
  AdminListRetailProductReviewsStatus.AUTO_FLAGGED,
  AdminListRetailProductReviewsStatus.PUBLISHED,
  AdminListRetailProductReviewsStatus.REMOVED,
  AdminListRetailProductReviewsStatus.ALL,
] as const;

const isStatus = (value: string): value is AdminListRetailProductReviewsStatus =>
  statuses.some((status) => status === value);

export default function AdminRetailReviewsPage() {
  const [status, setStatus] = useState<AdminListRetailProductReviewsStatus>(
    AdminListRetailProductReviewsStatus.REPORTED,
  );
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState("");
  const [actionReviewId, setActionReviewId] = useState("");
  const [pendingAction, setPendingAction] = useState<RetailProductReviewModerationInputAction | null>(null);
  const [reason, setReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  const list = useAdminListRetailProductReviews({ status, page, pageSize: 20 });
  const detail = useAdminGetRetailProductReview(detailId, {
    query: {
      enabled: Boolean(detailId),
      queryKey: getAdminGetRetailProductReviewQueryKey(detailId),
    },
  });
  const moderate = useAdminModerateRetailProductReview();

  const openAction = (reviewId: string, action: RetailProductReviewModerationInputAction) => {
    if (moderate.isPending) return;
    setActionReviewId(reviewId);
    setPendingAction(action);
    setReason("");
    setInternalNote("");
  };

  const submitAction = () => {
    if (!pendingAction || !actionReviewId) return;
    const key = `retail-review:${actionReviewId}`;
    if (!actionGuard.begin(key)) return;
    moderate.mutate({
      reviewId: actionReviewId,
      data: {
        action: pendingAction,
        reason: reason.trim() || undefined,
        internalNote: internalNote.trim() || undefined,
      },
    }, {
      onSuccess: () => {
        setPendingAction(null);
        setActionReviewId("");
        setReason("");
        setInternalNote("");
        toast.success("Recenzija je uspešno ažurirana.");
        actionGuard.end(key);
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: getAdminListRetailProductReviewsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getAdminGetRetailProductReviewQueryKey(actionReviewId) }),
        ]);
      },
      onError: (error) => {
        toast.error("Moderacija nije uspela", {
          description: extractApiError(error, "Pokušajte ponovo."),
        });
        actionGuard.end(key);
      },
    });
  };

  const totalPages = Math.max(1, Math.ceil((list.data?.total ?? 0) / (list.data?.pageSize ?? 20)));

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-serif font-bold">B2C recenzije proizvoda</h1>
          <p className="text-sm text-muted-foreground">Pregled i moderacija verifikovanih recenzija.</p>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" aria-label="Filter statusa">
            {statuses.map((tab) => (
              <Button key={tab} size="sm" variant={status === tab ? "default" : "outline"} onClick={() => { setStatus(tab); setPage(1); }}>
                {tab === "ALL" ? "Sve" : tab}
              </Button>
            ))}
          </div>
          <Select value={status} onValueChange={(value) => { if (isStatus(value)) { setStatus(value); setPage(1); } }}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="REPORTED">Prijavljene</SelectItem>
              <SelectItem value="AUTO_FLAGGED">Automatski označene</SelectItem>
              <SelectItem value="PUBLISHED">Objavljene</SelectItem>
              <SelectItem value="REMOVED">Uklonjene</SelectItem>
              <SelectItem value="ALL">Sve</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {list.isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="size-6 animate-spin" /></div>
          ) : list.error ? (
            <div className="p-8 text-center text-destructive">{extractApiError(list.error, "Recenzije nije moguće učitati.")}</div>
          ) : !list.data?.items.length ? (
            <div className="flex flex-col items-center p-12 text-muted-foreground"><MessageSquare className="mb-3 size-10 opacity-30" />Nema recenzija za ovaj status.</div>
          ) : (
            <div className="divide-y">
              {list.data.items.map((review) => (
                <article key={review.id} className="flex flex-col gap-5 p-5 md:flex-row">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex" aria-label={`Ocena ${review.rating} od 5`}>
                        {[1, 2, 3, 4, 5].map((star) => <Star key={star} className={`size-4 ${star <= review.rating ? "fill-primary text-primary" : "text-muted"}`} />)}
                      </div>
                      <strong>{review.productName}</strong>
                      {review.verifiedPurchase && <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">Potvrđena kupovina</Badge>}
                      <Badge variant={review.moderationStatus === "REPORTED" || review.moderationStatus === "AUTO_FLAGGED" ? "destructive" : "secondary"}>{review.moderationStatus}</Badge>
                    </div>
                    <p className="rounded-lg border bg-background p-4 text-sm">{review.comment}</p>
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span>{new Date(review.createdAt).toLocaleString("sr-RS")}</span>
                      <span className="flex items-center gap-1"><AlertTriangle className="size-3" /> {review.reportCount} prijava</span>
                    </div>
                    {review.moderationReason && <p className="text-xs text-destructive">Razlog moderacije: {review.moderationReason}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 border-t pt-4 md:w-52 md:flex-col md:border-l md:border-t-0 md:pl-5 md:pt-0">
                    <Button variant="outline" size="sm" onClick={() => setDetailId(review.id)}><Eye className="mr-2 size-4" />Detalji</Button>
                    {(review.moderationStatus === "REPORTED" || review.moderationStatus === "AUTO_FLAGGED") && (
                      <>
                        <Button size="sm" onClick={() => openAction(review.id, "KEEP")} disabled={moderate.isPending}><CheckCircle className="mr-2 size-4" />Zadrži</Button>
                        <Button size="sm" variant="outline" onClick={() => openAction(review.id, "DISMISS_REPORTS")} disabled={moderate.isPending}>Odbaci prijave</Button>
                      </>
                    )}
                    {review.moderationStatus !== "REMOVED" && <Button size="sm" variant="destructive" onClick={() => openAction(review.id, "REMOVE")} disabled={moderate.isPending}><Trash2 className="mr-2 size-4" />Ukloni</Button>}
                    {review.moderationStatus === "REMOVED" && <Button size="sm" variant="outline" onClick={() => openAction(review.id, "RESTORE")} disabled={moderate.isPending}><RotateCcw className="mr-2 size-4" />Vrati</Button>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <Button variant="outline" disabled={page <= 1 || list.isFetching} onClick={() => setPage((value) => value - 1)}>Prethodna</Button>
          <span className="text-sm text-muted-foreground">Strana {page} od {totalPages}</span>
          <Button variant="outline" disabled={page >= totalPages || list.isFetching} onClick={() => setPage((value) => value + 1)}>Sledeća</Button>
        </div>
      </div>

      <Dialog open={Boolean(detailId)} onOpenChange={(open) => { if (!open) setDetailId(""); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Detalji recenzije</DialogTitle><DialogDescription>Prijave i istorija moderatorskih odluka bez podataka o prijaviocima.</DialogDescription></DialogHeader>
          {detail.isLoading ? <Loader2 className="mx-auto size-6 animate-spin" /> : detail.error ? (
            <p className="text-destructive">{extractApiError(detail.error, "Detalje nije moguće učitati.")}</p>
          ) : detail.data && (
            <div className="space-y-5">
              <div><strong>{detail.data.productName}</strong><p className="mt-2 rounded border p-3 text-sm">{detail.data.comment}</p></div>
              <section><h3 className="mb-2 font-semibold">Prijave ({detail.data.reportCount})</h3>
                {detail.data.reports.length ? <ul className="space-y-2">{detail.data.reports.map((report, index) => <li key={`${report.createdAt}-${index}`} className="rounded border p-3 text-sm"><strong>{report.reason}</strong>{report.explanation && <p>{report.explanation}</p>}<time className="text-xs text-muted-foreground">{new Date(report.createdAt).toLocaleString("sr-RS")}</time></li>)}</ul> : <p className="text-sm text-muted-foreground">Nema aktivnih prijava.</p>}
              </section>
              <section><h3 className="mb-2 font-semibold">Istorija moderacije</h3>
                {detail.data.audits.length ? <ul className="space-y-2">{detail.data.audits.map((audit) => <li key={audit.id} className="rounded border p-3 text-sm"><div><strong>{audit.action}</strong>: {audit.previousStatus ?? "—"} → {audit.nextStatus}</div>{audit.reason && <p>Razlog: {audit.reason}</p>}{audit.internalNote && <p>Beleška: {audit.internalNote}</p>}<p className="text-xs text-muted-foreground">Moderator: {audit.moderatorUserId} · {new Date(audit.createdAt).toLocaleString("sr-RS")}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">Nema moderatorskih odluka.</p>}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingAction)} onOpenChange={(open) => { if (!open && !moderate.isPending) setPendingAction(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Potvrdite moderatorsku akciju</DialogTitle><DialogDescription>Akcija: {pendingAction}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div><Label htmlFor="moderation-reason">Razlog (opciono)</Label><Textarea id="moderation-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} /></div>
            <div><Label htmlFor="moderation-note">Interna beleška (opciono)</Label><Textarea id="moderation-note" value={internalNote} onChange={(event) => setInternalNote(event.target.value)} maxLength={4000} /></div>
          </div>
          <DialogFooter><Button variant="outline" disabled={moderate.isPending} onClick={() => setPendingAction(null)}>Odustani</Button><Button variant={pendingAction === "REMOVE" ? "destructive" : "default"} disabled={moderate.isPending} onClick={submitAction}>{moderate.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}Potvrdi</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}