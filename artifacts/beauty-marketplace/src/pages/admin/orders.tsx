import { useEffect, useMemo, useState } from "react";
import { Link, useRoute, useSearch } from "wouter";
import {
  getAdminGetOrderQueryKey, getAdminGetSalonQueryKey, getAdminListOrdersQueryKey, useAdminBulkUpdateOrders, useAdminGetOrder,
  useAdminGetSalon, useAdminListCourierServices, useAdminListOrders, useAdminUpdateOrderStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "./layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Loader2, Printer, Truck, PackageCheck, StickyNote } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

const statuses = ["pending", "confirmed", "paid", "processing", "shipped", "delivered", "cancelled"] as const;
const paymentStatuses = ["unpaid", "pending", "paid", "refunded", "failed"] as const;
const money = (amount: number) => `${amount.toLocaleString("sr-RS")} RSD`;
const statusLabel: Record<string, string> = { pending: "Novo", confirmed: "Potvrđeno", paid: "Plaćeno", processing: "U obradi", shipped: "Poslato", delivered: "Isporućeno", cancelled: "Otkazano", unpaid: "Neplaćeno", refunded: "Refundirano", failed: "Neuspešno" };

type PrintOrder = {
  id: string; createdAt: string; subtotal: number; shippingCost: number; total: number; deliveryMethod: string;
  salon: { name: string; phone: string; email: string; address: string; city: string; postalCode: string | null };
  delivery: { recipientName: string; address: string; city?: string | null; postalCode?: string | null; phone?: string | null };
  billing: { companyName: string; pib: string; registrationNumber: string; address: string; city: string; postalCode: string } | null;
  items: Array<{ productName: string; variantValue?: string | null; variantLabel?: string | null; productSku?: string | null; quantity: number; price: number }>;
};

type RetailOrder = {
  id: string; orderNumber: string; status: string; paymentMethod: string; paymentStatus: string; total: number; createdAt: string;
  contact: { name: string; email: string; phone: string }; delivery: { address: string; city: string; postalCode: string; note: string | null };
  items: Array<{ id: string; name: string; quantity: number; unitPrice: number }>;
};

function AdminRetailOrders() {
  const [orders, setOrders] = useState<RetailOrder[] | null>(null);
  const [status, setStatus] = useState("all");
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  const load = () => void fetch(`/api/admin/retail-orders${status === "all" ? "" : `?status=${encodeURIComponent(status)}`}`, { credentials: "include" })
    .then((response) => response.ok ? response.json() : Promise.reject()).then(setOrders).catch(() => setOrders([]));
  useEffect(load, [status]);
  const updateStatus = async (orderId: string, nextStatus: string) => {
    const key = `retail-status:${orderId}`;
    if (!actionGuard.begin(key)) return;
    try {
      const response = await fetch(`/api/admin/retail-orders/${orderId}/status`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: nextStatus }) });
      if (!response.ok) { toast.error("Status nije sačuvan."); return; }
      toast.success("Status retail porudžbine je sačuvan."); load();
    } finally { actionGuard.end(key); }
  };
  const updatePaymentStatus = async (orderId: string, paymentStatus: string) => {
    const key = `retail-payment:${orderId}`;
    if (!actionGuard.begin(key)) return;
    try {
      const response = await fetch(`/api/admin/retail-orders/${orderId}/payment-status`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentStatus }) });
      if (!response.ok) { toast.error("Status plaćanja nije sačuvan."); return; }
      toast.success("Status plaćanja je sačuvan."); load();
    } finally { actionGuard.end(key); }
  };
  return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-serif font-bold">Retail porudžbine</h1><p className="text-muted-foreground">Kupci, gosti, dostava i javne cene.</p></div><div className="flex gap-2"><Button variant="outline" asChild><Link href="/admin/porudzbine">B2B</Link></Button><Button onClick={() => window.print()} variant="outline"><Printer className="mr-2 h-4 w-4" />Štampaj</Button></div></div>
    <Card><CardContent className="p-4"><Select value={status} onValueChange={setStatus}><SelectTrigger className="max-w-52"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">Svi statusi</SelectItem>{statuses.map((item) => <SelectItem key={item} value={item}>{statusLabel[item]}</SelectItem>)}</SelectContent></Select></CardContent></Card>
    {!orders ? <Loader2 className="animate-spin" /> : orders.length === 0 ? <Card><CardContent className="p-8 text-center text-muted-foreground">Nema retail porudžbina za izabrani filter.</CardContent></Card> : <div className="space-y-3">{orders.map((order) => <Card key={order.id}><CardContent className="p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-semibold">{order.orderNumber} <Badge className="ml-2">Retail</Badge></p><p className="text-sm text-muted-foreground">{order.contact.name} · {order.contact.email} · {order.contact.phone}</p><p className="mt-1 text-sm">{order.delivery.address}, {order.delivery.postalCode} {order.delivery.city}</p><p className="mt-2 text-sm text-muted-foreground">{order.items.map((item) => `${item.quantity}× ${item.name}`).join(", ")}</p></div><div className="flex min-w-48 flex-col items-end gap-2"><strong>{money(order.total)}</strong><Select value={order.paymentStatus} onValueChange={(next) => void updatePaymentStatus(order.id, next)}><SelectTrigger className="w-40" disabled={actionGuard.isActive(`retail-payment:${order.id}`)}><SelectValue /></SelectTrigger><SelectContent>{paymentStatuses.map((item) => <SelectItem key={item} value={item}>{statusLabel[item]}</SelectItem>)}</SelectContent></Select><Select value={order.status} onValueChange={(next) => void updateStatus(order.id, next)}><SelectTrigger className="w-40" disabled={actionGuard.isActive(`retail-status:${order.id}`)}><SelectValue /></SelectTrigger><SelectContent>{statuses.map((item) => <SelectItem key={item} value={item}>{statusLabel[item]}</SelectItem>)}</SelectContent></Select></div></div></CardContent></Card>)}</div>}
  </div>;
}

