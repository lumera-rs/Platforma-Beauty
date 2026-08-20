import { Link, useRoute } from "wouter";
import { getAdminGetSalonQueryKey, useAdminGetSalon } from "@workspace/api-client-react";
import { AdminLayout } from "./layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, Crown, Loader2, ReceiptText, Store } from "lucide-react";

const money = (amount: number) => `${amount.toLocaleString("sr-RS")} RSD`;
const statusLabel: Record<string, string> = {
  pending: "Novo", confirmed: "Potvrđeno", paid: "Plaćeno", processing: "U obradi",
  shipped: "Poslato", delivered: "Isporućeno", cancelled: "Otkazano",
  unpaid: "Neplaćeno", refunded: "Refundirano", failed: "Neuspešno",
};

export default function AdminSalonDetail() {
  const [, params] = useRoute("/admin/saloni/:salonId");
  const salonId = params?.salonId ?? "";
  const { data: salon, isLoading } = useAdminGetSalon(salonId, { query: { enabled: Boolean(salonId), queryKey: getAdminGetSalonQueryKey(salonId) } });

  return <AdminLayout>
    {isLoading ? <div className="p-10 text-center"><Loader2 className="inline animate-spin" /></div>
      : !salon ? <p className="p-10 text-muted-foreground">Salon nije pronađen.</p>
        : <div className="space-y-5">
          <Button asChild variant="ghost"><Link href="/admin/saloni"><ArrowLeft className="mr-2 h-4 w-4" />Nazad na salone</Link></Button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h1 className="text-3xl font-serif font-bold">{salon.name}</h1><p className="text-muted-foreground">Administrativni profil salona i B2B porudžbine.</p></div>
            <div className="flex gap-2"><Badge variant={salon.active ? "default" : "secondary"}>{salon.active ? "Aktivan" : "Neaktivan"}</Badge>{salon.featured && <Badge variant="outline">Izdvojen</Badge>}</div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Ukupno porudžbina</p><p className="mt-1 text-3xl font-bold">{salon.orderCount}</p></CardContent></Card>
            <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Ukupna vrednost</p><p className="mt-1 text-2xl font-bold">{money(salon.orderTotal)}</p></CardContent></Card>
            <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Pretplata</p><p className="mt-1 font-semibold">{salon.subscriptionPlan ?? "Bez pretplate"}</p><p className="text-xs text-muted-foreground">{salon.subscriptionStatus ?? "—"}</p></CardContent></Card>
            <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Loyalty nivo</p><p className="mt-1 font-semibold">{salon.loyaltyTier ?? "Nije dodeljen"}</p><p className="text-xs text-muted-foreground">Potrošnja: {money(salon.loyaltySpend)}</p></CardContent></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Store className="h-5 w-5" />Osnovni podaci</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
              <p><b>Kontakt:</b> {salon.phone} · {salon.email}</p><p><b>Adresa:</b> {salon.address}, {salon.postalCode} {salon.city}</p><p><b>Ocena:</b> {salon.rating.toLocaleString("sr-RS")} ({salon.reviewCount} recenzija)</p>
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Building2 className="h-5 w-5" />Status partnerstva</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
              <p><b>Pretplata:</b> {salon.subscriptionPlan ?? "Bez aktivnog paketa"}</p><p><b>Status:</b> {salon.subscriptionStatus ?? "—"}</p><p className="flex items-center gap-2"><Crown className="h-4 w-4 text-amber-500" /><b>Loyalty:</b> {salon.loyaltyTier ?? "Nije dodeljen"}</p>
            </CardContent></Card>
          </div>

          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><ReceiptText className="h-5 w-5" />Porudžbine</CardTitle></CardHeader><CardContent>
            {salon.orders.length === 0 ? <p className="text-sm text-muted-foreground">Salon još nema B2B porudžbine.</p> : <div className="space-y-2">
              {salon.orders.map((order) => <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <div><Link href={`/admin/porudzbine/${order.id}`} className="font-semibold text-primary hover:underline">#{order.id.slice(0, 8).toUpperCase()}</Link><p className="text-muted-foreground">{new Date(order.createdAt).toLocaleString("sr-RS")} · {order.itemCount} stavki</p></div>
                <div className="flex items-center gap-2"><Badge variant="outline">{statusLabel[order.status] ?? order.status}</Badge><Badge variant="secondary">{statusLabel[order.paymentStatus] ?? order.paymentStatus}</Badge><b>{money(order.total)}</b></div>
              </div>)}
            </div>}
          </CardContent></Card>
        </div>}
  </AdminLayout>;
}