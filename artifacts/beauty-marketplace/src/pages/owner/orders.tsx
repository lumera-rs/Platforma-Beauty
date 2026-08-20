import { Link, useRoute } from "wouter";
import { useGetOrder, useListOrders, getListOrdersQueryKey } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Package, ArrowLeft } from "lucide-react";

const money = (n: number) => `${n.toLocaleString("sr-RS")} RSD`;
const date = (d: string) => new Date(d).toLocaleDateString("sr-RS", { dateStyle: "medium" });

function OrderDetail({ id }: { id: string }) {
  const { data: order, isLoading } = useGetOrder(id);
  if (isLoading) return <div className="p-10 text-center"><Loader2 className="animate-spin inline" /></div>;
  if (!order) return <p>Porudžbina nije pronađena.</p>;
  return <div className="space-y-4"><Button asChild variant="ghost"><Link href="/vlasnik/porudzbine"><ArrowLeft className="w-4 h-4 mr-2"/>Nazad na porudžbine</Link></Button>
    <Card><CardHeader><CardTitle className="flex justify-between">Porudžbina #{order.id.slice(0, 8)} <Badge>{order.status}</Badge></CardTitle></CardHeader><CardContent className="space-y-4">
      {order.items.map((item) => <div key={`${item.productId}-${item.variantValue}`} className="flex justify-between border-b pb-3"><div><b>{item.productName}</b><p className="text-sm text-muted-foreground">{item.variantLabel ? `${item.variantLabel}: ` : ""}{item.variantValue ?? "—"} · SKU {item.productSku ?? "—"} · {item.quantity} kom.</p></div><b>{money(item.price * item.quantity)}</b></div>)}
      <div className="text-sm space-y-1 border-t pt-3"><div className="flex justify-between"><span>Međuzbir</span><span>{money(order.subtotal)}</span></div><div className="flex justify-between"><span>Dostava</span><span>{money(order.shippingCost)}</span></div><div className="flex justify-between font-bold text-base"><span>Ukupno</span><span>{money(order.total)}</span></div></div>
    </CardContent></Card>
    <div className="grid md:grid-cols-2 gap-4"><Card><CardHeader><CardTitle className="text-base">Dostava</CardTitle></CardHeader><CardContent className="text-sm">{order.delivery.recipientName}<br/>{order.delivery.address}<br/>{order.delivery.postalCode} {order.delivery.city}<br/>{order.delivery.phone}<br/>{order.delivery.note && <em>{order.delivery.note}</em>}</CardContent></Card>
    {order.billing && <Card><CardHeader><CardTitle className="text-base">Podaci za fakturu</CardTitle></CardHeader><CardContent className="text-sm">{order.billing.companyName}<br/>PIB: {order.billing.pib}<br/>MB: {order.billing.registrationNumber}<br/>{order.billing.address}, {order.billing.postalCode} {order.billing.city}</CardContent></Card>}</div>
  </div>;
}

export default function OwnerOrders() {
  const [, params] = useRoute("/vlasnik/porudzbine/:orderId");
  const { data: orders = [], isLoading } = useListOrders({ query: { enabled: !params?.orderId, queryKey: getListOrdersQueryKey() } });
  return <BusinessLayout><div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8"><OwnerSidebar current="/vlasnik/porudzbine"/><main className="flex-1 min-w-0">{params?.orderId ? <OrderDetail id={params.orderId}/> : <><div className="mb-6"><h1 className="text-3xl font-serif font-bold">B2B porudžbine</h1><p className="text-muted-foreground">Pregledajte istoriju, dostavu i račune.</p></div>{isLoading ? <Loader2 className="animate-spin"/> : orders.length === 0 ? <Card><CardContent className="p-10 text-center text-muted-foreground"><Package className="mx-auto mb-3 opacity-30"/>Još nemate porudžbina.</CardContent></Card> : <div className="space-y-3">{orders.map((order) => <Card key={order.id}><CardContent className="p-4 flex flex-wrap gap-3 items-center justify-between"><div><b>#{order.id.slice(0, 8)}</b><p className="text-sm text-muted-foreground">{date(order.createdAt)} · {order.itemCount} stavki</p></div><Badge>{order.status}</Badge><b>{money(order.total)}</b><Button asChild variant="outline" size="sm"><Link href={`/vlasnik/porudzbine/${order.id}`}>Detalji</Link></Button></CardContent></Card>)}</div>}</>}</main></div></BusinessLayout>;
}