function OrderPrintDocuments({ orders, mode }: { orders: PrintOrder[]; mode: "packing" | "invoice" }) {
  const invoice = mode === "invoice";
  return <div className="print-root hidden print:block">
    <style>{`@media print {
      @page { size: A4; margin: 14mm; }
      body * { visibility: hidden !important; }
      .print-root, .print-root * { visibility: visible !important; }
      .print-root { position: absolute; inset: 0; color: #111; font-family: Arial, sans-serif; font-size: 11px; line-height: 1.4; }
      .print-page { break-after: page; page-break-after: always; min-height: 260mm; }
      .print-page:last-child { break-after: auto; page-break-after: auto; }
      .print-header { display: flex; justify-content: space-between; gap: 20px; border-bottom: 2px solid #222; padding-bottom: 12px; margin-bottom: 18px; }
      .print-title { font-size: 23px; font-weight: 700; letter-spacing: .04em; margin: 0; }
      .print-label { color: #555; text-transform: uppercase; font-size: 9px; letter-spacing: .08em; margin: 0 0 3px; }
      .print-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 28px; margin-bottom: 18px; }
      .print-box { border: 1px solid #bbb; padding: 10px; min-height: 74px; }
      .print-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      .print-table th { background: #eee; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
      .print-table th, .print-table td { border: 1px solid #bbb; padding: 7px; vertical-align: top; }
      .print-table .right { text-align: right; }
      .print-table .center { text-align: center; }
      .print-totals { width: 260px; margin: 18px 0 0 auto; }
      .print-totals div { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #ddd; }
      .print-totals .grand { border-top: 2px solid #222; border-bottom: 0; margin-top: 5px; padding-top: 8px; font-size: 14px; font-weight: 700; }
      .print-note { margin-top: 20px; color: #555; font-size: 10px; }
    }`}</style>
    {orders.map((order) => <section className="print-page" key={order.id}>
      <header className="print-header"><div><p className="print-label">LUMERA B2B</p><h1 className="print-title">{invoice ? "FAKTURA / RAČUN" : "OTPREMNICA"}</h1></div><div><p className="print-label">Broj porudžbine</p><b>#{order.id.slice(0, 8).toUpperCase()}</b><br /><span>{new Date(order.createdAt).toLocaleDateString("sr-RS")}</span></div></header>
      <div className="print-grid">
        <div className="print-box"><p className="print-label">{order.billing ? "Kupac — firma" : "Kupac — salon / preduzetnik"}</p>{order.billing ? <><b>{order.billing.companyName}</b><br />PIB: {order.billing.pib} · MB: {order.billing.registrationNumber}<br />{order.billing.address}, {order.billing.postalCode} {order.billing.city}</> : <><b>{order.salon.name}</b><br />{order.salon.address}, {order.salon.postalCode} {order.salon.city}<br />{order.salon.phone} · {order.salon.email}</>}</div>
        <div className="print-box"><p className="print-label">Dostava</p><b>{order.delivery.recipientName}</b><br />{order.delivery.address}, {order.delivery.postalCode} {order.delivery.city}<br />{order.delivery.phone ?? order.salon.phone}<br />Način: {order.deliveryMethod === "personal_belgrade" ? "Lična dostava — Beograd" : "Kurirska dostava"}</div>
      </div>
      {invoice ? <><table className="print-table"><thead><tr><th>Proizvod</th><th>Varijanta</th><th>SKU</th><th className="center">Količina</th><th className="right">Jedinična cena</th><th className="right">Ukupno</th></tr></thead><tbody>{order.items.map((item, index) => <tr key={index}><td>{item.productName}</td><td>{item.variantLabel ?? item.variantValue ?? "—"}</td><td>{item.productSku ?? "—"}</td><td className="center">{item.quantity}</td><td className="right">{money(item.price)}</td><td className="right">{money(item.price * item.quantity)}</td></tr>)}</tbody></table><div className="print-totals"><div><span>Međuzbir</span><span>{money(order.subtotal)}</span></div><div><span>Dostava</span><span>{money(order.shippingCost)}</span></div><div className="grand"><span>Ukupno</span><span>{money(order.total)}</span></div></div><p className="print-note">Cene su iskazane sa uračunatim PDV-om. PDV stopa nije zasebno evidentirana po proizvodu u ovom sistemu. Ovaj dokument je komercijalni pregled porudžbine i nije fiskalni račun; fiskalizacija i e-račun nisu deo ovog modula.</p></> : <table className="print-table"><thead><tr><th>Artikal</th><th>Varijanta</th><th>SKU</th><th className="center">Količina</th></tr></thead><tbody>{order.items.map((item, index) => <tr key={index}><td>{item.productName}</td><td>{item.variantLabel ?? item.variantValue ?? "—"}</td><td>{item.productSku ?? "—"}</td><td className="center">{item.quantity}</td></tr>)}</tbody></table>}
    </section>)}
  </div>;
}

