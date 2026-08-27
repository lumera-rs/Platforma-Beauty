import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useGetOrder, useListOrders, useRepeatLastShopOrder, getListOrdersQueryKey } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Package, ArrowLeft, ExternalLink, Truck, Repeat } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const money = (n: number) => `${n.toLocaleString("sr-RS")} RSD`;
const date = (d: string) => new Date(d).toLocaleDateString("sr-RS", { dateStyle: "medium" });

function DeliveryTracking({ order, compact = false }: { order: { deliveryMethod: string; courierService: string | null; trackingNumber: string | null; trackingUrl: string | null }; compact?: boolean }) {
  const personalDelivery = order.deliveryMethod === "personal_belgrade" || order.courierService === "Lična dostava";
  if (personalDelivery) return <p className="flex items-center gap-1 text-sm text-muted-foreground"><Truck className="h-4 w-4" />Lična dostava — kontaktiraćemo vas</p>;
  if (!order.courierService && !order.trackingNumber) return null;
  return <div className={compact ? "mt-1 text-xs text-muted-foreground" : "rounded-lg border bg-muted/30 p-3 text-sm"}>
    <p><span className="font-medium">Kurir:</span> {order.courierService ?? "Nije izabran"}</p>
    {order.trackingNumber && <p><span className="font-medium">Broj za praćenje:</span> {order.trackingNumber}</p>}
    {order.trackingUrl && <Button asChild variant="link" size="sm" className="mt-1 h-auto px-0 text-primary"><a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" data-testid="btn-track-shipment">Prati pošiljku <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button>}
  </div>;
}

function OrderDetail({ id }: { id: string }) {
  const { data: order, isLoading } = useGetOrder(id);
  if (isLoading) return <div className="p-10 text-center"><Loader2 className="animate-spin inline" /></div>;
  if (!order) return <p>Porudžbina nije pronađena.</p>;
  return <div className="space-y-4"><Button asChild variant="ghost"><Link href="/vlasnik/porudzbine"><ArrowLeft className="w-4 h-4 mr-2"/>Nazad na porudžbine</Link></Button>
    <Card><CardHeader><CardTitle className="flex justify-between">Porudžbina #{order.id.slice(0, 8)} <Badge>{order.status}</Badge></CardTitle></CardHeader><CardContent className="space-y-4">
      {order.items.map((item) => <div key={`${item.productId}-${item.variantValue}`} className="flex justify-between border-b pb-3"><div><b>{item.productName}</b><p className="text-sm text-muted-foreground">{item.variantLabel ? `${item.variantLabel}: ` : ""}{item.variantValue ?? "—"} · SKU {item.productSku ?? "—"} · {item.quantity} kom.</p></div><b>{money(item.price * item.quantity)}</b></div>)}
      <div className="text-sm space-y-1 border-t pt-3"><div className="flex justify-between"><span>Međuzbir</span><span>{money(order.subtotal)}</span></div><div className="flex justify-between"><span>Dostava</span><span>{money(order.shippingCost)}</span></div><div className="flex justify-between font-bold text-base"><span>Ukupno</span><span>{money(order.total)}</span></div></div>
      <DeliveryTracking order={order} />
    </CardContent></Card>
    <div className="grid md:grid-cols-2 gap-4"><Card><CardHeader><CardTitle className="text-base">Dostava</CardTitle></CardHeader><CardContent className="text-sm">{order.delivery.recipientName}<br/>{order.delivery.address}<br/>{order.delivery.postalCode} {order.delivery.city}<br/>{order.delivery.phone}<br/>{order.delivery.note && <em>{order.delivery.note}</em>}</CardContent></Card>
    {order.billing && <Card><CardHeader><CardTitle className="text-base">Podaci za fakturu</CardTitle></CardHeader><CardContent className="text-sm">{order.billing.companyName}<br/>PIB: {order.billing.pib}<br/>MB: {order.billing.registrationNumber}<br/>{order.billing.address}, {order.billing.postalCode} {order.billing.city}</CardContent></Card>}</div>
  </div>;
}

export default function OwnerOrders() {
  const [, params] = useRoute("/vlasnik/porudzbine/:orderId");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const listParams = useMemo(() => ({ page, pageSize }), [page]);
  const { data: orders = [], isLoading } = useListOrders(listParams, { query: { enabled: !params?.orderId, queryKey: getListOrdersQueryKey(listParams) } });

  const hasNextPage = orders.length === pageSize;
  const { toast } = useToast();
  const [repeatIdempotencyKey, setRepeatIdempotencyKey] = useState(() => crypto.randomUUID());

  const repeatOrder = useRepeatLastShopOrder({
    request: { headers: { "Idempotency-Key": repeatIdempotencyKey } },
    mutation: {
      onSuccess: (data) => {
        setRepeatIdempotencyKey(crypto.randomUUID());
        toast.success(`Porudžbina ponovljena. Dodato ${data.added?.length || 0} stavki u korpu.`);
        window.location.href = "/vlasnik/prodavnica/korpa";
      },
      onError: (err: any) => toast.error("Greška pri ponavljanju porudžbine.")
    }
  });

  return <BusinessLayout><div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8"><OwnerSidebar current="/vlasnik/porudzbine"/><main className="flex-1 min-w-0">{params?.orderId ? <OrderDetail id={params.orderId}/> : <><div className="mb-6"><h1 className="text-3xl font-serif font-bold">B2B porudžbine</h1><p className="text-muted-foreground">Pregledajte istoriju, dostavu i račune.</p></div>{isLoading ? <Loader2 className="animate-spin"/> : orders.length === 0 ? <Card><CardContent className="p-10 text-center text-muted-foreground"><Package className="mx-auto mb-3 opacity-30"/>{page > 1 ? "Nema više porudžbina." : "Još nemate porudžbina."}</CardContent></Card> : <div className="space-y-3">{orders.map((order) => <Card key={order.id}><CardContent className="p-4 flex flex-wrap gap-3 items-center justify-between"><div><b>#{order.id.slice(0, 8)}</b><p className="text-sm text-muted-foreground">{date(order.createdAt)} · {order.itemCount} stavki</p><DeliveryTracking order={order} compact /></div><Badge>{order.status}</Badge><b>{money(order.total)}</b><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => repeatOrder.mutate()} disabled={repeatOrder.isPending}><Repeat className="w-4 h-4 mr-1"/> Ponovi porudžbinu</Button><Button asChild variant="outline" size="sm"><Link href={`/vlasnik/porudzbine/${order.id}`}>Detalji</Link></Button></div></CardContent></Card>)}</div>}{!params?.orderId && !isLoading && (page > 1 || hasNextPage) && <div className="flex items-center justify-between gap-3 pt-4"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} data-testid="btn-prev-page">Prethodna</Button><span className="text-sm text-muted-foreground">Strana {page}</span><Button variant="outline" size="sm" disabled={!hasNextPage} onClick={() => setPage(p => p + 1)} data-testid="btn-next-page">Sledeća</Button></div>}</>}</main></div></BusinessLayout>;
}