import { useState } from "react";
import { AdminLayout } from "./layout";
import { useAdminUpdateRmaStatus } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, AlertCircle, Image as ImageIcon, History, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { OptimizedImage } from "@/components/optimized-image";
import { useQueryClient } from "@tanstack/react-query";


interface RmaListItem {
  id: string;
  rmaNumber: string;
  createdAt: string;
  target: string;
  owner: any;
  orderId: string;
  reason: string;
  description: string;
  status: string;
}

interface RmaDetail extends RmaListItem {
  items: any[];
  privatePhotos: string[];
  auditTrail: any[];
}
export default function AdminRmas() {
  const [page, setPage] = useState(1);
  
  
  const { data, isLoading } = useQuery<RmaListItem[]>({
    queryKey: ["admin", "rmas", page],
    queryFn: () => customFetch(`/api/admin/rmas?page=${page}&pageSize=50`)
  });

  
  const [selectedRmaId, setSelectedRmaId] = useState<string | null>(null);

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-bold text-foreground">Reklamacije (RMA)</h1>
        <p className="text-muted-foreground">Upravljanje zahtevima za povrat i reklamacijama (B2B i B2C).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spisak reklamacija</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : !data || data.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
              Trenutno nema aktivnih reklamacija.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="p-3 font-medium">Broj / Datum</th>
                    <th className="p-3 font-medium">Kupac / Porudžbina</th>
                    <th className="p-3 font-medium">Razlog</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium text-right">Akcija</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((rma) => (
                    <tr key={rma.id} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                      <td className="p-3">
                        <div className="font-medium text-foreground">{rma.rmaNumber}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{new Date(rma.createdAt).toLocaleDateString("sr-RS")}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium">
                          {rma.target === 'b2c' ? (rma.owner as any)?.firstName + ' ' + (rma.owner as any)?.lastName : (rma.owner as any)?.businessName}
                          <Badge variant="outline" className="ml-2 text-[10px] uppercase">{rma.target}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">Porudžbina: {rma.orderId.slice(0,8)}</div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium text-foreground">{rma.reason}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1 max-w-[200px]">{rma.description}</div>
                      </td>
                      <td className="p-3">
                        <Badge variant={rma.status === 'RECEIVED' ? 'default' : rma.status === 'APPROVED' ? 'secondary' : rma.status === 'REJECTED' ? 'destructive' : 'outline'}>
                          {rma.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="secondary" onClick={() => setSelectedRmaId(rma.id)}>Detalji</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedRmaId && (
        <RmaDetailDialog rmaId={selectedRmaId} open={true} onOpenChange={(open) => !open && setSelectedRmaId(null)} />
      )}
    </AdminLayout>
  );
}