function AdminOrderDetail({ orderId }: { orderId: string }) {
  const { data: order, isLoading } = useAdminGetOrder(orderId);
  const { data: courierServices = [] } = useAdminListCourierServices();
  const salonId = order?.salon.id ?? "";
  const { data: salonProfile } = useAdminGetSalon(salonId, { query: { enabled: Boolean(salonId), queryKey: getAdminGetSalonQueryKey(salonId) } });
  const qc = useQueryClient(); const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  const update = useAdminUpdateOrderStatus({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getAdminListOrdersQueryKey() }); qc.invalidateQueries({ queryKey: getAdminGetOrderQueryKey(orderId) }); toast.success("Operativni podaci su sačuvani."); } } });
  const [courierId, setCourierId] = useState<string | null | undefined>(undefined);
  const [tracking, setTracking] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [printMode, setPrintMode] = useState<"packing" | "invoice">("packing");
  const printOrder = (mode: "packing" | "invoice") => { setPrintMode(mode); requestAnimationFrame(() => requestAnimationFrame(() => window.print())); };
  if (isLoading) return <div className="p-10 text-center"><Loader2 className="inline animate-spin" /></div>;
  if (!order) return <p className="text-muted-foreground">Porudžbina nije pronađena.</p>;
  const saveOps = () => {
    if (!actionGuard.begin("ops")) return;
    update.mutate({ orderId, data: {
    ...(courierId !== undefined ? { courierServiceId: courierId } : {}),
    ...(tracking !== undefined ? { trackingNumber: tracking || null } : {}),
    ...(note !== undefined ? { adminNote: note || null } : {}),
    } }, { onSettled: () => actionGuard.end("ops") });
  };
  const updateOrderField = (key: "delivery-status" | "payment-status", data: Parameters<typeof update.mutate>[0]["data"]) => {
    if (!actionGuard.begin(key)) return;
    update.mutate({ orderId, data }, { onSettled: () => actionGuard.end(key) });
  };
  return <div className="space-y-5">
    <Button asChild variant="ghost"><Link href="/admin/porudzbine"><ArrowLeft className="mr-2 h-4 w-4" />Nazad na porudžbine</Link></Button>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-serif font-bold">Porudžbina #{order.id.slice(0, 8)}</h1><p className="text-muted-foreground">{order.salon.name} · {new Date(order.createdAt).toLocaleString("sr-RS")}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => printOrder("packing")}><Printer className="mr-2 h-4 w-4" />Štampaj otpremnicu</Button><Button onClick={() => printOrder("invoice")}><Printer className="mr-2 h-4 w-4" />Štampaj fakturu/račun</Button><Badge>{statusLabel[order.status]}</Badge><Badge variant="outline">{statusLabel[order.paymentStatus]}</Badge></div></div>
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardHeader><CardTitle className="text-lg">Stavke i iznos</CardTitle></CardHeader><CardContent className="space-y-3">{order.items.map(item => <div key={`${item.productId}-${item.variantValue ?? "base"}`} className="flex justify-between border-b pb-3 last:border-0"><div><b>{item.productName}</b><p className="text-sm text-muted-foreground">SKU: {item.productSku ?? "—"} · {item.quantity} kom.</p></div><b>{money(item.price * item.quantity)}</b></div>)}<div className="ml-auto max-w-xs space-y-1 border-t pt-3 text-sm"><div className="flex justify-between"><span>Međuzbir</span><span>{money(order.subtotal)}</span></div><div className="flex justify-between"><span>Dostava</span><span>{money(order.shippingCost)}</span></div><div className="flex justify-between font-bold text-base"><span>Ukupno</span><span>{money(order.total)}</span></div></div></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Salon i dostava</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><Link href={`/admin/saloni/${order.salon.id}`} className="font-semibold text-primary hover:underline">{order.salon.name}</Link><p>{order.delivery.recipientName}<br />{order.delivery.address}<br />{order.delivery.postalCode} {order.delivery.city}<br />{order.delivery.phone}</p><p className="rounded bg-muted p-2">{order.deliveryMethod === "personal_belgrade" ? "Lična dostava — Beograd" : "Kurirska dostava"}</p><div className="rounded border bg-muted/30 p-2"><p className="font-medium">{salonProfile?.orderCount ?? "—"} porudžbina · {salonProfile ? money(salonProfile.orderTotal) : "Učitavanje…"}</p><Link href={`/admin/saloni/${order.salon.id}`} className="text-primary hover:underline">Pogledaj profil salona</Link></div></CardContent></Card>
    </div>
      <Card><CardHeader><CardTitle className="flex gap-2 text-lg"><Truck className="h-5 w-5" />Operativni podaci</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><div><Label>Kurirska služba</Label><Select value={courierId === undefined ? order.courierServiceId ?? "__none" : courierId ?? "__none"} onValueChange={value => setCourierId(value === "__none" ? null : value)}><SelectTrigger data-testid="select-order-courier"><SelectValue placeholder="Izaberite kurira" /></SelectTrigger><SelectContent><SelectItem value="__none">Nije izabrano</SelectItem>{courierServices.filter(service => service.active || service.id === order.courierServiceId).map(service => <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>)}</SelectContent></Select>{!order.courierServiceId && order.courierService && <p className="mt-1 text-xs text-muted-foreground">Prethodno sačuvano: {order.courierService}</p>}</div><div><Label>Broj za praćenje</Label><Input value={tracking ?? order.trackingNumber ?? ""} onChange={e => setTracking(e.target.value)} placeholder="Broj pošiljke" data-testid="input-order-tracking" /></div><div className="md:col-span-2"><Label>Interna beleška</Label><Input value={note ?? order.adminNote ?? ""} onChange={e => setNote(e.target.value)} placeholder="Vidljivo samo administratorima" /></div><div className="flex flex-wrap gap-2 md:col-span-2"><Button onClick={saveOps} disabled={update.isPending || actionGuard.isActive("ops")}>Sačuvaj operativne podatke</Button><Select value={order.status} onValueChange={status => updateOrderField("delivery-status", { status: status as "confirmed" | "shipped" | "delivered" | "cancelled" })}><SelectTrigger className="w-48" disabled={update.isPending || actionGuard.isActive("delivery-status")}><SelectValue /></SelectTrigger><SelectContent>{["confirmed", "shipped", "delivered", "cancelled"].map(s => <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>)}</SelectContent></Select><Select value={order.paymentStatus} onValueChange={paymentStatus => updateOrderField("payment-status", { paymentStatus: paymentStatus as "unpaid" | "pending" | "paid" | "refunded" | "failed" })}><SelectTrigger className="w-44" disabled={update.isPending || actionGuard.isActive("payment-status")}><SelectValue /></SelectTrigger><SelectContent>{paymentStatuses.map(s => <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>)}</SelectContent></Select></div></CardContent></Card>
    {order.billing && <Card><CardHeader><CardTitle className="text-base">Podaci za fakturu</CardTitle></CardHeader><CardContent className="text-sm">{order.billing.companyName}<br />PIB: {order.billing.pib} · MB: {order.billing.registrationNumber}<br />{order.billing.address}, {order.billing.postalCode} {order.billing.city}</CardContent></Card>}
    <Card><CardHeader><CardTitle className="flex gap-2 text-lg"><StickyNote className="h-5 w-5" />Audit istorija</CardTitle></CardHeader><CardContent>{order.history.length ? <ol className="space-y-3">{order.history.map(event => <li key={event.id} className="border-l-2 border-primary/30 pl-3 text-sm"><b>{event.actorName}</b> je promenio <b>{event.field}</b> sa „{event.previousValue ?? "—"}“ na „{event.nextValue ?? "—"}“<br /><span className="text-muted-foreground">{new Date(event.createdAt).toLocaleString("sr-RS")}</span></li>)}</ol> : <p className="text-sm text-muted-foreground">Nema zabeleženih promena.</p>}</CardContent></Card>
    <OrderPrintDocuments orders={[order]} mode={printMode} />
  </div>;
}

