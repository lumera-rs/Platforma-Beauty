import { useState } from "react";
import { Link, useRoute } from "wouter";
import { useAdminGetOrder, useAdminListOrders, useAdminUpdateOrderStatus, getAdminListOrdersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "./layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";

const statuses = ["pending", "confirmed", "paid", "processing", "shipped", "delivered", "cancelled"] as const;

const money = (amount: number) => `${amount.toLocaleString("sr-RS")} RSD`;

function AdminOrderDetail({ orderId }: { orderId: string }) {
  const { data: order, isLoading } = useAdminGetOrder(orderId);
  if (isLoading) return <div className="p-10 text-center"><Loader2 className="inline animate-spin" /></div>;
  if (!order) return <p className="text-muted-foreground">Porudžbina nije pronađena.</p>;

  return <div className="space-y-5">
    <Button asChild variant="ghost"><Link href="/admin/porudzbine"><ArrowLeft className="mr-2 h-4 w-4" />Nazad na porudžbine</Link></Button>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-3xl font-serif font-bold">Porudžbina #{order.id.slice(0, 8)}</h1><p className="text-muted-foreground">{order.salon.name} · {new Date(order.createdAt).toLocaleString("sr-RS")}</p></div>
      <Badge>{order.status}</Badge>
    </div>
    <Card>
      <CardHeader><CardTitle className="text-lg">Stavke porudžbine</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {order.items.length === 0 ? <p className="text-sm text-muted-foreground">Nema sačuvanih stavki za ovu porudžbinu.</p> : order.items.map((item) => (
          <div key={`${item.productId}-${item.variantValue ?? "base"}`} className="flex flex-wrap items-start justify-between gap-3 border-b pb-3 last:border-0">
            <div><p className="font-medium">{item.productName}</p><p className="text-sm text-muted-foreground">{item.variantLabel ? `${item.variantLabel}: ` : ""}{item.variantValue ?? "Standard"} · SKU: {item.productSku ?? "—"} · Količina: {item.quantity}</p></div>
            <div className="text-right"><p>{money(item.price)} / kom.</p><p className="font-semibold">{money(item.price * item.quantity)}</p></div>
          </div>
        ))}
        <div className="ml-auto max-w-xs space-y-1 border-t pt-3 text-sm">
          <div className="flex justify-between gap-8"><span>Međuzbir</span><span>{money(order.subtotal)}</span></div>
          <div className="flex justify-between gap-8"><span>Dostava</span><span>{money(order.shippingCost)}</span></div>
          <div className="flex justify-between gap-8 text-base font-bold"><span>Ukupno</span><span>{money(order.total)}</span></div>
        </div>
      </CardContent>
    </Card>
    <div className="grid gap-4 md:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">Dostava</CardTitle></CardHeader><CardContent className="text-sm">{order.delivery.recipientName}<br />{order.delivery.address}<br />{order.delivery.postalCode} {order.delivery.city}<br />{order.delivery.phone}{order.delivery.note && <p className="mt-2 italic text-muted-foreground">{order.delivery.note}</p>}</CardContent></Card>
      {order.billing && <Card><CardHeader><CardTitle className="text-base">Podaci za fakturu</CardTitle></CardHeader><CardContent className="text-sm">{order.billing.companyName}<br />PIB: {order.billing.pib}<br />MB: {order.billing.registrationNumber}<br />{order.billing.address}, {order.billing.postalCode} {order.billing.city}</CardContent></Card>}
    </div>
  </div>;
}

export default function AdminOrders() {
 const [, routeParams] = useRoute("/admin/porudzbine/:orderId");
 const [search, setSearch] = useState(""); const [status, setStatus] = useState<string>("all"); const params = { ...(search ? { search } : {}), ...(status !== "all" ? { status: status as typeof statuses[number] } : {}) }; const {data: orders = [], isLoading} = useAdminListOrders(params, { query: { enabled: !routeParams?.orderId, queryKey: getAdminListOrdersQueryKey(params) } }); const qc = useQueryClient(); const update = useAdminUpdateOrderStatus({ mutation: { onSuccess: () => qc.invalidateQueries({queryKey: getAdminListOrdersQueryKey(params)}) }});
 return <AdminLayout>{routeParams?.orderId ? <AdminOrderDetail orderId={routeParams.orderId} /> : <><h1 className="text-3xl font-serif font-bold mb-5">B2B porudžbine</h1><div className="flex gap-3 mb-5"><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pretraga salona, primaoca ili broja"/><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-48"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Svi statusi</SelectItem>{statuses.map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>{isLoading ? <Loader2 className="animate-spin"/> : <div className="space-y-3">{orders.map(o=><Card key={o.id}><CardContent className="p-4 flex flex-wrap gap-3 items-center justify-between"><div><Link className="font-semibold hover:text-primary" href={`/admin/porudzbine/${o.id}`}>#{o.id.slice(0,8)} · {o.salon.name}</Link><p className="text-sm text-muted-foreground">{o.delivery.recipientName} · {new Date(o.createdAt).toLocaleDateString("sr-RS")}</p></div><Badge>{o.status}</Badge><b>{o.total.toLocaleString("sr-RS")} RSD</b><Button asChild size="sm" variant="outline"><Link href={`/admin/porudzbine/${o.id}`}>Detalji</Link></Button><Select value={o.status} onValueChange={value=>update.mutate({orderId:o.id,data:{status:value as "confirmed"|"shipped"|"delivered"|"cancelled"}})}><SelectTrigger className="w-36"><SelectValue/></SelectTrigger><SelectContent>{["confirmed","shipped","delivered","cancelled"].map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></CardContent></Card>)}</div>}</>}</AdminLayout>;
}