function RmaDetailDialog({ rmaId, open, onOpenChange }: { rmaId: string, open: boolean, onOpenChange: (open: boolean) => void }) {
  
  
  const { data: rma, isLoading } = useQuery<RmaDetail>({
    queryKey: ["admin", "rma", rmaId],
    queryFn: () => customFetch(`/api/admin/rmas/${rmaId}`),
    enabled: !!rmaId
  });

  const updateStatus = useAdminUpdateRmaStatus();
  const { toast } = useToast();
  const qc = useQueryClient();

  const handleUpdate = (status: "IN_REVIEW" | "APPROVED" | "REJECTED") => {
    updateStatus.mutate({ id: rmaId, data: { status: status as any } }, {
      onSuccess: () => {
        toast.success("Status reklamacije je ažuriran.");
        qc.invalidateQueries({ queryKey: ["admin", "rma", rmaId] });
        qc.invalidateQueries({ queryKey: ["admin", "rmas"] });
      },
      onError: () => toast.error("Nije moguće ažurirati status reklamacije.")
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        {isLoading || !rma ? (
          <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between mb-2">
                <Badge variant="outline" className="uppercase">{rma.target}</Badge>
                 <Badge variant={rma.status === 'RECEIVED' ? 'default' : rma.status === 'REJECTED' ? 'destructive' : 'secondary'}>{rma.status}</Badge>
              </div>
              <DialogTitle className="text-2xl font-serif">RMA: {rma.rmaNumber}</DialogTitle>
              <DialogDescription>
                Porudžbina #{rma.orderId.slice(0,8)} · Kreirano: {new Date(rma.createdAt).toLocaleString("sr-RS")}
              </DialogDescription>
            </DialogHeader>

            <div className="grid md:grid-cols-2 gap-6 py-4">
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Informacije o kupcu</h3>
                  <div className="bg-muted/10 p-4 rounded-xl border space-y-1 text-sm">
                    {rma.target === 'b2c' ? (
                      <>
                        <p><span className="font-semibold">Ime:</span> {(rma.owner as any)?.firstName} {(rma.owner as any)?.lastName}</p>
                        <p><span className="font-semibold">Email:</span> {(rma.owner as any)?.email}</p>
                      </>
                    ) : (
                      <>
                        <p><span className="font-semibold">Salon:</span> {(rma.owner as any)?.businessName}</p>
                        <p><span className="font-semibold">PIB:</span> {(rma.owner as any)?.pib}</p>
                        <p><span className="font-semibold">Email:</span> {(rma.owner as any)?.email}</p>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Reklamirani artikli</h3>
                  <div className="border rounded-xl divide-y">
                    {rma.items.map((item: any, i: number) => (
                      <div key={i} className="p-3 text-sm flex justify-between items-center">
                        <span className="font-medium">{item.productName || `Artikal ${item.orderItemId}`}</span>
                        <Badge variant="secondary">Kol: {item.quantity}</Badge>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Opis problema</h3>
                  <div className="bg-destructive/5 text-destructive-foreground p-4 rounded-xl border border-destructive/20">
                    <p className="font-semibold mb-2">{rma.reason}</p>
                    <p className="text-sm whitespace-pre-line">{rma.description}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                {rma.privatePhotos && rma.privatePhotos.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5"><ImageIcon className="w-4 h-4"/> Priložene fotografije</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {rma.privatePhotos.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block aspect-square rounded-xl overflow-hidden border hover:ring-2 hover:ring-primary transition-all">
                          <OptimizedImage src={url} alt={`RMA photo ${i+1}`} className="w-full h-full object-cover" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5"><History className="w-4 h-4"/> Istorija i Audit</h3>
                  <div className="space-y-3">
                    {rma.auditTrail.map((entry: any, i: number) => (
                      <div key={i} className="bg-muted/10 p-3 rounded-lg text-xs border">
                        <div className="flex justify-between items-start mb-1 text-muted-foreground">
                          <span className="font-medium">{entry.action}</span>
                          <span>{new Date(entry.timestamp).toLocaleString("sr-RS")}</span>
                        </div>
                        <p className="text-foreground">{entry.note || "Bez beleške"}</p>
                        <p className="text-muted-foreground mt-1">Od: {entry.actorId || "Sistem"}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {rma.status === 'RECEIVED' || rma.status === 'IN_REVIEW' ? (
                  <div className="bg-muted/20 p-4 rounded-xl border mt-6">
                    <h3 className="font-semibold mb-3">Ažuriranje statusa</h3>
                    <div className="flex gap-2">
                      {rma.status === 'RECEIVED' && (
                        <Button className="w-full" onClick={() => handleUpdate('IN_REVIEW')} disabled={updateStatus.isPending}>
                          Započni obradu
                        </Button>
                      )}
                      {rma.status === 'IN_REVIEW' && (
                        <>
                          <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => handleUpdate('APPROVED')} disabled={updateStatus.isPending}>
                            <CheckCircle className="w-4 h-4 mr-1.5" /> Odobri
                          </Button>
                          <Button className="flex-1" variant="destructive" onClick={() => handleUpdate('REJECTED')} disabled={updateStatus.isPending}>
                            <XCircle className="w-4 h-4 mr-1.5" /> Odbij
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}