export default function AdminOrders() {
  const [, routeParams] = useRoute("/admin/porudzbine/:orderId");
  const searchString = useSearch();
  const retailMode = new URLSearchParams(searchString).get("channel") === "retail";
  const qc = useQueryClient(); const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("all"); const [paymentStatus, setPaymentStatus] = useState("all"); const [deliveryMethod, setDeliveryMethod] = useState("all"); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [selected, setSelected] = useState<string[]>([]); const [bulkPrintMode, setBulkPrintMode] = useState<"packing" | "invoice">("packing");
  const debouncedSearch = useDebouncedSearch(search);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  // Reset to the first page whenever any filter changes so results stay reachable.
  useEffect(() => { setPage(1); }, [debouncedSearch, status, paymentStatus, deliveryMethod, from, to]);
  const params = useMemo(() => ({ ...(debouncedSearch ? { search: debouncedSearch } : {}), ...(status !== "all" ? { status: status as typeof statuses[number] } : {}), ...(paymentStatus !== "all" ? { paymentStatus: paymentStatus as typeof paymentStatuses[number] } : {}), ...(deliveryMethod !== "all" ? { deliveryMethod: deliveryMethod as "courier" | "personal_belgrade" } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), page, pageSize }), [debouncedSearch, status, paymentStatus, deliveryMethod, from, to, page]);
  const { data: orders = [], isLoading } = useAdminListOrders(params, { query: { enabled: !routeParams?.orderId, queryKey: getAdminListOrdersQueryKey(params) } });
  // customFetch returns only the body, so we infer "has next page" from whether
  // this page came back full (== pageSize).
  const hasNextPage = orders.length === pageSize;
  const bulk = useAdminBulkUpdateOrders({ mutation: { onSuccess: () => { setSelected([]); qc.invalidateQueries({ queryKey: getAdminListOrdersQueryKey() }); toast.success("Izabrane porudžbine su ažurirane."); } } });
  const updateBulkStatus = (nextStatus: string) => {
    if (!actionGuard.begin("bulk-status")) return;
    bulk.mutate(
      { data: { orderIds: selected, status: nextStatus as "confirmed" | "shipped" | "delivered" | "cancelled" } },
      { onSettled: () => actionGuard.end("bulk-status") },
    );
  };
  const selectedOrders = orders.filter(order => selected.includes(order.id));
  const toggle = (id: string) => setSelected(ids => ids.includes(id) ? ids.filter(candidate => candidate !== id) : [...ids, id]);
  const exportCsv = () => { const lines = [["Broj", "Salon", "Status isporuke", "Status plaćanja", "Dostava", "Ukupno"], ...selectedOrders.map(order => [order.id, order.salon.name, order.status, order.paymentStatus, order.deliveryMethod, order.total])]; const blob = new Blob([lines.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "lumera-porudzbine.csv"; link.click(); URL.revokeObjectURL(url); };
  const printSelected = () => requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  return <AdminLayout>{retailMode ? <AdminRetailOrders /> : routeParams?.orderId ? <AdminOrderDetail orderId={routeParams.orderId} /> : <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-serif font-bold">B2B porudžbine</h1><p className="text-muted-foreground">Operativna obrada, dostava i plaćanja.</p></div><Button variant="outline" asChild><Link href="/admin/porudzbine?channel=retail">Retail porudžbine</Link></Button>{selected.length > 0 && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />CSV ({selected.length})</Button><Select value={bulkPrintMode} onValueChange={value => setBulkPrintMode(value as "packing" | "invoice")}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="packing">Otpremnice bez cena</SelectItem><SelectItem value="invoice">Fakture / računi</SelectItem></SelectContent></Select><Button variant="outline" onClick={printSelected}><Printer className="mr-2 h-4 w-4" />Štampaj ({selected.length})</Button><Select onValueChange={updateBulkStatus}><SelectTrigger className="w-44" disabled={bulk.isPending || actionGuard.isActive("bulk-status")}><SelectValue placeholder="Masovni status" /></SelectTrigger><SelectContent>{["confirmed", "shipped", "delivered", "cancelled"].map(s => <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>)}</SelectContent></Select></div>}</div>
    <Card><CardContent className="grid gap-3 p-4 md:grid-cols-3 lg:grid-cols-6"><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Salon, primalac, broj" className="lg:col-span-2" /><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue placeholder="Isporuka" /></SelectTrigger><SelectContent><SelectItem value="all">Svi statusi</SelectItem>{statuses.map(s => <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>)}</SelectContent></Select><Select value={paymentStatus} onValueChange={setPaymentStatus}><SelectTrigger><SelectValue placeholder="Plaćanje" /></SelectTrigger><SelectContent><SelectItem value="all">Sva plaćanja</SelectItem>{paymentStatuses.map(s => <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>)}</SelectContent></Select><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></CardContent></Card>
    {isLoading ? <Loader2 className="animate-spin" /> : <div className="space-y-3">{orders.map(order => <Card key={order.id}><CardContent className="flex flex-wrap items-center gap-3 p-4"><Checkbox checked={selected.includes(order.id)} onCheckedChange={() => toggle(order.id)} aria-label={`Izaberi ${order.id}`} /><div className="min-w-48 flex-1"><Link className="font-semibold hover:text-primary" href={`/admin/porudzbine/${order.id}`}>#{order.id.slice(0, 8)} · {order.salon.name}</Link><p className="text-sm text-muted-foreground">{order.delivery.recipientName} · {new Date(order.createdAt).toLocaleDateString("sr-RS")}</p></div><Badge variant="outline">{order.deliveryMethod === "personal_belgrade" ? "Lična BG" : "Kurir"}</Badge><Badge>{statusLabel[order.status]}</Badge><Badge variant="secondary">{statusLabel[order.paymentStatus]}</Badge><b className="w-28 text-right">{money(order.total)}</b><Button asChild size="sm" variant="outline"><Link href={`/admin/porudzbine/${order.id}`}>Detalji</Link></Button></CardContent></Card>)}</div>}
    {!isLoading && <div className="flex items-center justify-between gap-3 pt-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} data-testid="btn-prev-page">Prethodna</Button><span className="text-sm text-muted-foreground">Strana {page}</span><Button variant="outline" size="sm" disabled={!hasNextPage} onClick={() => setPage(p => p + 1)} data-testid="btn-next-page">Sledeća</Button></div>}
    <OrderPrintDocuments orders={selectedOrders} mode={bulkPrintMode} />
  </div>}</AdminLayout>;
}