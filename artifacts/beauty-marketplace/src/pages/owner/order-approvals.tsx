import { useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, CheckCircle2, XCircle, ShoppingBag, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

const money = (n: number) => `${n.toLocaleString("sr-RS")} RSD`;
const date = (d: string) => new Date(d).toLocaleString("sr-RS", { dateStyle: "medium", timeStyle: "short" });

type ApprovalRequest = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  employeeName: string;
  employeeId: string;
  quote: number;
  quoteVersion: number;
  couponCode: string | null;
  referralCreditIntentRsd: number;
  createdAt: string;
  decidedAt: string | null;
  finalizedOrderId: string | null;
  lines: Array<{
    productId: string;
    bundleId: string | null;
    productName: string;
    sku: string | null;
    quantity: number;
    catalog: { price: number; listPrice: number };
  }>;
};

function useGetApprovalRequests() {
  return useQuery({
    queryKey: ["approval-requests"],
    queryFn: async () => {
      const res = await fetch("/api/shop/approval-requests", { credentials: "include" });
      if (!res.ok) throw new Error("Neuspešno učitavanje zahteva");
      return res.json() as Promise<ApprovalRequest[]>;
    }
  });
}

function useGetApprovalRequest(id: string) {
  return useQuery({
    queryKey: ["approval-requests", id],
    queryFn: async () => {
      const res = await fetch(`/api/shop/approval-requests/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Neuspešno učitavanje zahteva");
      return res.json() as Promise<ApprovalRequest>;
    },
    enabled: !!id,
  });
}

function ApprovalRequestDetail({ id }: { id: string }) {
  const { data: request, isLoading } = useGetApprovalRequest(id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/shop/approval-requests/${id}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Neuspešno odobravanje");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Zahtev je uspešno odobren i konvertovan u porudžbinu.");
      queryClient.invalidateQueries({ queryKey: ["approval-requests"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Greška pri odobravanju");
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/shop/approval-requests/${id}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Neuspešno odbijanje");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Zahtev je odbijen.");
      setShowRejectForm(false);
      queryClient.invalidateQueries({ queryKey: ["approval-requests"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Greška pri odbijanju");
    }
  });

  if (isLoading) return <div className="p-10 text-center"><Loader2 className="animate-spin inline text-primary" /></div>;
  if (!request) return <p className="text-muted-foreground text-center p-8">Zahtev nije pronađen.</p>;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" className="mb-2">
        <Link href="/vlasnik/porudzbine-na-cekanju"><ArrowLeft className="w-4 h-4 mr-2"/>Nazad na listu odobrenja</Link>
      </Button>
      
      <Card>
        <CardHeader className="border-b bg-muted/20">
          <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                Zahtev #{request.id.slice(0, 8)}
                <Badge variant={request.status === "PENDING" ? "secondary" : request.status === "APPROVED" ? "default" : "destructive"}>
                  {request.status === "PENDING" ? "Na čekanju" : request.status === "APPROVED" ? "Odobreno" : request.status === "REJECTED" ? "Odbijeno" : "Isteklo"}
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1 flex items-center gap-4 text-sm">
                <span><span className="font-medium text-foreground">Zaposleni:</span> {request.employeeName}</span>
                <span><span className="font-medium text-foreground">Kreirano:</span> {date(request.createdAt)}</span>
              </CardDescription>
            </div>
            {request.status === "PENDING" && (
              <div className="flex gap-2">
                {!showRejectForm && (
                  <>
                    <Button 
                      variant="outline" 
                      className="border-destructive/30 text-destructive hover:bg-destructive/10" 
                      onClick={() => setShowRejectForm(true)}
                    >
                      <XCircle className="w-4 h-4 mr-2" /> Odbij
                    </Button>
                    <Button 
                      onClick={() => approveMutation.mutate()} 
                      disabled={approveMutation.isPending}
                    >
                      {approveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                      Odobri i poruči
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        
        {showRejectForm && request.status === "PENDING" && (
          <div className="p-4 border-b bg-destructive/5 space-y-3">
            <h4 className="text-sm font-semibold text-destructive">Razlog odbijanja</h4>
            <Textarea 
              placeholder="Unesite razlog (opciono)..." 
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="bg-background"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowRejectForm(false)}>Odustani</Button>
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
              >
                {rejectMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Potvrdi odbijanje
              </Button>
            </div>
          </div>
        )}

        <CardContent className="p-0">
          <div className="divide-y">
            {request.lines.map((line, idx) => (
              <div key={`${line.productId}-${idx}`} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-muted/10">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <ShoppingBag className="w-5 h-5 text-primary/70" />
                  </div>
                  <div>
                    <p className="font-semibold">{line.productName}</p>
                    <p className="text-sm text-muted-foreground">
                      Količina: {line.quantity} {line.sku ? `· SKU: ${line.sku}` : ''} 
                      {line.bundleId ? " (Deo paketa)" : ""}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{money(line.catalog.price * line.quantity)}</p>
                  {line.catalog.listPrice > line.catalog.price && (
                    <p className="text-xs text-muted-foreground line-through">{money(line.catalog.listPrice * line.quantity)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          <div className="p-6 bg-muted/20 space-y-2 border-t">
            {request.couponCode && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Kupon korišćen</span>
                <span className="font-medium">{request.couponCode}</span>
              </div>
            )}
            {request.referralCreditIntentRsd > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Planiran referral kredit</span>
                <span className="font-medium text-emerald-600">-{money(request.referralCreditIntentRsd)}</span>
              </div>
            )}
            <div className="flex justify-between items-center text-lg pt-4 border-t border-border/50">
              <span className="font-bold">Ukupno za odobrenje</span>
              <span className="font-bold text-primary">{money(request.quote)}</span>
            </div>
          </div>
          
          {request.status !== "PENDING" && (
            <div className="p-4 text-sm text-muted-foreground text-center border-t">
              Ovaj zahtev je {request.status === "APPROVED" ? "odobren" : request.status === "REJECTED" ? "odbijen" : "istekao"} dana {request.decidedAt ? date(request.decidedAt) : ""}.
              {request.finalizedOrderId && (
                <div className="mt-2">
                  <Button variant="link" asChild className="p-0 h-auto">
                    <Link href={`/vlasnik/porudzbine/${request.finalizedOrderId}`}>Pogledaj kreiranu porudžbinu →</Link>
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function OwnerOrderApprovals() {
  const [, params] = useRoute("/vlasnik/porudzbine-na-cekanju/:id");
  const detailId = params?.id;
  const { data: requests = [], isLoading } = useGetApprovalRequests();

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/porudzbine-na-cekanju" />
        
        <main className="flex-1 min-w-0 w-full space-y-6">
          {detailId ? (
            <ApprovalRequestDetail id={detailId} />
          ) : (
            <>
              <div>
                <h1 className="text-3xl font-serif font-bold mb-2">Odobrenja porudžbina</h1>
                <p className="text-muted-foreground">
                  Pregledajte i odobrite zahteve za nabavku opreme koje su podneli vaši zaposleni.
                </p>
              </div>
              
              {isLoading ? (
                <div className="flex justify-center p-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : requests.length === 0 ? (
                <Card>
                  <CardContent className="p-16 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                      <CheckCircle2 className="w-8 h-8 text-muted-foreground/50" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">Nema zahteva na čekanju</h3>
                    <p className="text-muted-foreground">
                      Svi zahtevi za nabavku od vaših zaposlenih su obrađeni.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {requests.map(req => (
                    <Card key={req.id} className={`overflow-hidden transition-colors ${req.status === 'PENDING' ? 'border-primary/30 shadow-sm' : 'opacity-70'}`}>
                      <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-start gap-4">
                          <div className={`p-3 rounded-full ${req.status === 'PENDING' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                            <Clock className="w-6 h-6" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-lg">Zaposleni: {req.employeeName}</span>
                              <Badge variant={req.status === "PENDING" ? "secondary" : req.status === "APPROVED" ? "default" : "destructive"}>
                                {req.status === "PENDING" ? "Na čekanju" : req.status === "APPROVED" ? "Odobreno" : req.status === "REJECTED" ? "Odbijeno" : "Isteklo"}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Zahtev #{req.id.slice(0, 8)} · {req.lines.length} stavki · Podneto: {date(req.createdAt)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 md:flex-col md:items-end self-start md:self-auto w-full md:w-auto mt-2 md:mt-0 justify-between">
                          <div className="text-right">
                            <p className="text-sm text-muted-foreground">Vrednost</p>
                            <p className="text-xl font-bold">{money(req.quote)}</p>
                          </div>
                          <Button asChild variant={req.status === 'PENDING' ? 'default' : 'outline'} size="sm">
                            <Link href={`/vlasnik/porudzbine-na-cekanju/${req.id}`}>
                              {req.status === 'PENDING' ? 'Pregledaj i odobri' : 'Detalji'}
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </BusinessLayout>
  );
}
